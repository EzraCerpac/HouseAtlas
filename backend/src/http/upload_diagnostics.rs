//! Best-effort private upload telemetry, never a receipt or retry authority.
//! All request work uses try_send into one bounded queue; only its dedicated
//! writer touches stderr. Missing records establish no outcome. The selected
//! service owner is responsible for private log custody and retention.
use crate::{access::CanonicalId, domain::Scope};
use axum::http::StatusCode;
use serde::Serialize;
use std::{
    io::Write,
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicU64, Ordering},
        mpsc::{SyncSender, sync_channel},
    },
    time::{Instant, SystemTime, UNIX_EPOCH},
};

const MAX_EVENTS: u8 = 32;
const QUEUE_CAPACITY: usize = 128;
const MAX_RECORD_BYTES: usize = 1024;
const MAX_ELAPSED_MS: u64 = 24 * 60 * 60 * 1000;
static DROPPED: AtomicU64 = AtomicU64::new(0);
static WRITER: OnceLock<Option<SyncSender<Record>>> = OnceLock::new();

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(in crate::http) enum Phase {
    Authenticated,
    IntakeHeaders,
    Metadata,
    File,
    Trailer,
    IntakeComplete,
    Queued,
    WaitingCore,
    Qualifying,
    Measuring,
    ResolvingOriginal,
    Staging,
    Dispatching,
    Releasing,
}
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(in crate::http) enum Category {
    Busy,
    InvalidShape,
    SizeRejected,
    ContentTypeRejected,
    MultipartRead,
    IdleTimeout,
    TotalTimeout,
    CorrelationMismatch,
    ContextMismatch,
    PreparationFailure,
    ContinuationFailure,
    ContinuationAbandoned,
    JoinFailure,
}
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Event {
    Phase,
    Failure,
    WorkerReturned,
    WorkerAbandoned,
    ResponseReady,
    ObserverEnded,
}
#[derive(Clone, Copy)]
pub(in crate::http) enum Part {
    Metadata,
    File,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    schema: &'static str,
    process_id: u32,
    observed_unix_ms: u64,
    request_id: String,
    workspace_id: String,
    home_id: String,
    record_id: String,
    sequence: u8,
    event: Event,
    phase: Phase,
    elapsed_ms: u64,
    metadata_bytes: u64,
    file_bytes: u64,
    category: Option<Category>,
    http_status: Option<u16>,
    dropped_log_records: u64,
}
struct State {
    record: Record,
    started: Instant,
}
#[derive(Clone, Default)]
pub(in crate::http) struct Trace(Option<Arc<Mutex<State>>>);

