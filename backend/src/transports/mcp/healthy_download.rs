//! Healthy canonical codecs and domain composition with explicit fixture peers.
//! These examples exercise no real media, token issuer, byte delivery, grant,
//! provider, storage or listener. Fixture authority accepts only its own inputs;
//! its callbacks demonstrate composition, not authorization qualification.

use std::cell::{Cell, RefCell};

use crate::{contracts::stock as wire, domain::stock as domain};
use serde_json::{Number, Value, json};

use super::{
    AssetDownloadMetadata, AssetDownloadPort, AssetDownloadRequest, AssetDownloadResult,
    NativeQueries, UnavailableCommands,
};

const SNAPSHOT: &str =
    include_str!("../../../../packages/contracts/fixtures/plan-free.snapshot.json");
const WORKSPACE: &str = "00000000-0000-4000-8000-000000000001";
const HOME: &str = "00000000-0000-4000-8000-000000000002";
const ASSET: &str = "00000000-0000-4000-8000-000000000611";
// A fixed fixture owner's declared metadata, never an issued production token.
const FIXTURE_TOKEN: &str = "00000000-0000-4000-8000-000000070038";

fn download_request() -> Value {
    json!({
        "schemaVersion":3, "commandId":"atlas.asset.download",
        "requestId":"00000000-0000-4000-8000-000000070039",
        "context":{"workspaceId":WORKSPACE,"homeId":HOME},
        "target":{"authority":"atlas","recordType":"asset","recordId":ASSET},
        "payload":{}
    })
}

fn download_response(request: &Value, byte_size: &str) -> Value {
    let _: Number = serde_json::from_str(byte_size).expect("healthy integral JSON token");
    // The fixture is syntax-checked above. Keep its original spelling so this
    // checks the codec rather than serde's exponent normalization at ingress.
    let number = Number::from_string_unchecked(byte_size.to_owned());
    let mut response = json!({
        "schemaVersion":3, "commandId":"atlas.asset.download",
        "requestId":request["requestId"], "resolvedScope":request["context"],
        "status":"read", "replayed":false,
        "data":{
            "target":request["target"], "downloadToken":FIXTURE_TOKEN,
            "sha256":null, "byteSize":null,
            "contentType":"text/plain", "disposition":"attachment"
        }
    });
    // json! serializes embedded values; assign the checked Number directly to
    // keep this fixture's spelling through construction as well as the codec.
    response["data"]["byteSize"] = Value::Number(number);
    response
}

fn evidence_call() -> (Value, Value) {
    let snapshot: Value = serde_json::from_str(SNAPSHOT).unwrap();
    let record = snapshot["records"]
        .as_array()
        .unwrap()
        .iter()
        .find(|record| {
            record["recordType"] == "evidence"
                && record["payload"]["provenance"]["source"] == Value::Null
                && record["payload"]["references"] == json!([])
        })
        .expect("published source-free evidence");
    let request = json!({
        "schemaVersion":3, "commandId":"atlas.evidence.get",
        "requestId":"00000000-0000-4000-8000-000000070040",
        "context":{"workspaceId":record["workspaceId"],"homeId":record["homeId"]},
        "target":{"authority":"atlas","recordType":"evidence","recordId":record["recordId"]},
        "payload":{}
    });
    let response = json!({
        "schemaVersion":3, "commandId":"atlas.evidence.get",
        "requestId":request["requestId"], "resolvedScope":request["context"],
        "status":"read", "replayed":false,
        "data":{
            "records":[{
                "target":request["target"], "revision":record["revision"],
                "lifecycle":record["lifecycle"], "payload":record["payload"]
            }],
            "nextCursor":null, "sourceStatus":"current"
        }
    });
    (request, response)
}

#[test]
fn healthy_asset_download_sealed_codecs_preserve_canonical_wire() {
    let validation = wire::StockValidation::new().unwrap();
    let raw_request = download_request();
    validation
        .validate("#/$defs/request_atlas_asset_download", &raw_request)
        .unwrap();
    let request = AssetDownloadRequest::parse(&validation, raw_request.clone()).unwrap();
    assert_eq!(request.raw(), &raw_request);
    assert_eq!(
        request.request().id(),
        wire::OperationId::AtlasAssetDownload
    );
    assert_eq!(
        request.request_id(),
        raw_request["requestId"].as_str().unwrap()
    );
    assert_eq!(request.context().workspace_id, WORKSPACE);
    assert_eq!(request.context().home_id, HOME);
    assert_eq!(request.target(), request.request().target());

    for token in ["1.0", "1e0"] {
        let raw_result = download_response(&raw_request, token);
        validation
            .validate("#/$defs/result_atlas_asset_download", &raw_result)
            .unwrap();
        let result = AssetDownloadResult::parse(&validation, &request, raw_result.clone()).unwrap();
        assert_eq!(result.raw(), &raw_result);
        assert_eq!(result.response().kind(), &wire::ResponseKind::Read);
        assert!(result.response().children().is_empty());
        let metadata: AssetDownloadMetadata<'_> = result.metadata().unwrap();
        assert!(metadata.sha256.is_none());
        assert_eq!(metadata.content_type, "text/plain");
        assert_eq!(metadata.disposition, "attachment");
        assert_eq!(metadata.byte_size.to_string(), token);
        assert!(std::ptr::eq(
            metadata.byte_size,
            result.raw()["data"]["byteSize"].as_number().unwrap()
        ));
        // Parsing and borrowing metadata retain the pending owner obligations.
        // Neither codec method invokes an authority or releases this result.
        let obligations = result.response().obligations();
        assert!(obligations.iter().any(|obligation| {
            obligation.kind == wire::OutputObligationKind::CurrentResultAuthority
        }));
        assert!(
            obligations
                .iter()
                .any(|obligation| { obligation.kind == wire::OutputObligationKind::ExactTarget })
        );
    }
}

