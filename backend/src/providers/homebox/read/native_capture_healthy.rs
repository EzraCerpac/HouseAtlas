//! Positive loopback captures and in-process conversion into existing fresh inputs.
use super::*;
use crate::providers::homebox::write::stock::{Context, ResourceKind, StockTarget};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

struct FixtureCredentials;
impl CredentialProvider for FixtureCredentials {
    async fn read_authorization(
        &mut self,
        _: &SourceEndpoint,
        _: tokio::time::Instant,
    ) -> Result<Option<AuthorizationHeader>, ReadError> {
        Ok(None)
    }
}
struct FixtureClock;
impl Clock for FixtureClock {
    fn now(&self) -> Timestamp {
        Timestamp::parse("2026-10-08T12:00:00.1200+02:00").unwrap()
    }
}

#[tokio::test(flavor = "current_thread")]
async fn healthy_fixed_native_get_captures_preserve_originals() {
    let operation = async {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../adapters/homebox/fixtures/metadata.normalized-synthetic-v1.json"
        ))
        .unwrap();
        let mut registration: SourceRegistration =
            serde_json::from_value(fixture["sourceRegistration"].clone()).unwrap();
        let id = Uuid::parse("00000000-0000-4000-8000-000000000002").unwrap();
        registration.partition_mode = PartitionMode::ReviewedEntityAllowlist;
        registration.allowed_external_ids = vec![
            id.clone(),
            Uuid::parse("00000000-0000-4000-8000-000000000001").unwrap(),
        ];
        let scope = registration.scope();
        // Ordinary synthetic extensions exercise exact bytes without inventing
        // hidden PUT schemas, original source custody or an archival flag.
        let detail = include_str!("../wire/fixtures/item.detail.json")
            .replacen("\"purchasePrice\": 0", "\"purchasePrice\": 1.2300e+2", 1)
            .replacen(
                "\"fields\": null",
                "\"fields\": null, \"nativeExtension\": 9007199254740993",
                1,
            )
            .into_bytes();
        let maintenance = include_bytes!("../wire/fixtures/maintenance.json").to_vec();
        let expected_detail = detail.clone();
        let expected_maintenance = maintenance.clone();
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let endpoint = SourceEndpoint::loopback_fixture(&origin, scope.clone()).unwrap();
        let expected_paths = vec![
            format!("/api/v1/entities/{}", id.as_str()),
            format!("/api/v1/entities/{}/maintenance?status=both", id.as_str()),
        ];
        let paths = expected_paths.clone();
        let tenant = scope.collection_id.clone();
        let server = tokio::spawn(async move {
            let mut observed = Vec::new();
            for (path, bytes) in paths.into_iter().zip([detail, maintenance]) {
                let (mut socket, peer) = listener.accept().await.unwrap();
                assert!(peer.ip().is_loopback());
                let mut request = Vec::new();
                while !request.ends_with(b"\r\n\r\n") {
                    let mut byte = [0];
                    socket.read_exact(&mut byte).await.unwrap();
                    request.push(byte[0]);
                    assert!(request.len() < 8192);
                }
                let request = String::from_utf8(request).unwrap();
                assert_eq!(
                    request.lines().next().unwrap(),
                    format!("GET {path} HTTP/1.1")
                );
                let lower = request.to_ascii_lowercase();
                assert!(lower.contains(&format!("x-tenant: {}\r\n", tenant.to_ascii_lowercase())));
                assert!(lower.contains("accept-encoding: identity\r\n"));
                assert!(!lower.contains("authorization:"));
                observed.push(path);
                socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n").await.unwrap();
                for chunk in bytes.chunks(17) {
                    socket
                        .write_all(format!("{:x}\r\n", chunk.len()).as_bytes())
                        .await
                        .unwrap();
                    socket.write_all(chunk).await.unwrap();
                    socket.write_all(b"\r\n").await.unwrap();
                }
                socket.write_all(b"0\r\n\r\n").await.unwrap();
                socket.shutdown().await.unwrap();
            }
            observed
        });
        let transport =
            HttpTransport::new(endpoint, FixtureCredentials, Limits::default()).unwrap();
        let mut reader = HomeBoxReader::new_stock(
            registration,
            transport,
            FixtureClock,
            Limits::default(),
            None,
        )
        .unwrap();
        let detail = reader.capture_stock_entity(&id).await.unwrap();
        assert_eq!(detail.scope(), &scope);
        assert_eq!(detail.entity_id(), &id);
        assert_eq!(detail.method(), "GET");
        assert_eq!(detail.path(), expected_paths[0]);
        assert!(detail.query().is_empty());
        assert_eq!(detail.status(), 200);
        assert_eq!(
            detail.retrieved_at().as_str(),
            "2026-10-08T12:00:00.1200+02:00"
        );
        assert_eq!(detail.original_bytes(), expected_detail);
        assert_eq!(
            detail.source_json()["purchasePrice"]
                .as_number()
                .unwrap()
                .to_string(),
            "1.2300e+2"
        );
        assert_eq!(
            detail.source_json()["nativeExtension"]
                .as_number()
                .unwrap()
                .to_string(),
            "9007199254740993"
        );
        assert_eq!(detail.decoded().summary.id, id);
        assert_eq!(
            detail.decoded().summary.updated_at.as_str(),
            "2026-01-02T03:04:05.1200+02:00"
        );
        assert_eq!(detail.decoded().attachments.len(), 3);
        assert!(
            detail.source_json()["attachments"][0]
                .get("archived")
                .is_none()
        );
        assert_eq!(
            detail.source_json()["attachments"][0]["path"],
            "private/blob-key.pdf"
        );
        let maintenance = reader.capture_stock_maintenance(&id).await.unwrap();
        assert_eq!(maintenance.scope(), &scope);
        assert_eq!(maintenance.entity_id(), &id);
        assert_eq!(maintenance.method(), "GET");
        assert_eq!(
            maintenance.path(),
            format!("/api/v1/entities/{}/maintenance", id.as_str())
        );
        assert_eq!(maintenance.query(), &[("status".into(), "both".into())]);
        assert_eq!(maintenance.status(), 200);
        assert_eq!(maintenance.retrieved_at(), detail.retrieved_at());
        assert_eq!(maintenance.original_bytes(), expected_maintenance);
        assert_eq!(maintenance.decoded().entity_id(), &id);
        assert_eq!(maintenance.decoded().entries().len(), 3);
        assert_eq!(maintenance.source_json()[1]["cost"], "12.50");
        assert_eq!(maintenance.source_json()[2]["cost"], "1.25e+06");
        assert_eq!(
            maintenance.decoded().entries()[1]
                .completed_date
                .as_ref()
                .unwrap()
                .as_str(),
            "2026-02-01"
        );
        assert_eq!(server.await.unwrap(), expected_paths);
    };
    tokio::time::timeout(std::time::Duration::from_secs(10), operation)
        .await
        .unwrap();
}