fn encode(record: &Record) -> Option<Vec<u8>> {
    let mut bytes = serde_json::to_vec(record).ok()?;
    if bytes.len() >= MAX_RECORD_BYTES {
        return None;
    }
    bytes.push(b'\n');
    Some(bytes)
}
fn writer() -> Option<&'static SyncSender<Record>> {
    WRITER
        .get_or_init(|| {
            let (sender, receiver) = sync_channel::<Record>(QUEUE_CAPACITY);
            std::thread::Builder::new()
                .name("upload-diagnostics".into())
                .spawn(move || {
                    while let Ok(record) = receiver.recv() {
                        let Some(bytes) = encode(&record) else {
                            DROPPED.fetch_add(1, Ordering::Relaxed);
                            continue;
                        };
                        if std::io::stderr().lock().write_all(&bytes).is_err() {
                            DROPPED.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                })
                .ok()?;
            Some(sender)
        })
        .as_ref()
}
fn enqueue(mut record: Record) {
    record.dropped_log_records = DROPPED.load(Ordering::Relaxed);
    if writer().is_none_or(|sender| sender.try_send(record).is_err()) {
        DROPPED.fetch_add(1, Ordering::Relaxed);
    }
}
impl Trace {
    pub(in crate::http) fn disabled() -> Self {
        Self::default()
    }
    fn authenticated(request: Option<&str>, scope: &Scope, record: &str) -> Self {
        let Some(request) = request else {
            return Self::disabled();
        };
        if [request, &scope.workspace_id, &scope.home_id, record]
            .iter()
            .any(|id| CanonicalId::parse(*id).is_err())
        {
            return Self::disabled();
        }
        Self(Some(Arc::new(Mutex::new(State {
            started: Instant::now(),
            record: Record {
                schema: "houseatlas.private-upload-diagnostic.v1",
                process_id: std::process::id(),
                observed_unix_ms: 0,
                request_id: request.into(),
                workspace_id: scope.workspace_id.clone(),
                home_id: scope.home_id.clone(),
                record_id: record.into(),
                sequence: 0,
                event: Event::Phase,
                phase: Phase::Authenticated,
                elapsed_ms: 0,
                metadata_bytes: 0,
                file_bytes: 0,
                category: None,
                http_status: None,
                dropped_log_records: 0,
            },
        }))))
    }
    fn snapshot(
        &self,
        event: Event,
        category: Option<Category>,
        status: Option<StatusCode>,
    ) -> Option<Record> {
        let mut state = self.0.as_ref()?.lock().ok()?;
        if state.record.sequence >= MAX_EVENTS {
            return None;
        }
        state.record.sequence += 1;
        state.record.event = event;
        state.record.category = category;
        state.record.http_status = status.map(|status| status.as_u16());
        state.record.elapsed_ms = state
            .started
            .elapsed()
            .as_millis()
            .min(u128::from(MAX_ELAPSED_MS)) as u64;
        state.record.observed_unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .map_or(0, |time| time.as_millis().min(u128::from(u64::MAX)) as u64);
        Some(state.record.clone())
    }
    fn event(&self, event: Event, category: Option<Category>, status: Option<StatusCode>) {
        if let Some(record) = self.snapshot(event, category, status) {
            enqueue(record);
        }
    }
    pub(in crate::http) fn phase(&self, phase: Phase) {
        if let Some(state) = &self.0
            && let Ok(mut state) = state.lock()
        {
            state.record.phase = phase;
        }
        self.event(Event::Phase, None, None);
    }
    pub(in crate::http) fn received(&self, part: Part, count: usize) {
        if let Some(state) = &self.0
            && let Ok(mut state) = state.lock()
        {
            let (bytes, maximum) = match part {
                Part::Metadata => (
                    &mut state.record.metadata_bytes,
                    super::super::upload_intake::MAX_METADATA_BYTES,
                ),
                Part::File => (
                    &mut state.record.file_bytes,
                    super::super::upload_intake::MAX_FILE_BYTES,
                ),
            };
            *bytes = bytes.saturating_add(count as u64).min(maximum as u64 + 1);
        }
    }
    pub(in crate::http) fn failure(&self, category: Category, status: StatusCode) {
        self.event(Event::Failure, Some(category), Some(status));
    }
    pub(in crate::http) fn worker(&self) -> Worker {
        Worker {
            trace: self.clone(),
            returned: false,
        }
    }
}

/// HTTP observer lifetime and blocking-worker lifetime are deliberately separate.
/// Dropping an observer does not imply that a queued/running worker stopped.
pub(in crate::http) struct Observer {
    trace: Trace,
    returned: bool,
}
impl Observer {
    pub(in crate::http) fn authenticated(
        request: Option<&str>,
        scope: &Scope,
        record: &str,
    ) -> Self {
        let trace = Trace::authenticated(request, scope, record);
        trace.phase(Phase::Authenticated);
        Self {
            trace,
            returned: false,
        }
    }
    pub(in crate::http) fn trace(&self) -> Trace {
        self.trace.clone()
    }
    pub(in crate::http) fn response_ready(&mut self, status: StatusCode) {
        self.returned = true;
        self.trace.event(Event::ResponseReady, None, Some(status));
    }
}
impl Drop for Observer {
    fn drop(&mut self) {
        if !self.returned {
            self.trace.event(Event::ObserverEnded, None, None);
        }
    }
}
pub(in crate::http) struct Worker {
    trace: Trace,
    returned: bool,
}
impl Worker {
    pub(in crate::http) fn returned(&mut self, status: StatusCode) {
        self.returned = true;
        self.trace.event(Event::WorkerReturned, None, Some(status));
    }
}
impl Drop for Worker {
    fn drop(&mut self) {
        if !self.returned {
            self.trace.event(
                Event::WorkerAbandoned,
                Some(Category::ContinuationAbandoned),
                None,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "11111111-1111-4111-8111-111111111111";
    fn trace() -> Trace {
        Trace::authenticated(
            Some(ID),
            &Scope {
                workspace_id: ID.into(),
                home_id: ID.into(),
            },
            ID,
        )
    }
    #[test]
    fn bounded_private_schema_counts_and_worker_observer_separation() {
        let trace = trace();
        trace.received(Part::Metadata, usize::MAX);
        trace.received(Part::File, usize::MAX);
        let record = trace.snapshot(Event::ObserverEnded, None, None).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&encode(&record).unwrap()).unwrap();
        assert_eq!(value["event"], "observer-ended");
        assert!(value["httpStatus"].is_null());
        assert_eq!(
            value["metadataBytes"],
            super::super::super::upload_intake::MAX_METADATA_BYTES + 1
        );
        assert_eq!(
            value["fileBytes"],
            super::super::super::upload_intake::MAX_FILE_BYTES + 1
        );
        assert!(encode(&record).unwrap().len() <= MAX_RECORD_BYTES);
        let keys: std::collections::BTreeSet<_> = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            keys,
            [
                "schema",
                "processId",
                "observedUnixMs",
                "requestId",
                "workspaceId",
                "homeId",
                "recordId",
                "sequence",
                "event",
                "phase",
                "elapsedMs",
                "metadataBytes",
                "fileBytes",
                "category",
                "httpStatus",
                "droppedLogRecords"
            ]
            .into_iter()
            .collect()
        );
        let worker = trace
            .snapshot(Event::WorkerReturned, None, Some(StatusCode::OK))
            .unwrap();
        assert!(matches!(worker.event, Event::WorkerReturned));
        for _ in 0..MAX_EVENTS {
            trace.snapshot(Event::Phase, None, None);
        }
        assert!(
            trace
                .snapshot(
                    Event::Failure,
                    Some(Category::ContinuationFailure),
                    Some(StatusCode::SERVICE_UNAVAILABLE)
                )
                .is_none()
        );
        assert!(
            Trace::authenticated(
                Some("not-an-id\nprivate"),
                &Scope {
                    workspace_id: ID.into(),
                    home_id: ID.into()
                },
                ID
            )
            .0
            .is_none()
        );
        assert!(
            Trace::authenticated(
                None,
                &Scope {
                    workspace_id: ID.into(),
                    home_id: ID.into()
                },
                ID
            )
            .0
            .is_none()
        );
        let (sender, _receiver) = sync_channel::<Record>(1);
        assert!(sender.try_send(record.clone()).is_ok());
        assert!(matches!(
            sender.try_send(record),
            Err(std::sync::mpsc::TrySendError::Full(_))
        ));
        // Exercise the real guards: HTTP observation can end while its worker
        // retains the same trace, and a normal worker return supersedes neither
        // the observer event nor a durable receipt.
        let observer = Observer::authenticated(
            Some(ID),
            &Scope {
                workspace_id: ID.into(),
                home_id: ID.into(),
            },
            ID,
        );
        let live = observer.trace();
        let mut worker = live.worker();
        drop(observer);
        assert!(matches!(
            live.0.as_ref().unwrap().lock().unwrap().record.event,
            Event::ObserverEnded
        ));
        worker.returned(StatusCode::OK);
        drop(worker);
        assert!(matches!(
            live.0.as_ref().unwrap().lock().unwrap().record.event,
            Event::WorkerReturned
        ));
        drop(live.worker());
        assert!(matches!(
            live.0.as_ref().unwrap().lock().unwrap().record.event,
            Event::WorkerAbandoned
        ));
    }

    #[tokio::test]
    async fn actual_multipart_progress_preserves_bytes_and_failure_status() {
        use super::super::super::upload_intake;
        use axum::{body::Body, extract::Request};
        let metadata = serde_json::json!({
            "schemaVersion":1,"requestId":ID,"idempotencyKey":ID,
            "context":{"workspaceId":ID,"homeId":ID},"recordId":ID,
            "expectedRevision":1,"guards":[],"statement":"Synthetic diagnostic check",
            "sourceLicense":{"status":"unknown","reference":null},"reason":"Synthetic read-only intake check",
            "filename":"synthetic.txt","contentType":"text/plain"
        }).to_string();
        let body = format!(
            "--synthetic\r\nContent-Disposition: form-data; name=\"metadata\"\r\n\r\n{metadata}\r\n--synthetic\r\nContent-Disposition: form-data; name=\"file\"; filename=\"synthetic.txt\"\r\nContent-Type: text/plain\r\n\r\nsynthetic\r\n--synthetic--\r\n"
        );
        let trace = trace();
        let request = Request::builder()
            .header("content-type", "multipart/form-data; boundary=synthetic")
            .body(Body::from(body.clone()))
            .unwrap();
        let parsed = upload_intake::read(request, &trace).await.unwrap();
        assert_eq!(parsed.bytes, b"synthetic");
        assert_eq!(parsed.metadata.statement, "Synthetic diagnostic check");
        let record = trace.snapshot(Event::Phase, None, None).unwrap();
        assert_eq!(record.metadata_bytes, metadata.len() as u64);
        assert_eq!(record.file_bytes, 9);
        assert!(matches!(record.phase, Phase::Trailer));
        let encoded = String::from_utf8(encode(&record).unwrap()).unwrap();
        for private in [
            "Synthetic diagnostic check",
            "Synthetic read-only intake check",
            "synthetic.txt",
            "boundary=",
        ] {
            assert!(!encoded.contains(private));
        }
        let request = Request::builder()
            .header("content-type", "multipart/form-data; boundary=synthetic")
            .header("content-length", upload_intake::MAX_BODY_BYTES + 1)
            .body(Body::from(body))
            .unwrap();
        let error = match upload_intake::read(request, &trace).await {
            Ok(_) => panic!("oversized header accepted"),
            Err(error) => error,
        };
        assert_eq!(error.status(), StatusCode::PAYLOAD_TOO_LARGE);
        assert!(matches!(error.category(), Category::SizeRejected));
        let request = Request::builder()
            .header("content-type", "multipart/form-data")
            .body(Body::empty())
            .unwrap();
        let error = match upload_intake::read(request, &trace).await {
            Ok(_) => panic!("missing boundary accepted"),
            Err(error) => error,
        };
        assert_eq!(error.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
        assert!(matches!(error.category(), Category::ContentTypeRejected));
    }
}
