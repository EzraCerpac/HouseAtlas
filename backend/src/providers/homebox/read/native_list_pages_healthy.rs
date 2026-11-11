//! Generated retained snapshots exercise the existing continuation owner only.
//! No configured HTTP intake, Store authority, dispatcher, socket or credentials.
use super::*;
use crate::providers::homebox::read as r;
use serde_json::json;

fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn evidence(method: a::Method, cookie: Option<&str>) -> a::RequestEvidence<'_> {
    a::RequestEvidence {
        method,
        url: "https://atlas.synthetic.invalid/api/atlas/stock",
        origin: Some("https://atlas.synthetic.invalid"),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        authorization: None,
        csrf: None,
    }
}
struct Body(Option<Vec<u8>>);
impl r::Body for Body {
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, r::ReadError> {
        Ok(self.0.take())
    }
}
struct FixedGet {
    bytes: Vec<u8>,
    path: String,
    maintenance: bool,
    calls: Arc<Mutex<usize>>,
}
impl r::Transport for FixedGet {
    type Body = Body;
    async fn get(&mut self, request: r::GetRequest) -> Result<r::GetResponse<Body>, r::ReadError> {
        assert_eq!(request.method(), "GET");
        assert_eq!(request.path(), self.path);
        assert_eq!(request.tenant(), id(4));
        if self.maintenance {
            assert_eq!(request.query(), &[("status".into(), "both".into())]);
        } else {
            assert!(request.query().is_empty());
        }
        *self.calls.lock().unwrap() += 1;
        Ok(r::GetResponse {
            status: 200,
            scope: request.scope().clone(),
            redirected: false,
            body: Body(Some(self.bytes.clone())),
        })
    }
}
struct FixedClock;
impl Clock for FixedClock {
    fn now(&self) -> Timestamp {
        Timestamp::parse("2026-10-08T12:00:00.1200+02:00").unwrap()
    }
}