// Nonzero-sized opaque principal, with no session or authority claims.
struct FixturePrincipal {
    _opaque: Box<u8>,
}
struct FixtureWitness {
    original_request: Value,
}
struct FixtureGraph {
    original_request: Value,
}

#[derive(Clone, Copy)]
struct PreparedIdentity {
    prepared: usize,
    request: usize,
    witness: usize,
    graph: usize,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Event {
    Capture,
    Resolve,
    AuthorizeGraph,
    Revalidate,
    Download,
    Record,
    AuthorizeResult,
    Disclose,
}

struct FixturePeers {
    principal: FixturePrincipal,
    identity: Cell<Option<PreparedIdentity>>,
    trace: RefCell<Vec<Event>>,
}

impl FixturePeers {
    fn check_principal(&self, principal: &FixturePrincipal) {
        assert!(std::ptr::eq(principal, &self.principal));
    }

    fn bind(&self, prepared: &domain::PreparedRequest<FixtureWitness, FixtureGraph>) {
        self.identity.set(Some(PreparedIdentity {
            prepared: prepared as *const _ as usize,
            request: prepared.request() as *const _ as usize,
            witness: prepared.witness() as *const _ as usize,
            graph: prepared.graph() as *const _ as usize,
        }));
    }

    fn check_prepared(
        &self,
        principal: &FixturePrincipal,
        prepared: &domain::PreparedRequest<FixtureWitness, FixtureGraph>,
    ) {
        self.check_principal(principal);
        let identity = self
            .identity
            .get()
            .expect("actual prepared fixture is bound");
        assert_eq!(prepared as *const _ as usize, identity.prepared);
        assert_eq!(prepared.request() as *const _ as usize, identity.request);
        assert_eq!(prepared.witness() as *const _ as usize, identity.witness);
        assert_eq!(prepared.graph() as *const _ as usize, identity.graph);
        assert_eq!(
            prepared.request().raw(),
            &prepared.witness().original_request
        );
        assert_eq!(prepared.request().raw(), &prepared.graph().original_request);
    }

    fn record(&self, event: Event) {
        self.trace.borrow_mut().push(event);
    }
}

struct FixtureAuthority<'a>(&'a FixturePeers);
impl domain::StockAuthorityPort<FixturePrincipal> for FixtureAuthority<'_> {
    type Witness = FixtureWitness;
    type Graph = FixtureGraph;

    fn capture(
        &self,
        principal: &FixturePrincipal,
        request: &domain::ValidatedRequest,
    ) -> domain::StockResult<FixtureWitness> {
        self.0.check_principal(principal);
        self.0.record(Event::Capture);
        Ok(FixtureWitness {
            original_request: request.raw().clone(),
        })
    }

    fn authorize_graph(
        &self,
        principal: &FixturePrincipal,
        witness: &FixtureWitness,
        request: &domain::ValidatedRequest,
        graph: &FixtureGraph,
    ) -> domain::StockResult<()> {
        self.0.check_principal(principal);
        assert_eq!(request.raw(), &witness.original_request);
        assert_eq!(request.raw(), &graph.original_request);
        self.0.record(Event::AuthorizeGraph);
        Ok(())
    }

    fn revalidate(
        &self,
        principal: &FixturePrincipal,
        witness: &FixtureWitness,
        request: &domain::ValidatedRequest,
    ) -> domain::StockResult<()> {
        self.0.check_principal(principal);
        assert_eq!(request.raw(), &witness.original_request);
        if let Some(identity) = self.0.identity.get() {
            assert_eq!(witness as *const _ as usize, identity.witness);
            assert_eq!(request as *const _ as usize, identity.request);
        }
        self.0.record(Event::Revalidate);
        Ok(())
    }

    fn authorize_result(
        &self,
        principal: &FixturePrincipal,
        prepared: &domain::PreparedRequest<FixtureWitness, FixtureGraph>,
        request: &domain::ValidatedRequest,
        result: &Value,
    ) -> domain::StockResult<()> {
        self.0.check_prepared(principal, prepared);
        assert!(std::ptr::eq(request, prepared.request()));
        assert_eq!(result["resolvedScope"], request.raw()["context"]);
        self.0.record(Event::AuthorizeResult);
        Ok(())
    }

    fn disclose(
        &self,
        principal: &FixturePrincipal,
        prepared: &domain::PreparedRequest<FixtureWitness, FixtureGraph>,
        request: &domain::ValidatedRequest,
        target: &Value,
        row: &Value,
        purpose: domain::DisclosurePurpose,
    ) -> domain::StockResult<()> {
        self.0.check_prepared(principal, prepared);
        assert!(std::ptr::eq(request, prepared.request()));
        assert_eq!(purpose, domain::DisclosurePurpose::ExactTarget);
        assert_eq!(target, request.target());
        assert_eq!(&row["target"], target);
        self.0.record(Event::Disclose);
        Ok(())
    }
}

