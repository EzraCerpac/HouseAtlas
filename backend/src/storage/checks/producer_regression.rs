//! Explicit isolated cases for live producer custody. No dispatch or transport.
use super::*;
use std::path::Path;

type Activity = s::StockActivitySession<
    s::NativeContract<NativeSemantics>,
    NativeReadAuthority,
    Clock,
    Original,
    Peers,
    Peers,
>;

pub(super) fn run(
    case: &str,
    root: &Path,
    database: &Path,
    activity: &Activity,
    peers: &Peers,
    store: &Arc<Mutex<Store>>,
) -> Check<()> {
    let command = &peers.0.command;
    let authority = &peers.0.authority;
    let original = &peers.0.original;
    let second = || {
        s::StockActivitySession::new(
            store.clone(),
            peers.0.access.clone(),
            original.clone(),
            Arc::new(peers.clone()),
            Arc::new(peers.clone()),
            peers.0.registration.clone(),
            command.clone(),
            authority.clone(),
        )
        .map_err(|e| format!("second original session: {e:?}"))
    };
    let operation_id = match case {
        "producer-postcommit-failure" => {
            peers.0.regression_failure.store(2, Ordering::SeqCst);
            assert!(matches!(
                ready(n::StockActivityPort::reserve(activity, command, authority)),
                Err(n::StockPortFault::Unavailable)
            ));
            // SQL identifies the committed row; only the original session can
            // retain its independently held membership and original principal.
            let id = retained_row(database)?;
            let producer = activity
                .retain_producer(id)
                .map_err(|e| format!("postcommit original membership: {e:?}"))?;
            assert!(std::ptr::eq(producer.original(), Arc::as_ptr(original)));
            assert_eq!(producer.record().events().len(), 1);
            assert_eq!(producer.record().original().command, *command);
            assert!(matches!(
                second()?.retain_producer(id),
                Err(n::StockPortFault::EvidenceConflict)
            ));
            id
        }
        "producer-precommit-denial" => {
            peers.0.regression_failure.store(1, Ordering::SeqCst);
            assert!(matches!(
                ready(n::StockActivityPort::reserve(activity, command, authority)),
                Err(n::StockPortFault::EvidenceConflict)
            ));
            let db = rusqlite::Connection::open(database)?;
            for table in ["stock_activity_operations", "stock_activity_events"] {
                let count: i64 =
                    db.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))?;
                assert_eq!(count, 0);
            }
            assert!(matches!(
                activity.retain_producer(id(1000)),
                Err(n::StockPortFault::EvidenceConflict)
            ));
            // A separate new allocation after the injected refusal remains
            // ordinary; no producer eligibility leaks from the rolled-back ID.
            let reservation = ready(n::StockActivityPort::reserve(activity, command, authority))
                .map_err(|e| format!("new reservation after refusal: {e:?}"))?;
            let n::StockReservation::Reserved(operation) = reservation else {
                return Err("Fresh reservation expected after rollback".into());
            };
            assert_ne!(operation.operation_id, id(1000));
            activity
                .retain_producer(operation.operation_id)
                .map_err(|e| format!("new original membership: {e:?}"))?;
            operation.operation_id
        }
        "producer-concurrent-reservation" => {
            let other = second()?;
            let start = std::sync::Barrier::new(2);
            let (left, right) = std::thread::scope(|scope| {
                let one = scope.spawn(|| {
                    start.wait();
                    ready(n::StockActivityPort::reserve(activity, command, authority))
                });
                let two = scope.spawn(|| {
                    start.wait();
                    ready(n::StockActivityPort::reserve(&other, command, authority))
                });
                (one.join(), two.join())
            });
            let left = left
                .map_err(|_| "First reservation thread panicked")?
                .map_err(|e| format!("first reservation: {e:?}"))?;
            let right = right
                .map_err(|_| "Second reservation thread panicked")?
                .map_err(|e| format!("second reservation: {e:?}"))?;
            let (owner, observer, id) = match (&left, &right) {
                (n::StockReservation::Reserved(a), n::StockReservation::Existing(b)) if a == b => {
                    (activity, &other, a.operation_id)
                }
                (n::StockReservation::Existing(a), n::StockReservation::Reserved(b)) if a == b => {
                    (&other, activity, b.operation_id)
                }
                _ => {
                    return Err(
                        "Concurrent first reservations did not converge on one creator".into(),
                    );
                }
            };
            let producer = owner
                .retain_producer(id)
                .map_err(|e| format!("concurrent creator membership: {e:?}"))?;
            assert!(std::ptr::eq(producer.original(), Arc::as_ptr(original)));
            assert_eq!(producer.record().events().len(), 1);
            assert!(matches!(
                observer.retain_producer(id),
                Err(n::StockPortFault::EvidenceConflict)
            ));
            assert_eq!(retained_row(database)?, id);
            id
        }
        _ => return Err("Case is outside explicit producer regression allowlist".into()),
    };
    assert_eq!(peers.0.dispatches.load(Ordering::SeqCst), 0);
    assert_eq!(peers.0.readbacks.load(Ordering::SeqCst), 0);
    let result = json!({"case":case,"result":"pass","operationId":operation_id,
        "scope":"fresh disposable synthetic SQLite; actual original Access/session and Store; no dispatch/transport",
        "policy":"isolated concurrency, denial and failure lane; other held classes unrun"});
    std::fs::write(
        root.join("regression-evidence.json"),
        serde_json::to_vec_pretty(&result)?,
    )?;
    println!("{result}");
    Ok(())
}

fn retained_row(database: &Path) -> Check<Uuid> {
    let db = rusqlite::Connection::open(database)?;
    let count: i64 = db.query_row("SELECT count(*) FROM stock_activity_operations", [], |r| {
        r.get(0)
    })?;
    assert_eq!(count, 1);
    let count: i64 = db.query_row("SELECT count(*) FROM stock_activity_events", [], |r| {
        r.get(0)
    })?;
    assert_eq!(count, 1);
    let id: String = db.query_row(
        "SELECT operation_id FROM stock_activity_operations",
        [],
        |r| r.get(0),
    )?;
    Ok(Uuid::parse_str(&id)?)
}