#[tokio::test(flavor = "current_thread")]
async fn healthy_native_list_continuations_retain_capture_and_retire_terminal() {
    let cid = |n| a::CanonicalId::parse(id(n)).unwrap();
    let scope = a::Scope {
        workspace_id: cid(1),
        home_id: cid(2),
    };
    let registration = a::SourceRegistration {
        workspace_id: cid(1),
        home_id: cid(2),
        source_instance_id: cid(3),
        collection_id: id(4),
        owner: a::SourceOwner::Homebox,
        partition_mode: a::PartitionMode::ReviewedEntityAllowlist,
        allowed_external_ids: vec![id(2), id(1)],
    };
    let mut access = a::AccessBoundary::in_memory(
        a::AccessConfig::new(vec!["https://atlas.synthetic.invalid".into()])
            .unwrap()
            .with_clock(|| 1_800_000_000_000),
    )
    .unwrap();
    let password = "Synthetic-native-query-password-only!";
    access
        .provision_user(
            &cid(10),
            &cid(11),
            "native-query",
            &a::hash_password(password).unwrap(),
            None,
        )
        .unwrap();
    access
        .set_membership(&cid(10), &scope, a::Role::Viewer, true)
        .unwrap();
    access.put_source(&registration, None).unwrap();
    let session = access
        .login(
            &evidence(a::Method::Post, None),
            &serde_json::to_vec(&json!({"username":"native-query","password":password})).unwrap(),
            "synthetic-native-query",
        )
        .unwrap();
    let principal = access
        .authorize(
            &evidence(
                a::Method::Get,
                Some(session.set_cookie().split(';').next().unwrap()),
            ),
            &scope,
            a::Action::Read,
        )
        .unwrap();
    let reference = a::SourceRef {
        workspace_id: cid(1),
        home_id: cid(2),
        key: a::SourceKey {
            source_instance_id: cid(3),
            collection_id: id(4),
            source_kind: a::SourceKind::HomeboxEntity,
            external_id: id(2),
        },
    };
    let shared = Arc::new(Mutex::new(access));
    let durable: s::SourceRegistration =
        serde_json::from_value(serde_json::to_value(&registration).unwrap()).unwrap();
    let configured = Arc::new(
        TrustedHomeBoxSource::new_stock(
            "https://homebox.synthetic.invalid",
            durable.clone(),
            r::Limits::default(),
            None,
        )
        .unwrap(),
    );
    // Correlation data only: no Store read or storage authorization is claimed.
    let baseline = s::RegisteredCacheRead {
        registration: durable,
        state: s::CachePublicationState {
            cache: None,
            cache_epoch: 0,
            homebox_entities: vec![],
            network_relations: vec![],
        },
    };
    let contracts = st::NativeStockContract::new().unwrap();
    for maintenance in [false, true] {
        let op = if maintenance {
            st::OperationId::HomeboxMaintenanceList
        } else {
            st::OperationId::HomeboxFieldList
        };
        let mut original = json!({
            "schemaVersion":3,"commandId":op.as_str(),"requestId":id(100),
            "context":{"workspaceId":id(1),"homeId":id(2)},
            "target":{"authority":"homebox","sourceInstanceId":id(3),
                "collectionId":id(4),"resourceKind":op.operation().resource_kind,
                "entityId":id(2)},
            "payload":{"cursor":null,"pageSize":2,"includeArchived":true}
        });
        let request = st::ValidatedRequest::parse(&contracts, original.clone()).unwrap();
        let mut source: Value = if maintenance {
            serde_json::from_str(include_str!("../wire/fixtures/maintenance.json")).unwrap()
        } else {
            serde_json::from_str(include_str!("../wire/fixtures/item.detail.json")).unwrap()
        };
        let rows: Vec<Value> = (0..5)
            .map(|index| {
                if maintenance {
                    let mut row = source[0].clone();
                    row["id"] = json!(id(600 + index));
                    row["name"] = json!(format!("Generated maintenance {index}"));
                    row
                } else {
                    json!({"id":id(600 + index),"name":format!("Generated field {index}"),
                        "type":"number","textValue":"","numberValue":9007199254740991_i64,
                        "booleanValue":false})
                }
            })
            .collect();
        if maintenance {
            source = json!(rows);
        } else {
            source["fields"] = json!(rows);
        }
        let bytes = serde_json::to_vec(&source).unwrap();
        let calls = Arc::new(Mutex::new(0));
        let mut reader = r::HomeBoxReader::new_stock(
            serde_json::from_value(serde_json::to_value(&registration).unwrap()).unwrap(),
            FixedGet {
                bytes: bytes.clone(),
                path: format!(
                    "/api/v1/entities/{}{}",
                    id(2),
                    if maintenance { "/maintenance" } else { "" }
                ),
                maintenance,
                calls: Arc::clone(&calls),
            },
            FixedClock,
            r::Limits::default(),
            None,
        )
        .unwrap();
        let owner = Uuid::parse(&id(2)).unwrap();
        let capture = if maintenance {
            RetainedCapture::Maintenance(Box::new(
                reader.capture_stock_maintenance(&owner).await.unwrap(),
            ))
        } else {
            RetainedCapture::Detail(Box::new(reader.capture_stock_entity(&owner).await.unwrap()))
        };
        let expires = Instant::now() + WINDOW;
        let (page, references, parents) =
            DecodedReadObservation::complete_native_list(&contracts, &request, &capture, expires)
                .unwrap();
        assert_eq!(page.resources.len(), 5);
        let first_access = st::CapturedAccess::capture(
            &shared.lock().unwrap(),
            &principal,
            std::slice::from_ref(&reference),
            &[],
        )
        .unwrap();
        let bound = binding(
            &mut shared.lock().unwrap(),
            &configured,
            &first_access,
            owner.as_str(),
        )
        .unwrap();
        // Private test-only snapshot assembly intentionally bypasses configured
        // capture and byte accounting. The continuation path below is unchanged.
        let snapshot = Arc::new(NativeListSnapshot {
            issuer: Arc::new(()),
            configured: Arc::clone(&configured),
            capture,
            original: original.clone(),
            binding: bound,
            baseline: baseline.clone(),
            selected_positions: (0..5).collect(),
            page,
            references,
            parents,
            owner,
            expires,
        });
        let pages = NativeListPages::new();
        let next = pages
            .admit(Arc::clone(&snapshot), 2, bytes.len() * 4)
            .unwrap()
            .unwrap();
        let first = pages
            .capture_page(
                &contracts,
                &shared,
                NativeListReadRequest::select(&configured, &first_access, &request, &baseline)
                    .unwrap(),
                Arc::clone(&snapshot),
                0,
                Some(next.clone()),
            )
            .unwrap();
        assert!(Arc::ptr_eq(first.retained_list().unwrap(), &snapshot));
        assert_eq!(first.original_bytes(), bytes);
        let mut tokens = vec![next];
        for (index, offset) in [2, 4].into_iter().enumerate() {
            original["requestId"] = json!(id(101 + index as u32));
            original["payload"]["cursor"] = json!(tokens[index]);
            let request = st::ValidatedRequest::parse(&contracts, original.clone()).unwrap();
            // Re-capture actual grants for every request; the registry retains
            // no old Principal or CapturedAccess as continuation authority.
            let fresh = st::CapturedAccess::capture(
                &shared.lock().unwrap(),
                &principal,
                std::slice::from_ref(&reference),
                &[],
            )
            .unwrap();
            let next = {
                let registry = pages.registry.lock().unwrap();
                registry.entries[0]
                    .cursors
                    .iter()
                    .find(|c| c.offset == offset + 2)
                    .map(|c| c.token.clone())
            };
            let expected = snapshot.page(offset, 2, next.clone()).unwrap();
            assert_eq!(expected.resources.len(), if offset == 2 { 2 } else { 1 });
            for (position, row) in expected.resources.iter().enumerate() {
                assert_eq!(
                    serde_json::to_value(&row.target).unwrap()["resourceId"],
                    id(600 + (offset + position) as u32)
                );
            }
            let read = pages
                .continue_original(
                    &contracts,
                    &shared,
                    NativeListReadRequest::select(&configured, &fresh, &request, &baseline)
                        .unwrap(),
                )
                .unwrap();
            let expected_observation = DecodedReadObservation::from_native_list_page(
                &contracts, &request, &snapshot, expected,
            )
            .unwrap();
            assert_eq!(
                read.observation().references(),
                expected_observation.references()
            );
            assert_eq!(read.observation().original_request(), &original);
            assert!(Arc::ptr_eq(read.retained_list().unwrap(), &snapshot));
            assert_eq!(read.original_bytes(), bytes);
            assert_eq!(
                read.retrieved_at().as_str(),
                "2026-10-08T12:00:00.1200+02:00"
            );
            if let Some(next) = next {
                tokens.push(next);
            }
        }
        assert_eq!(tokens.len(), 2);
        assert!(pages.registry.lock().unwrap().entries.is_empty());
        // Terminal retirement invalidates every token, but existing returned
        // captures retain their exact original bytes independently of registry.
        for token in tokens {
            original["payload"]["cursor"] = json!(token);
            let request = st::ValidatedRequest::parse(&contracts, original.clone()).unwrap();
            assert!(matches!(
                pages.continue_original(
                    &contracts,
                    &shared,
                    NativeListReadRequest::select(&configured, &first_access, &request, &baseline)
                        .unwrap(),
                ),
                Err(st::StockError::OwnerUnavailable)
            ));
        }
        assert_eq!(first.original_bytes(), bytes);
        assert_eq!(*calls.lock().unwrap(), 1);
    }
}