struct CaptureChunks(std::collections::VecDeque<Vec<u8>>);
impl Body for CaptureChunks {
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, ReadError> {
        Ok(self.0.pop_front())
    }
}
struct CaptureIntake {
    scope: SourceScope,
    responses: std::collections::VecDeque<Vec<u8>>,
    calls: std::sync::Arc<std::sync::Mutex<Vec<GetRequest>>>,
}
impl Transport for CaptureIntake {
    type Body = CaptureChunks;
    async fn get(&mut self, request: GetRequest) -> Result<GetResponse<Self::Body>, ReadError> {
        assert_eq!(request.scope(), &self.scope);
        assert_eq!(request.method(), "GET");
        assert!(request.reject_redirects());
        self.calls.lock().unwrap().push(request);
        let original = self.responses.pop_front().unwrap();
        Ok(GetResponse {
            status: 200,
            scope: self.scope.clone(),
            redirected: false,
            body: CaptureChunks(original.chunks(7).map(|chunk| chunk.to_vec()).collect()),
        })
    }
}

#[tokio::test(flavor = "current_thread")]
async fn healthy_captured_members_into_existing_fresh_inputs() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../../adapters/homebox/fixtures/metadata.normalized-synthetic-v1.json"
    ))
    .unwrap();
    let mut registration: SourceRegistration =
        serde_json::from_value(fixture["sourceRegistration"].clone()).unwrap();
    // An explicitly supplied synthetic UUID collection, not a parsed/coerced
    // replacement for an opaque existing registration string.
    let collection = uuid::Uuid::parse_str("abcdef01-2345-4678-9abc-abcdefabcdef").unwrap();
    registration.collection_id = collection.to_string();
    let owner = uuid::Uuid::parse_str("00000000-0000-4000-8000-000000000002").unwrap();
    let field = uuid::Uuid::parse_str("00000000-0000-4000-8000-000000000061").unwrap();
    let attachment = uuid::Uuid::parse_str("00000000-0000-4000-8000-000000000201").unwrap();
    let maintenance = uuid::Uuid::parse_str("00000000-0000-4000-8000-000000000302").unwrap();
    let id = Uuid::parse(&owner.to_string()).unwrap();
    registration.partition_mode = PartitionMode::ReviewedEntityAllowlist;
    registration.allowed_external_ids = vec![
        id.clone(),
        Uuid::parse("00000000-0000-4000-8000-000000000001").unwrap(),
    ];
    let scope = registration.scope();
    let context = Context {
        workspace_id: uuid::Uuid::parse_str(scope.workspace_id.as_str()).unwrap(),
        home_id: uuid::Uuid::parse_str(scope.home_id.as_str()).unwrap(),
    };
    let source = uuid::Uuid::parse_str(scope.source_instance_id.as_str()).unwrap();
    let detail = include_str!("../wire/fixtures/item.detail.json")
        .replacen("\"purchasePrice\": 0", "\"purchasePrice\": 1.2300e+2", 1)
        .replacen(
            "\"fields\": null",
            &format!("\"fields\": [{{\"id\":\"{field}\",\"name\":\"Original field\",\"type\":\"number\",\"textValue\":\"\",\"numberValue\":9007199254740993,\"booleanValue\":false}}]"),
            1,
        )
        .into_bytes();
    let log = include_bytes!("../wire/fixtures/maintenance.json").to_vec();
    let calls = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let transport = CaptureIntake {
        scope: scope.clone(),
        responses: [detail.clone(), detail.clone(), detail.clone(), log.clone()].into(),
        calls: calls.clone(),
    };
    let mut reader = HomeBoxReader::new_stock(
        registration,
        transport,
        FixtureClock,
        Limits::default(),
        None,
    )
    .unwrap();
    for (kind, member, entity_id) in [
        (ResourceKind::Entity, owner, None),
        (ResourceKind::Field, field, Some(owner)),
        (ResourceKind::Attachment, attachment, Some(owner)),
    ] {
        let target = StockTarget {
            source_instance_id: source,
            collection_id: collection,
            resource_kind: kind,
            resource_id: Some(member),
            entity_id,
        };
        let captured = reader.capture_stock_entity(&id).await.unwrap();
        let fresh = captured.into_fresh(&context, target.clone()).unwrap();
        assert_eq!(fresh.scope, scope);
        assert_eq!(fresh.target, target);
        assert_eq!(fresh.path, format!("/api/v1/entities/{owner}"));
        assert!(fresh.query.is_empty());
        assert_eq!(fresh.original, detail);
        assert_eq!(fresh.observed_at, "2026-10-08T12:00:00.1200+02:00");
        let retained: serde_json::Value = serde_json::from_slice(&fresh.original).unwrap();
        assert_eq!(
            retained["purchasePrice"].as_number().unwrap().to_string(),
            "1.2300e+2"
        );
        assert_eq!(
            retained["fields"][0]["numberValue"]
                .as_number()
                .unwrap()
                .to_string(),
            "9007199254740993"
        );
        assert_eq!(retained["updatedAt"], "2026-01-02T03:04:05.1200+02:00");
    }
    let target = StockTarget {
        source_instance_id: source,
        collection_id: collection,
        resource_kind: ResourceKind::Maintenance,
        resource_id: Some(maintenance),
        entity_id: Some(owner),
    };
    let captured = reader.capture_stock_maintenance(&id).await.unwrap();
    let fresh = captured.into_fresh(&context, target.clone()).unwrap();
    assert_eq!(fresh.scope, scope);
    assert_eq!(fresh.target, target);
    assert_eq!(fresh.path, format!("/api/v1/entities/{owner}/maintenance"));
    assert_eq!(fresh.query, [("status".into(), "both".into())]);
    assert_eq!(fresh.original, log);
    assert_eq!(fresh.observed_at, "2026-10-08T12:00:00.1200+02:00");
    let retained: serde_json::Value = serde_json::from_slice(&fresh.original).unwrap();
    assert_eq!(retained[1]["cost"], "12.50");
    assert_eq!(retained[2]["cost"], "1.25e+06");
    assert_eq!(retained[1]["completedDate"], "2026-02-01");
    let calls = calls.lock().unwrap();
    assert_eq!(calls.len(), 4);
    for call in &calls[..3] {
        assert_eq!(call.path(), format!("/api/v1/entities/{owner}"));
        assert!(call.query().is_empty());
    }
    assert_eq!(
        calls[3].path(),
        format!("/api/v1/entities/{owner}/maintenance")
    );
    assert_eq!(calls[3].query(), &[("status".into(), "both".into())]);
}
