//! Two ordinary positive credential deliveries over actual loopback HTTP GETs.
use super::*;
use crate::access as a;
use serde_json::json;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

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
struct FixtureClock;
impl Clock for FixtureClock {
    fn now(&self) -> Timestamp {
        Timestamp::parse("2026-10-08T12:00:00.1200+02:00").unwrap()
    }
}

#[tokio::test(flavor = "current_thread")]
async fn healthy_original_credentials_deliver_two_native_gets() {
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
    let password = "Synthetic-native-credentials-password-only!";
    access
        .provision_user(
            &cid(10),
            &cid(11),
            "native-credentials",
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
            &serde_json::to_vec(&json!({"username":"native-credentials","password":password}))
                .unwrap(),
            "synthetic-native-credentials",
        )
        .unwrap();
    let cookie = session.set_cookie().split(';').next().unwrap();
    // Two ordinary requests have their own actual Access-issued principals.
    // Immutable credential configuration reuse creates no replacement witness.
    let first = access
        .authorize(
            &evidence(a::Method::Get, Some(cookie)),
            &scope,
            a::Action::Read,
        )
        .unwrap();
    let second = access
        .authorize(
            &evidence(a::Method::Get, Some(cookie)),
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
    let first_source = access.authorize_source(&first, &reference).unwrap();
    let first_partition = access
        .authorize_source_partition(&first, &reference.partition())
        .unwrap();
    let second_source = access.authorize_source(&second, &reference).unwrap();
    let second_partition = access
        .authorize_source_partition(&second, &reference.partition())
        .unwrap();
    let shared = Arc::new(Mutex::new(access));
    let reader_registration: SourceRegistration =
        serde_json::from_value(serde_json::to_value(&registration).unwrap()).unwrap();
    let detail = include_bytes!("../wire/fixtures/item.detail.json");
    let maintenance = include_bytes!("../wire/fixtures/maintenance.json");
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let endpoint = SourceEndpoint::loopback_fixture(&origin, reader_registration.scope()).unwrap();
    let config = Arc::new(
        NativeReadCredentialConfig::from_trusted_header(
            &endpoint,
            b"Bearer synthetic-homebox-header-only".to_vec(),
        )
        .unwrap(),
    );
    assert!(config.matches_endpoint(&endpoint));
    let server_access = Arc::clone(&shared);
    let server = tokio::spawn(async move {
        let mut requests = Vec::new();
        for index in 0..2 {
            let (mut socket, peer) = listener.accept().await.unwrap();
            assert!(peer.ip().is_loopback());
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                socket.read_exact(&mut byte).await.unwrap();
                request.push(byte[0]);
                assert!(request.len() < 8192);
            }
            // Header delivery's native read fence has ended before network I/O.
            {
                let _available = server_access.try_lock().unwrap();
            }
            let request = String::from_utf8(request).unwrap();
            let path = if index == 0 {
                format!("/api/v1/entities/{}", id(2))
            } else {
                format!("/api/v1/entities/{}/maintenance?status=both", id(2))
            };
            assert_eq!(
                request.lines().next().unwrap(),
                format!("GET {path} HTTP/1.1")
            );
            let lines: Vec<_> = request.lines().skip(1).collect();
            let authorization: Vec<_> = lines
                .iter()
                .filter_map(|line| line.split_once(':'))
                .filter(|(name, _)| name.eq_ignore_ascii_case("authorization"))
                .collect();
            assert_eq!(authorization.len(), 1);
            assert_eq!(
                authorization[0].1.trim(),
                "Bearer synthetic-homebox-header-only"
            );
            assert!(
                request
                    .to_ascii_lowercase()
                    .contains(&format!("x-tenant: {}\r\n", id(4)))
            );
            assert!(
                request
                    .to_ascii_lowercase()
                    .contains("accept-encoding: identity\r\n")
            );
            requests.push(path);
            let bytes: &[u8] = if index == 0 { detail } else { maintenance };
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
        requests
    });
    let operation = async {
        let credentials = config
            .bind_original(Arc::clone(&shared), &first, first_source, first_partition)
            .unwrap();
        let transport = HttpTransport::new(endpoint, credentials, Limits::default()).unwrap();
        let mut reader = HomeBoxReader::new_stock(
            reader_registration.clone(),
            transport,
            FixtureClock,
            Limits::default(),
            None,
        )
        .unwrap();
        let owner = Uuid::parse(&id(2)).unwrap();
        let detail_capture = reader.capture_stock_entity(&owner).await.unwrap();
        assert_eq!(detail_capture.original_bytes(), detail);
        assert_eq!(
            detail_capture.retrieved_at().as_str(),
            "2026-10-08T12:00:00.1200+02:00"
        );
        drop(reader);
        let endpoint =
            SourceEndpoint::loopback_fixture(&origin, reader_registration.scope()).unwrap();
        let credentials = config
            .bind_original(
                Arc::clone(&shared),
                &second,
                second_source,
                second_partition,
            )
            .unwrap();
        let transport = HttpTransport::new(endpoint, credentials, Limits::default()).unwrap();
        let mut reader = HomeBoxReader::new_stock(
            reader_registration,
            transport,
            FixtureClock,
            Limits::default(),
            None,
        )
        .unwrap();
        let maintenance_capture = reader.capture_stock_maintenance(&owner).await.unwrap();
        assert_eq!(maintenance_capture.original_bytes(), maintenance);
        assert_eq!(
            maintenance_capture.retrieved_at().as_str(),
            "2026-10-08T12:00:00.1200+02:00"
        );
        let access = shared.lock().unwrap();
        access.revalidate(&first).unwrap();
        access.revalidate(&second).unwrap();
        drop(access);
        assert_eq!(server.await.unwrap().len(), 2);
    };
    tokio::time::timeout(std::time::Duration::from_secs(15), operation)
        .await
        .unwrap();
}
