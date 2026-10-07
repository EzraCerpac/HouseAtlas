//! Healthy, credential-free disposable loopback exercise of the actual driver.
use super::*;
use serde_json::{Value, json};
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
        Timestamp::parse("2026-10-06T10:00:00.000Z").unwrap()
    }
}
#[tokio::test(flavor = "current_thread")]
async fn healthy_chunked_loopback_full_generation() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../../../adapters/homebox/fixtures/metadata.normalized-synthetic-v1.json"
    ))
    .unwrap();
    let registration: SourceRegistration =
        serde_json::from_value(fixture["sourceRegistration"].clone()).unwrap();
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let endpoint = SourceEndpoint::loopback_fixture(&origin, registration.scope()).unwrap();
    let tenant = registration.collection_id.clone();
    let server = tokio::spawn(async move {
        let mut requests = Vec::new();
        // Two full list pages, three details, three maintenance GETs.
        for _ in 0..8 {
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
            let lower = request.to_ascii_lowercase();
            assert!(lower.contains(&format!("x-tenant: {}\r\n", tenant.to_ascii_lowercase())));
            assert!(lower.contains("accept-encoding: identity\r\n"));
            assert!(!lower.contains("authorization:"));
            let mut first = request.lines().next().unwrap().split_whitespace();
            assert_eq!(first.next(), Some("GET"));
            let target = first.next().unwrap();
            let url = url::Url::parse(&format!("http://127.0.0.1{target}")).unwrap();
            let entities = fixture["entities"].as_array().unwrap();
            let value = if url.path() == "/api/v1/entities" {
                let query: std::collections::BTreeMap<_, _> =
                    url.query_pairs().into_owned().collect();
                assert_eq!(query["includeArchived"], "true");
                assert_eq!(query["page"], "1");
                let location = query["isLocation"] == "true";
                let rows: Vec<_> = entities
                    .iter()
                    .filter(|row| {
                        row["entityType"]["isLocation"].as_bool().unwrap_or(false) == location
                    })
                    .map(|row| {
                        let mut list = serde_json::Map::new();
                        for key in [
                            "id",
                            "name",
                            "archived",
                            "updatedAt",
                            "entityType",
                            "parent",
                        ] {
                            list.insert(key.into(), row[key].clone());
                        }
                        Value::Object(list)
                    })
                    .collect();
                json!({"items": rows, "page": 1, "pageSize": query["pageSize"].parse::<usize>().unwrap(), "total": rows.len()})
            } else if url.path().ends_with("/maintenance") {
                fixture["maintenance"].clone()
            } else {
                entities
                    .iter()
                    .find(|row| Some(row["id"].as_str().unwrap()) == url.path().rsplit('/').next())
                    .unwrap()
                    .clone()
            };
            requests.push(target.to_owned());
            let bytes = serde_json::to_vec(&value).unwrap();
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
        let transport =
            HttpTransport::new(endpoint, FixtureCredentials, Limits::default()).unwrap();
        let mut reader = HomeBoxReader::new(
            registration,
            transport,
            FixtureClock,
            Limits::default(),
            None,
        )
        .unwrap();
        let generation = reader
            .fetch_generation(
                None,
                Uuid::parse("00000000-0000-4000-8000-000000000999").unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(generation.entities().len(), 3);
        assert_eq!(generation.stats().requests, 8);
        assert_eq!(generation.cache().status, CacheState::Fresh);
        assert_eq!(server.await.unwrap().len(), 8);
    };
    tokio::time::timeout(std::time::Duration::from_secs(10), operation)
        .await
        .unwrap();
}
