use super::*;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
pub(crate) const AT: &str = "2026-01-02T12:00:00Z";
pub(crate) fn speed() -> Value {
    json!({"state":"measured","recordedAt":AT,"downloadBitsPerSecond":12000000,"uploadBitsPerSecond":3000000,"latencyMs":4,"reason":null})
}
pub(crate) fn results() -> Value {
    json!({"version":1,"speed":{"latest":speed(),"recent":[speed()]},"wifi":{"latest":{"state":"unavailable","recordedAt":AT,"networks":null,"reason":"no-dependable-unprivileged-scanner"}},"actions":[]})
}
pub(crate) fn measurements(revision: u64) -> Value {
    let fact = json!({"state":"reachable","latencyMs":2,"loss":0,"measuredAt":AT,"recordedAt":AT,"reason":null});
    let device = json!({"latest":fact,"series24h":[],"series24hTruncated":false,"hourly7d":[],"hourly90d":[]});
    json!({"version":1,"inventoryRevision":revision,"generatedAt":AT,"collector":{"schemaVersion":1,"guardOutcome":"home","lastCycleAt":AT},"devices":{"device-a":device,"device-b":device},"intervalMs":60000})
}
pub(crate) struct FakePeer {
    pub calls: Mutex<Vec<CollectorRoute>>,
    pub posts: AtomicUsize,
    pub revision: std::sync::atomic::AtomicU64,
    pub mode: AtomicUsize,
    pub bad_measurements: AtomicBool,
    pub bad_results: AtomicBool,
}
impl Default for FakePeer {
    fn default() -> Self {
        Self {
            calls: Mutex::default(),
            posts: AtomicUsize::new(0),
            revision: std::sync::atomic::AtomicU64::new(42),
            mode: AtomicUsize::new(0),
            bad_measurements: AtomicBool::new(false),
            bad_results: AtomicBool::new(false),
        }
    }
}
impl CollectorGetPeer for FakePeer {
    fn get(
        &self,
        route: CollectorRoute,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<u8>>> + Send + '_>> {
        self.calls.lock().unwrap().push(route);
        Box::pin(async move {
            if route == CollectorRoute::Results && self.mode.load(Ordering::SeqCst) == 5 {
                return std::future::pending().await;
            }
            Ok(serde_json::to_vec(&match route {
            CollectorRoute::Health=>json!({"version":1,"ok":true,"collector":{"lastCycleAt":AT,"guardOutcome":"home","schemaVersion":1}}),
            CollectorRoute::Measurements=>if self.bad_measurements.load(Ordering::SeqCst) {json!({"version":2})} else {measurements(self.revision.load(Ordering::SeqCst))},
            CollectorRoute::Results=>if self.bad_results.load(Ordering::SeqCst) {json!({"version":2})} else {results()},
        }).unwrap())
        })
    }
}
impl Peer for FakePeer {
    fn post(&self, body: Vec<u8>) -> ResponseFuture<'_> {
        self.posts.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move {
            match self.mode.load(Ordering::SeqCst) {
                1 => Ok((409, br#"{"error":"busy"}"#.to_vec())),
                2 => Err(NetworkError::new(ErrorCode::Timeout)),
                3 => Ok((400, br#"{"error":"invalid-action"}"#.to_vec())),
                _ => {
                    let action = Action::parse(&body)?;
                    let mut value = serde_json::to_value(&action).unwrap();
                    value["version"] = json!(1);
                    value["recordedAt"] = json!(AT);
                    value["result"] = match action {
                        Action::Speed => speed(),
                        Action::Ping { .. } => {
                            measurements(42)["devices"]["device-a"]["latest"].clone()
                        }
                        Action::Port { .. } => json!({"state":"open","reason":null}),
                    };
                    Ok((200, serde_json::to_vec(&value).unwrap()))
                }
            }
        })
    }
}
#[test]
fn healthy_results_strict_v1_and_bounds() {
    let bytes = serde_json::to_vec(&results()).unwrap();
    let decoded = Results::decode(&bytes, AT.into()).unwrap();
    assert_eq!(decoded.value["wifi"]["latest"]["state"], "unavailable");
    assert_eq!(
        decoded.value["speed"]["latest"]["downloadBitsPerSecond"],
        12000000
    );
    for mutate in [
        |v: &mut Value| v["version"] = json!(2),
        |v: &mut Value| v["extra"] = json!(true),
        |v: &mut Value| v["speed"]["latest"]["downloadBitsPerSecond"] = json!(-1),
        |v: &mut Value| v["wifi"]["latest"]["networks"] = json!([]),
        |v: &mut Value| v["actions"] = json!([{"kind":"other"}]),
    ] {
        let mut value = results();
        mutate(&mut value);
        assert!(Results::decode(&serde_json::to_vec(&value).unwrap(), AT.into()).is_err());
    }
    for bytes in [b"not-json".as_slice(), br#"{"version":1,"version":1}"#] {
        assert!(Results::decode(bytes, AT.into()).is_err());
    }
    // Collector history is insertion-ordered, not wall-clock-sorted: retain
    // original dates honestly across a host clock correction.
    let mut corrected = results();
    let mut later = speed();
    later["recordedAt"] = json!("2026-01-02T12:01:00Z");
    corrected["speed"]["recent"] = json!([speed(), later]);
    let decoded = Results::decode(&serde_json::to_vec(&corrected).unwrap(), AT.into()).unwrap();
    assert_eq!(
        decoded.value["speed"]["recent"],
        corrected["speed"]["recent"]
    );
    let mut value = results();
    value["speed"]["recent"] = json!(vec![speed(); 400]);
    assert_eq!(
        Results::decode(&serde_json::to_vec(&value).unwrap(), AT.into())
            .unwrap()
            .value["speed"]["recent"]
            .as_array()
            .unwrap()
            .len(),
        30
    );
    value["speed"]["recent"] = json!(vec![speed(); 401]);
    assert!(Results::decode(&serde_json::to_vec(&value).unwrap(), AT.into()).is_err());
}
#[tokio::test(start_paused = true)]
async fn healthy_observations_join_failure_and_retention() {
    let holder = Holder::default();
    let peer = FakePeer::default();
    assert!(holder.poll(&peer, &|| AT.into()).await);
    let observed = holder.snapshot().unwrap();
    let later = Snapshot::decode_live(
        &serde_json::to_vec(&measurements(42)).unwrap(),
        None,
        "2026-01-02T12:00:01Z",
        MAX_BYTES,
    )
    .unwrap();
    assert!(!observed.newer_than(Some(&later)));
    assert!(observed.newer_than(observed.measurements.as_ref()));

    assert_eq!(
        *peer.calls.lock().unwrap(),
        vec![
            CollectorRoute::Health,
            CollectorRoute::Measurements,
            CollectorRoute::Results
        ]
    );
    let mut facts = json!({});
    observed
        .enrich(Some(42), "device-a", AT, &mut facts)
        .unwrap();
    assert_eq!(facts["latencyMs"], 2.0);
    observed
        .enrich(Some(43), "device-a", AT, &mut facts)
        .unwrap();
    assert_eq!(facts["status"], "unknown");
    assert_eq!(
        observed.reason(Some(43), AT),
        Some("inventory-revision-mismatch")
    );
    observed
        .enrich(Some(42), "device-a", "2026-01-02T12:03:01Z", &mut facts)
        .unwrap();
    assert_eq!(facts["status"], "stale");
    observed
        .enrich(Some(42), "device-a", "2026-01-03T12:00:01Z", &mut facts)
        .unwrap();
    assert_eq!(facts["status"], "unknown");
    peer.bad_results.store(true, Ordering::SeqCst);
    assert!(!holder.poll(&peer, &|| AT.into()).await);
    let current = holder.snapshot().unwrap();
    assert!(current.results.is_none());
    assert!(current.measurements.is_some());
    peer.bad_measurements.store(true, Ordering::SeqCst);
    assert!(!holder.poll(&peer, &|| "2026-01-02T12:04:00Z".into()).await);
    assert_eq!(
        holder
            .snapshot()
            .unwrap()
            .measurements
            .as_ref()
            .unwrap()
            .retrieved_at(),
        AT
    );
    peer.bad_measurements.store(false, Ordering::SeqCst);
    peer.mode.store(5, Ordering::SeqCst);
    assert!(
        tokio::time::timeout(
            Duration::from_secs(30),
            holder.poll(&peer, &|| "2026-01-02T12:05:00Z".into())
        )
        .await
        .is_err()
    );
    let hung = holder.snapshot().unwrap();
    assert!(hung.results.is_none());
    assert_eq!(
        hung.measurements.as_ref().unwrap().retrieved_at(),
        "2026-01-02T12:05:00Z"
    );
}
#[test]
fn healthy_action_contract_and_correlation() {
    for body in [
        br#"{"kind":"speed","deviceId":"device-a"}"#.as_slice(),
        br#"{"kind":"ping","deviceId":""}"#,
        br#"{"kind":"port","deviceId":"device-a","port":0}"#,
        br#"{"kind":"speed","kind":"speed"}"#,
    ] {
        assert!(Action::parse(body).is_err());
    }
    let action = Action::Speed;
    assert_eq!(
        decode_action(409, br#"{"error":"busy"}"#, &action).unwrap()["status"],
        "busy"
    );
    assert_eq!(
        decode_action(400, br#"{"error":"invalid-action"}"#, &action).unwrap()["status"],
        "refused"
    );
    assert!(decode_action(200, b"{}", &action).is_err());
}
async fn tick(seconds: u64) {
    tokio::time::advance(Duration::from_secs(seconds)).await;
    tokio::task::yield_now().await;
}
#[tokio::test(start_paused = true)]
async fn healthy_periodic_slots_backoff_and_shutdown() {
    let stop = CancellationToken::new();
    let calls = Arc::new(AtomicUsize::new(0));
    let count = calls.clone();
    let worker = tokio::spawn(run(Duration::from_secs(60), stop.clone(), move || {
        let n = count.fetch_add(1, Ordering::SeqCst);
        async move { n > 1 }
    }));
    tick(0).await;
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    tick(59).await;
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    tick(1).await;
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    tick(60).await;
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    for _ in 0..3 {
        tick(60).await;
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }
    tick(60).await;
    assert_eq!(calls.load(Ordering::SeqCst), 3);
    tick(60).await;
    assert_eq!(calls.load(Ordering::SeqCst), 4);
    stop.cancel();
    worker.await.unwrap();
    tick(600).await;
    assert_eq!(calls.load(Ordering::SeqCst), 4);
}
#[tokio::test(start_paused = true)]
async fn healthy_periodic_deadline_no_overlap_and_cancel_inflight() {
    let stop = CancellationToken::new();
    let calls = Arc::new(AtomicUsize::new(0));
    let count = calls.clone();
    let active = Arc::new(AtomicUsize::new(0));
    let running = active.clone();
    struct Flight(Arc<AtomicUsize>);
    impl Drop for Flight {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::SeqCst);
        }
    }
    let worker = tokio::spawn(run(Duration::from_secs(10), stop.clone(), move || {
        count.fetch_add(1, Ordering::SeqCst);
        assert_eq!(running.fetch_add(1, Ordering::SeqCst), 0);
        let guard = Flight(running.clone());
        async move {
            let _guard = guard;
            std::future::pending::<bool>().await
        }
    }));
    tick(0).await;
    tick(29).await;
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(active.load(Ordering::SeqCst), 1);
    tick(1).await;
    assert_eq!(active.load(Ordering::SeqCst), 0);
    tick(10).await;
    tick(10).await;
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    stop.cancel();
    worker.await.unwrap();
    assert_eq!(active.load(Ordering::SeqCst), 0);
    // Empty task sets represent absent configuration: no polling closure exists.
    let empty = Pollers::new();
    assert!(empty.jobs.is_empty());
    empty.shutdown().await;
}
