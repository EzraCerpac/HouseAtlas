//! Process-local collector observations. No Core, principal, archive or publication.
use super::{
    collector::{self, CollectorGetPeer, CollectorRoute, Snapshot},
    json::bounded_json,
    model::*,
    projection::stamp,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

pub(crate) const MAX_BYTES: usize = 10 * 1024 * 1024;
pub(crate) const ACTION_TIMEOUT: Duration = Duration::from_secs(125);
#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub(crate) enum Action {
    Speed,
    Ping {
        #[serde(rename = "deviceId")]
        device_id: String,
    },
    Port {
        #[serde(rename = "deviceId")]
        device_id: String,
        port: u16,
    },
}
impl Action {
    pub(crate) fn parse(bytes: &[u8]) -> Result<Self> {
        let value = bounded_json(bytes, 8192)?;
        let keys: &[&str] = match value["kind"].as_str() {
            Some("speed") => &["kind"],
            Some("ping") => &["kind", "deviceId"],
            Some("port") => &["kind", "deviceId", "port"],
            _ => return Err(invalid()),
        };
        object(&value, keys)?;
        let action: Self = serde_json::from_value(value).map_err(|_| invalid())?;
        guard(
            action
                .device_id()
                .is_none_or(|id| !id.is_empty() && id.encode_utf16().count() <= 4096),
        )?;
        guard(!matches!(action, Self::Port { port: 0, .. }))?;
        Ok(action)
    }
    pub(crate) fn device_id(&self) -> Option<&str> {
        match self {
            Self::Speed => None,
            Self::Ping { device_id } | Self::Port { device_id, .. } => Some(device_id),
        }
    }
}
pub(crate) type ResponseFuture<'a> =
    Pin<Box<dyn Future<Output = Result<(u16, Vec<u8>)>> + Send + 'a>>;