struct FixturePreparer<'a>(&'a FixturePeers);
impl domain::StockPreparerPort<FixturePrincipal, FixtureWitness> for FixturePreparer<'_> {
    type Graph = FixtureGraph;

    fn resolve(
        &mut self,
        principal: &FixturePrincipal,
        witness: &FixtureWitness,
        request: &domain::ValidatedRequest,
    ) -> domain::StockResult<FixtureGraph> {
        self.0.check_principal(principal);
        assert_eq!(request.raw(), &witness.original_request);
        self.0.record(Event::Resolve);
        Ok(FixtureGraph {
            original_request: request.raw().clone(),
        })
    }
}

struct FixtureDownload<'a> {
    peers: &'a FixturePeers,
    response: Value,
}
impl AssetDownloadPort<FixturePrincipal, FixtureWitness, FixtureGraph> for FixtureDownload<'_> {
    fn download(
        &mut self,
        principal: &FixturePrincipal,
        prepared: &domain::PreparedRequest<FixtureWitness, FixtureGraph>,
        request: &AssetDownloadRequest,
    ) -> domain::StockResult<domain::OwnerResult> {
        self.peers.check_prepared(principal, prepared);
        assert_eq!(request.raw(), prepared.request().raw());
        assert_eq!(
            request.request().id(),
            wire::OperationId::AtlasAssetDownload
        );
        self.peers.record(Event::Download);
        Ok(domain::OwnerResult {
            wire: self.response.clone(),
            children: Vec::new(),
        })
    }
}

struct FixtureRead<'a> {
    peers: &'a FixturePeers,
    response: Value,
}
impl domain::StockQueryPort<FixturePrincipal, FixtureWitness, FixtureGraph> for FixtureRead<'_> {
    fn query(
        &mut self,
        principal: &FixturePrincipal,
        prepared: &domain::PreparedRequest<FixtureWitness, FixtureGraph>,
    ) -> domain::StockResult<domain::OwnerResult> {
        self.peers.check_prepared(principal, prepared);
        assert_eq!(
            prepared.request().id(),
            domain::OperationId::AtlasEvidenceGet
        );
        self.peers.record(Event::Record);
        Ok(domain::OwnerResult {
            wire: self.response.clone(),
            children: Vec::new(),
        })
    }
}

#[test]
fn healthy_native_queries_download_and_record_owner_composition() {
    let contracts = domain::NativeStockContract::new().unwrap();
    let download = download_request();
    let download_output = download_response(&download, "1e0");
    let (record, record_output) = evidence_call();
    for (request, expected, owner_event) in [
        (download, download_output.clone(), Event::Download),
        (record, record_output.clone(), Event::Record),
    ] {
        let peers = FixturePeers {
            principal: FixturePrincipal {
                _opaque: Box::new(38),
            },
            identity: Cell::new(None),
            trace: RefCell::new(Vec::new()),
        };
        let authority = FixtureAuthority(&peers);
        let prepared = domain::prepare(
            &peers.principal,
            request.clone(),
            &contracts,
            &authority,
            &mut FixturePreparer(&peers),
        )
        .unwrap();
        peers.bind(&prepared);
        let mut queries = NativeQueries::new(
            FixtureRead {
                peers: &peers,
                response: record_output.clone(),
            },
            FixtureDownload {
                peers: &peers,
                response: download_output.clone(),
            },
        )
        .unwrap();
        let result = domain::dispatch_prepared(
            &peers.principal,
            &prepared,
            &contracts,
            &authority,
            &mut queries,
            &mut UnavailableCommands,
        )
        .unwrap();
        assert_eq!(result.wire, expected);
        assert!(result.children.is_empty());
        assert_eq!(prepared.request().raw(), &request);
        if owner_event == Event::Download {
            assert_eq!(result.wire["data"]["byteSize"].to_string(), "1e0");
        }
        assert_eq!(
            *peers.trace.borrow(),
            [
                Event::Capture,
                Event::Resolve,
                Event::AuthorizeGraph,
                Event::Revalidate,
                Event::Revalidate,
                owner_event,
                Event::AuthorizeResult,
                Event::Disclose,
                Event::Revalidate,
            ]
        );
    }
}
