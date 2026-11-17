//! Optional passive collector reads. Ephemeral measurements never alter inventory
//! originals, reviewed joins, durable generations or source authority.
use super::{json::bounded_json, model::*, projection::stamp};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    future::Future,
    pin::Pin,
    sync::Arc,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CollectorRoute {
    Health,
    Measurements,
}
impl CollectorRoute {
    pub fn path(self) -> &'static str {
        match self {
            Self::Health => "/api/health",
            Self::Measurements => "/api/measurements",
        }
    }
}
pub(crate) trait CollectorGetPeer {
    fn get(
        &self,
        route: CollectorRoute,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<u8>>> + Send + '_>>;
}
#[derive(Clone, Debug)]
pub(crate) struct Snapshot {
    retrieved_at: String,
    envelope: Envelope,
    health_ok: bool,
    stale_after_ms: i64,
}
/// A generation-keyed, immutable, process-local snapshot. None is unknown,
/// including after restart or a failed inventory refresh.
pub(crate) type Cached = Option<Arc<(String, Option<Snapshot>)>>;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Collector {
    #[serde(deserialize_with = "nullable")]
    last_cycle_at: Option<String>,
    guard_outcome: String,
    schema_version: u8,
}
impl Collector {
    fn validate(&self) -> Result<()> {
        guard(
            self.schema_version == 1
                && ["home", "not-at-home", "unknown"].contains(&self.guard_outcome.as_str()),
        )?;
        optional_stamp(&self.last_cycle_at)
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Health {
    version: u8,
    ok: bool,
    collector: Collector,
    #[serde(default)]
    interval_ms: Option<i64>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    version: u8,
    #[serde(deserialize_with = "super::json::deserialize_revision")]
    inventory_revision: u64,
    generated_at: String,
    collector: Collector,
    #[serde(default)]
    interval_ms: Option<i64>,
    devices: BTreeMap<String, Device>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Device {
    latest: Fact,
    series24h: Vec<Fact>,
    series24h_truncated: bool,
    hourly7d: Vec<Hour>,
    hourly90d: Vec<Hour>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fact {
    state: String,
    #[serde(deserialize_with = "nullable")]
    latency_ms: Option<f64>,
    #[serde(deserialize_with = "nullable")]
    loss: Option<f64>,
    #[serde(deserialize_with = "nullable")]
    measured_at: Option<String>,
    #[serde(deserialize_with = "nullable")]
    recorded_at: Option<String>,
    #[serde(deserialize_with = "nullable")]
    reason: Option<String>,
}
impl Fact {
    fn validate(&self) -> Result<()> {
        optional_stamp(&self.measured_at)?;
        optional_stamp(&self.recorded_at)?;
        match self.state.as_str() {
            "reachable" => guard(
                self.latency_ms.is_some_and(|n| n.is_finite() && n >= 0.)
                    && self.loss == Some(0.)
                    && self.measured_at.is_some()
                    && self.recorded_at.is_some()
                    && self.reason.is_none(),
            ),
            "no-reply" => guard(
                self.latency_ms.is_none()
                    && self.loss == Some(1.)
                    && self.measured_at.is_some()
                    && self.recorded_at.is_some()
                    && self.reason.is_none(),
            ),
            "not-measured" => guard(
                self.latency_ms.is_none()
                    && self.loss.is_none()
                    && self.measured_at.is_none()
                    && self.reason.as_deref().is_some_and(|r| {
                        [
                            "not-at-home",
                            "no-target",
                            "command-unavailable",
                            "shutdown",
                            "no-history",
                        ]
                        .contains(&r)
                    })
                    && (self.recorded_at.is_some() || self.reason.as_deref() == Some("no-history")),
            ),
            _ => guard(false),
        }
    }
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Hour {
    hour: String,
    state: String,
    reachable: u64,
    no_reply: u64,
    not_measured: u64,
    #[serde(deserialize_with = "nullable")]
    min_ms: Option<f64>,
    #[serde(deserialize_with = "nullable")]
    mean_ms: Option<f64>,
    #[serde(deserialize_with = "nullable")]
    max_ms: Option<f64>,
    #[serde(deserialize_with = "nullable")]
    loss: Option<f64>,
}
impl Hour {
    fn validate(&self) -> Result<()> {
        guard(stamp(&self.hour)?.rem_euclid(3_600_000) == 0)?;
        let total = self
            .reachable
            .checked_add(self.no_reply)
            .and_then(|v| v.checked_add(self.not_measured));
        guard(total.is_some_and(|v| v > 0 && v <= 9_007_199_254_740_991))?;
        let measured = self.reachable + self.no_reply;
        guard(
            self.state
                == if measured > 0 {
                    "measured"
                } else {
                    "not-measured"
                },
        )?;
        guard(if measured == 0 {
            self.loss.is_none()
        } else {
            self.loss.is_some_and(|v| {
                v.is_finite()
                    && (0.0..=1.0).contains(&v)
                    && (v - self.no_reply as f64 / measured as f64).abs() < 1e-12
            })
        })?;
        guard(if self.reachable == 0 {
            self.min_ms.is_none() && self.mean_ms.is_none() && self.max_ms.is_none()
        } else {
            matches!((self.min_ms,self.mean_ms,self.max_ms), (Some(a),Some(b),Some(c)) if a.is_finite() && b.is_finite() && c.is_finite() && 0. <= a && 0. <= b && 0. <= c && a <= c && a - b <= c.max(1.) * 1e-9 && b - c <= c.max(1.) * 1e-9)
        })
    }
}
fn optional_stamp(at: &Option<String>) -> Result<()> {
    if let Some(at) = at {
        stamp(at)?;
    }
    Ok(())
}
fn interval(value: Option<i64>) -> Result<Option<i64>> {
    guard(value.is_none_or(|v| (60_000..=86_400_000).contains(&v)))?;
    Ok(value)
}
fn decode<T: serde::de::DeserializeOwned>(bytes: &[u8], max: usize) -> Result<T> {
    serde_json::from_value(bounded_json(bytes, max)?)
        .map_err(|_| NetworkError::new(ErrorCode::InvalidSchema))
}
impl Snapshot {
    fn decode(
        measurements: &[u8],
        health: Option<&[u8]>,
        revision: u64,
        ids: &BTreeSet<&str>,
        retrieved_at: &str,
        max: usize,
    ) -> Result<Self> {
        let mut envelope: Envelope = decode(measurements, max)?;
        guard(
            envelope.version == 1
                && envelope.inventory_revision == revision
                && envelope.devices.len() <= 64,
        )?;
        stamp(retrieved_at)?;
        stamp(&envelope.generated_at)?;
        envelope.collector.validate()?;
        let mut every = BTreeSet::new();
        for (id, d) in &envelope.devices {
            guard(ids.contains(id.as_str()))?;
            every.insert(id.as_str());
            guard(
                d.series24h.len() <= 1441 && d.hourly7d.len() <= 169 && d.hourly90d.len() <= 2161,
            )?;
            d.latest.validate()?;
            let mut previous = i64::MIN;
            for fact in &d.series24h {
                fact.validate()?;
                let at = stamp(
                    fact.recorded_at
                        .as_deref()
                        .ok_or_else(|| NetworkError::new(ErrorCode::InvalidSchema))?,
                )?;
                guard(at >= previous)?;
                previous = at;
            }
            for hours in [&d.hourly7d, &d.hourly90d] {
                let mut previous = i64::MIN;
                for hour in hours {
                    hour.validate()?;
                    let at = stamp(&hour.hour)?;
                    guard(at > previous)?;
                    previous = at;
                }
            }
            // Truncation is decoded, never interpreted as complete coverage.
            let _ = d.series24h_truncated;
        }
        guard(every == *ids)?;
        // Retain only the bounded UI series, not the raw/90-day response history.
        for d in envelope.devices.values_mut() {
            d.series24h = Vec::new();
            d.hourly90d = Vec::new();
            let skip = d.hourly7d.len().saturating_sub(48);
            d.hourly7d.drain(..skip);
        }
        let health = health
            .and_then(|b| decode::<Health>(b, max).ok())
            .filter(|h| {
                h.version == 1 && h.collector.validate().is_ok() && interval(h.interval_ms).is_ok()
            });
        let ping_interval =
            interval(envelope.interval_ms)?.or_else(|| health.as_ref().and_then(|h| h.interval_ms));
        Ok(Self {
            retrieved_at: retrieved_at.into(),
            health_ok: health.is_some_and(|h| h.ok),
            envelope,
            stale_after_ms: ping_interval.map_or(900_000, |v| v * 3),
        })
    }
    /// Same-source ID lookup only, after the inventory's original native grants.
    pub fn apply(&self, id: &str, now: &str, facts: &mut Value) -> Result<()> {
        let Some(device) = self.envelope.devices.get(id) else {
            return Ok(());
        };
        let latest = &device.latest;
        let measured = self.health_ok && latest.state != "not-measured";
        let now_ms = stamp(now)?;
        let age = latest
            .measured_at
            .as_deref()
            .map(stamp)
            .transpose()?
            .map(|at| stamp(now).map(|now| now - at))
            .transpose()?;
        let fresh = if !measured || age.is_none_or(|age| age < 0) {
            "unknown"
        } else if age.is_some_and(|age| age > self.stale_after_ms) {
            "stale"
        } else {
            "recent"
        };
        facts["status"] = json!(match fresh {
            "recent" => "available",
            "stale" => "stale",
            _ => "unknown",
        });
        facts["freshness"] = json!(fresh);
        facts["lastSeenAt"] = json!(if fresh != "unknown" && latest.state == "reachable" {
            latest.measured_at.as_ref()
        } else {
            None
        });
        facts["sourceSnapshotAt"] = json!(self.envelope.generated_at);
        facts["retrievedAt"] = json!(self.retrieved_at);
        facts["observedState"] = if fresh == "unknown" {
            Value::Null
        } else {
            json!([{
                "id":"collector-reachability", "kind":"measured-reachability", "value":{"state":latest.state},
                "factAt":latest.measured_at,"sourceSnapshotAt":self.envelope.generated_at,"retrievedAt":self.retrieved_at,
                "vantage":"network-collector","invalidatedAt":null,"freshness":fresh
            }])
        };
        facts["latencyMs"] = json!(if fresh != "unknown" {
            latest.latency_ms
        } else {
            None
        });
        facts["loss"] = json!(if fresh != "unknown" {
            latest.loss
        } else {
            None
        });
        facts["recentSeries"] = json!(if self.health_ok {
            device
                .hourly7d
                .iter()
                .filter(|h| stamp(&h.hour).is_ok_and(|at| at <= now_ms))
                .map(|h| json!({"hour":h.hour,"latencyMs":h.mean_ms,"loss":h.loss}))
                .collect::<Vec<_>>()
        } else {
            vec![]
        });
        Ok(())
    }
}
pub(crate) fn unknown(facts: &mut Value) {
    for key in [
        "observedState",
        "lastSeenAt",
        "sourceSnapshotAt",
        "latencyMs",
        "loss",
    ] {
        facts[key] = Value::Null;
    }
    facts["status"] = json!("unknown");
    facts["freshness"] = json!("unknown");
    facts["recentSeries"] = json!([]);
}
pub(crate) fn enrich(
    enabled: bool,
    cached: &Cached,
    generation_id: Option<&str>,
    id: &str,
    now: &str,
    facts: &mut Value,
) -> Result<()> {
    if !enabled || facts["status"] == "absent" {
        return Ok(());
    }
    unknown(facts);
    if let Some(snapshot) = cached
        && generation_id == Some(snapshot.0.as_str())
        && let Some(measurements) = &snapshot.1
    {
        measurements.apply(id, now, facts)?;
    }
    Ok(())
}
pub(crate) async fn read<P: CollectorGetPeer>(
    peer: &P,
    generation: &NetworkGeneration,
    max: usize,
    retrieved_at: impl FnOnce() -> String,
) -> Option<Snapshot> {
    // Always attempt both passive routes, even when health is unavailable.
    let health = peer.get(CollectorRoute::Health).await.ok();
    let measurements = peer.get(CollectorRoute::Measurements).await.ok()?;
    let ids = generation
        .inventory
        .devices
        .iter()
        .map(|d| d.external_id.as_str())
        .collect();
    Snapshot::decode(
        &measurements,
        health.as_deref(),
        generation.source_revision,
        &ids,
        &retrieved_at(),
        max,
    )
    .ok()
}

#[cfg(test)]
mod tests {
    use super::super::ReviewedNetworkOrigin;
    use super::*;
    use std::sync::Mutex;
    const AT: &str = "2026-01-02T12:00:00Z";
    fn body() -> Value {
        let collector = json!({"lastCycleAt":AT,"guardOutcome":"home","schemaVersion":1});
        let fact = json!({"state":"reachable","latencyMs":2.5,"loss":0,"measuredAt":AT,"recordedAt":AT,"reason":null});
        let hour = json!({"hour":AT,"state":"measured","reachable":1,"noReply":0,"notMeasured":0,"minMs":2.5,"meanMs":2.5,"maxMs":2.5,"loss":0});
        json!({"version":1,"inventoryRevision":1,"generatedAt":AT,"collector":collector,"devices":{"device-a":{"latest":fact,"series24h":[fact],"series24hTruncated":false,"hourly7d":[hour],"hourly90d":[hour]}}})
    }
    fn health() -> Vec<u8> {
        serde_json::to_vec(&json!({"version":1,"ok":true,"collector":{"lastCycleAt":AT,"guardOutcome":"home","schemaVersion":1}})).unwrap()
    }
    fn snapshot(value: &Value, health: Option<&[u8]>) -> Result<Snapshot> {
        Snapshot::decode(
            &serde_json::to_vec(value).unwrap(),
            health,
            1,
            &BTreeSet::from(["device-a"]),
            AT,
            1024 * 1024,
        )
    }
    fn facts() -> Value {
        json!({"addresses":["192.0.2.10"],"retrievedAt":AT})
    }
    #[test]
    fn healthy_collector_disabled_and_generation_retirement() {
        let cached = Some(Arc::new((
            "generation-a".into(),
            Some(snapshot(&body(), Some(&health())).unwrap()),
        )));
        let mut f = facts();
        let before = serde_json::to_vec(&f).unwrap();
        enrich(false, &cached, Some("generation-a"), "device-a", AT, &mut f).unwrap();
        assert_eq!(serde_json::to_vec(&f).unwrap(), before);
        enrich(true, &cached, Some("generation-a"), "device-a", AT, &mut f).unwrap();
        assert_eq!(f["status"], "available");
        enrich(true, &cached, Some("generation-b"), "device-a", AT, &mut f).unwrap();
        assert_eq!(f["status"], "unknown");
        enrich(true, &None, Some("generation-a"), "device-a", AT, &mut f).unwrap();
        assert_eq!(f["status"], "unknown");
    }
    #[test]
    fn healthy_collector_origin_forms() {
        for origin in [
            "http://127.0.0.1:42001",
            "http://[::1]:42001",
            "http://127.0.0.1:80",
            "https://network.example.invalid",
        ] {
            let parsed = ReviewedNetworkOrigin::passive(origin).unwrap();
            assert_eq!(parsed.origin(), origin);
            let client = reqwest::Client::builder().no_proxy().build().unwrap();
            for route in ["/api/inventory", "/api/health", "/api/measurements"] {
                let request = parsed.get_request(&client, route).build().unwrap();
                assert_eq!(request.method(), reqwest::Method::GET);
                assert_eq!(request.url().path(), route);
                assert!(request.headers().get(reqwest::header::ORIGIN).is_none());
                if origin.starts_with("http://") {
                    assert_eq!(request.headers()[reqwest::header::HOST], &origin[7..]);
                }
            }
        }
        for origin in [
            "http://localhost:42001",
            "http://127.0.0.2:42001",
            "http://192.0.2.1:42001",
            "http://127.0.0.1",
            "http://[::1]",
            "http://127.0.0.1:0",
            "http://127.0.0.1:65536",
            "http://127.1:42001",
            "http://2130706433:42001",
            "http://127.0.0.1:080",
            "http://user@127.0.0.1:42001",
            "http://127.0.0.1:42001/",
            "http://127.0.0.1:42001/api/inventory",
            "http://127.0.0.1:42001?x=1",
            "http://[0:0:0:0:0:0:0:1]:42001",
        ] {
            assert!(ReviewedNetworkOrigin::passive(origin).is_err(), "{origin}");
        }
        assert!(ReviewedNetworkOrigin::https("http://127.0.0.1:42001").is_err());
    }
    #[test]
    fn healthy_collector_join_and_source_freshness() {
        let mut b = body();
        b["intervalMs"] = json!(60000);
        let s = snapshot(&b, Some(&health())).unwrap();
        let mut f = facts();
        s.apply("device-a", AT, &mut f).unwrap();
        assert_eq!(f["status"], "available");
        assert_eq!(f["latencyMs"], 2.5);
        assert_eq!(f["loss"].as_f64(), Some(0.));
        assert_eq!(f["lastSeenAt"], AT);
        assert_eq!(f["retrievedAt"], AT);
        assert_eq!(f["recentSeries"][0]["latencyMs"], 2.5);
        s.apply("device-a", "2026-01-02T12:03:00Z", &mut f).unwrap();
        assert_eq!(f["freshness"], "recent");
        s.apply("device-a", "2026-01-02T12:03:01Z", &mut f).unwrap();
        assert_eq!(f["freshness"], "stale");
        assert_eq!(f["observedState"][0]["factAt"], AT);
        let mut untouched = facts();
        let before = untouched.clone();
        s.apply("same-name-other-id", AT, &mut untouched).unwrap();
        assert_eq!(untouched, before);
        b.as_object_mut().unwrap().remove("intervalMs");
        let s = snapshot(&b, Some(&health())).unwrap();
        s.apply("device-a", "2026-01-02T12:15:01Z", &mut f).unwrap();
        assert_eq!(f["status"], "stale");
        s.apply("device-a", "2026-01-02T11:59:59Z", &mut f).unwrap();
        assert_eq!(f["status"], "unknown");
    }
    #[test]
    fn healthy_collector_no_reply_and_unknown() {
        let mut b = body();
        let latest = &mut b["devices"]["device-a"]["latest"];
        latest["state"] = json!("no-reply");
        latest["latencyMs"] = Value::Null;
        latest["loss"] = json!(1);
        let mut f = facts();
        snapshot(&b, Some(&health()))
            .unwrap()
            .apply("device-a", AT, &mut f)
            .unwrap();
        assert_eq!(f["status"], "available");
        assert_eq!(f["observedState"][0]["value"]["state"], "no-reply");
        assert_eq!(f["lastSeenAt"], Value::Null);
        assert_eq!(f["loss"].as_f64(), Some(1.));
        for health in [None,Some(b"{}".as_slice()),Some(b"{\"version\":1,\"ok\":false,\"collector\":{\"lastCycleAt\":null,\"guardOutcome\":\"unknown\",\"schemaVersion\":1}}".as_slice())] {
            snapshot(&b,health).unwrap().apply("device-a",AT,&mut f).unwrap(); assert_eq!(f["status"],"unknown"); assert_eq!(f["observedState"],Value::Null); assert_eq!(f["loss"],Value::Null);
        }
        b["devices"]["device-a"]["latest"] = json!({"state":"not-measured","latencyMs":null,"loss":null,"measuredAt":null,"recordedAt":AT,"reason":"no-target"});
        snapshot(&b, Some(&health()))
            .unwrap()
            .apply("device-a", AT, &mut f)
            .unwrap();
        assert_eq!(f["status"], "unknown");
    }
    #[test]
    fn healthy_collector_strict_decode_and_bounds() {
        // Collector floating-point summation can put a mean just outside min/max.
        for loss in [-1e-13, 1.0 + 1e-13] {
            let mut b = body();
            let h = &mut b["devices"]["device-a"]["hourly7d"][0];
            if loss > 1.0 {
                h["reachable"] = json!(0);
                h["noReply"] = json!(1);
                for key in ["minMs", "meanMs", "maxMs"] {
                    h[key] = Value::Null;
                }
            }
            h["loss"] = json!(loss);
            assert!(snapshot(&b, Some(&health())).is_err());
        }
        let mut rounded = body();
        rounded["devices"]["device-a"]["hourly7d"][0]["meanMs"] = json!(2.5 - f64::EPSILON * 2.);
        assert!(snapshot(&rounded, Some(&health())).is_ok());
        for mutate in [
            |b: &mut Value| b["version"] = json!(2),
            |b: &mut Value| b["inventoryRevision"] = json!(2),
            |b: &mut Value| b["extra"] = json!(true),
            |b: &mut Value| b["devices"]["device-a"]["latest"]["loss"] = json!(0.5),
            |b: &mut Value| b["devices"]["device-a"]["latest"]["measuredAt"] = json!("bad"),
            |b: &mut Value| {
                b["devices"].as_object_mut().unwrap().remove("device-a");
            },
            |b: &mut Value| b["devices"]["device-a"]["hourly7d"][0]["loss"] = json!(1),
        ] {
            let mut b = body();
            mutate(&mut b);
            assert!(snapshot(&b, Some(&health())).is_err());
        }
        assert!(Snapshot::decode(b"{}", Some(&health()), 1, &BTreeSet::new(), AT, 1).is_err());
        let mut b = body();
        b["devices"]["device-a"]["hourly7d"] = json!(
            (0..60)
                .map(|i| {
                    let mut h = b["devices"]["device-a"]["hourly90d"][0].clone();
                    h["hour"] = json!(
                        chrono::DateTime::from_timestamp_millis(
                            stamp(AT).unwrap() + (i - 59) * 3_600_000
                        )
                        .unwrap()
                        .to_rfc3339()
                    );
                    h
                })
                .collect::<Vec<_>>()
        );
        let mut f = facts();
        snapshot(&b, Some(&health()))
            .unwrap()
            .apply("device-a", AT, &mut f)
            .unwrap();
        assert_eq!(f["recentSeries"].as_array().unwrap().len(), 48);
        unknown(&mut f);
        assert_eq!(f["status"], "unknown");
        assert_eq!(f["recentSeries"], json!([]));
    }
    struct Peer {
        calls: Mutex<Vec<CollectorRoute>>,
        bad: bool,
    }
    impl CollectorGetPeer for Peer {
        fn get(
            &self,
            route: CollectorRoute,
        ) -> Pin<Box<dyn Future<Output = Result<Vec<u8>>> + Send + '_>> {
            self.calls.lock().unwrap().push(route);
            Box::pin(async move {
                Ok(match route {
                    CollectorRoute::Health => health(),
                    CollectorRoute::Measurements => {
                        if self.bad {
                            b"{\"version\":2}".to_vec()
                        } else {
                            serde_json::to_vec(&body()).unwrap()
                        }
                    }
                })
            })
        }
    }
    #[tokio::test]
    async fn healthy_collector_fake_get_peer_preserves_inventory() {
        let source = SourceRegistration {
            scope: SourceScope {
                workspace_id: "00000000-0000-4000-8000-000000000001".into(),
                home_id: "00000000-0000-4000-8000-000000000002".into(),
                source_instance_id: "00000000-0000-4000-8000-000000000003".into(),
                collection_id: "inventory".into(),
            },
            owner: "network".into(),
            partition_mode: PartitionMode::ExclusiveHome,
            allowed_external_ids: vec![],
        };
        let wire = serde_json::to_vec(&json!({"revision":1,"inventory":{"rooms":[],"devices":[{"id":"device-a","name":"Example device","kind":"computer"}],"interfaces":[],"segments":[],"links":[],"positions":{}}})).unwrap();
        let generation = super::super::project_capture(
            &source,
            super::super::NetworkCapture {
                source: &source.scope,
                document: &wire,
                retrieved_at: AT,
                source_snapshot_at: None,
            },
            &LinkReview {
                revision: 1,
                links: BTreeMap::new(),
            },
            Limits::default(),
        )
        .unwrap();
        let before = serde_json::to_vec(&generation).unwrap();
        for bad in [false, true] {
            let peer = Peer {
                calls: Mutex::default(),
                bad,
            };
            let snapshot = read(&peer, &generation, 1024 * 1024, || AT.into()).await;
            assert_eq!(snapshot.is_some(), !bad);
            assert_eq!(
                *peer.calls.lock().unwrap(),
                vec![CollectorRoute::Health, CollectorRoute::Measurements]
            );
            assert_eq!(serde_json::to_vec(&generation).unwrap(), before);
        }
    }
}