pub(crate) trait Peer: CollectorGetPeer + Send + Sync {
    fn post(&self, body: Vec<u8>) -> ResponseFuture<'_>;
}
fn invalid() -> NetworkError {
    NetworkError::new(ErrorCode::InvalidSchema)
}
fn object<'a>(v: &'a Value, keys: &[&str]) -> Result<&'a serde_json::Map<String, Value>> {
    let r = v.as_object().ok_or_else(invalid)?;
    guard(r.len() == keys.len() && keys.iter().all(|k| r.contains_key(*k)))?;
    Ok(r)
}
fn at(v: &Value) -> Result<()> {
    stamp(v.as_str().ok_or_else(invalid)?).map(|_| ())
}
fn metric(v: &Value, max: f64) -> bool {
    v.is_null()
        || v.as_f64()
            .is_some_and(|v| v.is_finite() && (0.0..=max).contains(&v))
}
fn speed(v: &Value) -> Result<()> {
    object(
        v,
        &[
            "state",
            "recordedAt",
            "downloadBitsPerSecond",
            "uploadBitsPerSecond",
            "latencyMs",
            "reason",
        ],
    )?;
    at(&v["recordedAt"])?;
    guard(
        metric(&v["downloadBitsPerSecond"], 1e13)
            && metric(&v["uploadBitsPerSecond"], 1e13)
            && metric(&v["latencyMs"], 120000.0),
    )?;
    guard(match v["state"].as_str() {
        Some("measured") => {
            v["reason"].is_null()
                && ["downloadBitsPerSecond", "uploadBitsPerSecond", "latencyMs"]
                    .iter()
                    .all(|k| !v[k].is_null())
        }
        Some("failed") => matches!(
            v["reason"].as_str(),
            Some("command-unavailable" | "tool-error")
        ),
        Some("unknown") => matches!(
            v["reason"].as_str(),
            Some("missing-fields" | "malformed-output")
        ),
        _ => false,
    })
}
fn action_result(v: &Value, versioned: bool) -> Result<()> {
    let kind = v["kind"].as_str().ok_or_else(invalid)?;
    let mut keys = vec!["kind", "recordedAt", "result"];
    if versioned {
        keys.push("version");
        guard(v["version"] == 1)?;
    }
    if matches!(kind, "ping" | "port") {
        keys.push("deviceId");
    }
    if kind == "port" {
        keys.push("port");
    }
    object(v, &keys)?;
    let mut request = json!({"kind":kind});
    if keys.contains(&"deviceId") {
        request["deviceId"] = v["deviceId"].clone();
    }
    if keys.contains(&"port") {
        request["port"] = v["port"].clone();
    }
    Action::parse(&serde_json::to_vec(&request).map_err(|_| invalid())?)?;
    at(&v["recordedAt"])?;
    match kind {
        "speed" => speed(&v["result"]),
        "port" => {
            object(&v["result"], &["state", "reason"])?;
            guard(
                (v["result"]["state"] == "open" && v["result"]["reason"].is_null())
                    || (v["result"]["state"] == "unknown"
                        && matches!(
                            v["result"]["reason"].as_str(),
                            Some("no-target" | "not-at-home" | "command-unavailable")
                        )),
            )
        }
        "ping" => collector::validate_fact(&v["result"]),
        _ => Err(invalid()),
    }
}
#[derive(Clone)]
pub(crate) struct Results {
    pub value: Value,
    pub retrieved_at: String,
}
impl Results {
    pub(crate) fn decode(bytes: &[u8], retrieved_at: String) -> Result<Self> {
        let mut v = bounded_json(bytes, MAX_BYTES)?;
        object(&v, &["version", "speed", "wifi", "actions"])?;
        guard(v["version"] == 1)?;
        object(&v["speed"], &["latest", "recent"])?;
        object(&v["wifi"], &["latest"])?;
        at(&json!(retrieved_at))?;
        if !v["speed"]["latest"].is_null() {
            speed(&v["speed"]["latest"])?;
        }
        let recent = v["speed"]["recent"].as_array().ok_or_else(invalid)?;
        guard(recent.len() <= 400)?;
        for row in recent {
            speed(row)?;
        }
        if !v["wifi"]["latest"].is_null() {
            let wifi = &v["wifi"]["latest"];
            object(wifi, &["state", "recordedAt", "networks", "reason"])?;
            guard(
                wifi["state"] == "unavailable"
                    && wifi["networks"].is_null()
                    && wifi["reason"] == "no-dependable-unprivileged-scanner",
            )?;
            at(&wifi["recordedAt"])?;
        }
        let actions = v["actions"].as_array().ok_or_else(invalid)?;
        guard(actions.len() <= 200)?;
        for row in actions {
            action_result(row, false)?;
        }
        v["speed"]["recent"]
            .as_array_mut()
            .ok_or_else(invalid)?
            .truncate(30);
        v["actions"]
            .as_array_mut()
            .ok_or_else(invalid)?
            .truncate(30);
        Ok(Self {
            value: v,
            retrieved_at,
        })
    }
}
pub(crate) fn decode_action(status: u16, bytes: &[u8], action: &Action) -> Result<Value> {
    let v = bounded_json(bytes, 64 * 1024)?;
    if status == 200 {
        action_result(&v, true)?;
        let expected = serde_json::to_value(action).map_err(|_| invalid())?;
        for (key, value) in expected.as_object().ok_or_else(invalid)? {
            guard(v[key] == *value)?;
        }
        return Ok(json!({"status":"completed","collectorStatus":status,"result":v}));
    }
    object(&v, &["error"])?;
    guard(matches!(
        (status, v["error"].as_str()),
        (409, Some("busy"))
            | (403, Some("request-refused"))
            | (415, Some("content-type"))
            | (413, Some("body-limit"))
            | (400, Some("invalid-action" | "unknown-device"))
            | (503, Some("shutdown"))
    ))?;
    Ok(
        json!({"status":if status==409 {"busy"} else {"refused"},"collectorStatus":status,"reason":v["error"]}),
    )
}
#[derive(Clone, Default)]
pub(crate) struct Observations {
    pub attempted: bool,
    pub measurements: Option<Snapshot>,
    pub results: Option<Results>,
}
#[derive(Default)]
pub struct Holder(Mutex<Arc<Observations>>);
impl Holder {
    pub(crate) fn snapshot(&self) -> Result<Arc<Observations>> {
        Ok(self.0.lock().map_err(|_| invalid())?.clone())
    }
    pub(crate) async fn poll(&self, peer: &dyn Peer, clock: &(dyn Fn() -> String + Sync)) -> bool {
        // Retire results before the first await, including whole-poll timeout or
        // cancellation. The last measured snapshot keeps ageing independently.
        if let Ok(mut slot) = self.0.lock() {
            *slot = Arc::new(Observations {
                attempted: true,
                measurements: slot.measurements.clone(),
                results: None,
            });
        }
        let health = peer.get(CollectorRoute::Health).await.ok();
        let measurements = peer
            .get(CollectorRoute::Measurements)
            .await
            .ok()
            .and_then(|b| Snapshot::decode_live(&b, health.as_deref(), &clock(), MAX_BYTES).ok());
        let measurements_ok = measurements.as_ref().is_some_and(Snapshot::healthy);
        // A slow results GET must not discard already decoded measurements.
        if let Ok(mut slot) = self.0.lock() {
            *slot = Arc::new(Observations {
                attempted: true,
                measurements: measurements.or_else(|| slot.measurements.clone()),
                results: None,
            });
        }
        let results = peer
            .get(CollectorRoute::Results)
            .await
            .ok()
            .and_then(|b| Results::decode(&b, clock()).ok());
        let success = measurements_ok && results.is_some();
        if let Ok(mut slot) = self.0.lock() {
            // Failed measurements retain their original retrieval and source dates;
            // no poll success timestamp is substituted for missing collection.
            *slot = Arc::new(Observations {
                attempted: true,
                measurements: slot.measurements.clone(),
                results,
            });
        }
        success
    }
}
impl Observations {
    pub(crate) fn newer_than(&self, legacy: Option<&Snapshot>) -> bool {
        legacy.is_none_or(|old| {
            self.measurements.as_ref().is_some_and(|current| {
                stamp(current.retrieved_at())
                    .ok()
                    .zip(stamp(old.retrieved_at()).ok())
                    .is_some_and(|(a, b)| a >= b)
            })
        })
    }
    pub(crate) fn revision(&self) -> Option<u64> {
        self.measurements.as_ref().map(Snapshot::revision)
    }
    pub(crate) fn reason(&self, revision: Option<u64>, now: &str) -> Option<&'static str> {
        match &self.measurements {
            None => Some("not-observed"),
            Some(m) if Some(m.revision()) != revision => Some("inventory-revision-mismatch"),
            Some(m)
                if stamp(now)
                    .ok()
                    .zip(stamp(m.retrieved_at()).ok())
                    .is_none_or(|(n, r)| n < r || n - r > 86_400_000) =>
            {
                Some("observations-expired")
            }
            _ => None,
        }
    }
    pub(crate) fn enrich(
        &self,
        revision: Option<u64>,
        id: &str,
        now: &str,
        facts: &mut Value,
    ) -> Result<()> {
        collector::unknown(facts);
        if self.reason(revision, now).is_none()
            && let Some(m) = &self.measurements
        {
            m.apply(id, now, facts)?;
        }
        Ok(())
    }
    pub(crate) fn results(&self) -> Value {
        match &self.results {
            Some(r) => json!({"status":"available","retrievedAt":r.retrieved_at,"results":r.value}),
            None => json!({"status":"unknown","retrievedAt":null,"results":null}),
        }
    }
}
/// An owned service task set. Drop also cancels/aborts on startup or serving errors.
pub struct Pollers {
    cancellation: CancellationToken,
    jobs: Vec<tokio::task::JoinHandle<()>>,
}
impl Pollers {
    pub(crate) fn new() -> Self {
        Self {
            cancellation: CancellationToken::new(),
            jobs: vec![],
        }
    }
    pub(crate) fn push(&mut self, holder: Arc<Holder>, peer: Arc<dyn Peer>, interval: Duration) {
        let stop = self.cancellation.clone();
        self.jobs.push(tokio::spawn(async move {
            run(interval, stop, || {
                holder.poll(peer.as_ref(), &|| crate::app::now().unwrap_or_default())
            })
            .await;
        }));
    }
    pub fn cancel(&self) {
        self.cancellation.cancel();
    }
    pub fn cancellation(&self) -> CancellationToken {
        self.cancellation.clone()
    }
    pub async fn shutdown(mut self) {
        self.cancel();
        for job in self.jobs.drain(..) {
            let _ = job.await;
        }
    }
}
impl Drop for Pollers {
    fn drop(&mut self) {
        self.cancel();
        for job in &self.jobs {
            job.abort();
        }
    }
}
/// Fixed monotonic slots, skipped missed ticks, no jitter or catch-up. The
/// awaited poll owns the only flight. Failure skips 1/3/7/15 slots (cap 16x).
pub(crate) async fn run<F, Fut>(period: Duration, stop: CancellationToken, mut poll: F)
where
    F: FnMut() -> Fut,
    Fut: Future<Output = bool>,
{
    let mut ticks = tokio::time::interval(period);
    ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut failures = 0u32;
    let mut skip = 0;
    loop {
        tokio::select! {biased; _=stop.cancelled()=>break, _=ticks.tick()=>{}}
        if skip > 0 {
            skip -= 1;
            continue;
        }
        let success = tokio::select! {biased; _=stop.cancelled()=>break, result=tokio::time::timeout(Duration::from_secs(30),poll())=>result.unwrap_or(false)};
        failures = if success { 0 } else { (failures + 1).min(4) };
        skip = (1u32 << failures) - 1;
    }
}

#[cfg(test)]
pub(crate) mod tests;
