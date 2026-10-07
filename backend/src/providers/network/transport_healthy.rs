//! Positive disposable loopback TLS fixture and native SQLite staging only.
//! No held redirect/auth/cancellation/fault/crash/concurrency control is executed.
use super::healthy::{review, source};
use super::*;
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use tokio_rustls::{
    TlsAcceptor,
    rustls::{self, pki_types::PrivatePkcs8KeyDer},
};
use tokio_util::sync::CancellationToken;

const WIRE: &str = include_str!("../../../../adapters/network/fixtures/inventory.wire.json");
const ID: &str = "00000000-0000-4000-8000-000000000901";
struct HealthyAuthority {
    issued: AtomicUsize,
    validations: AtomicUsize,
}
struct HealthyLease {
    source: SourceScope,
    marker: usize,
}
impl NetworkReadAuthority for HealthyAuthority {
    type Lease = HealthyLease;
    fn authorize_inventory(
        &self,
        source: &SourceRegistration,
        _origin: &ReviewedNetworkOrigin,
    ) -> std::result::Result<HealthyLease, NetworkError> {
        Ok(HealthyLease {
            source: source.scope.clone(),
            marker: self.issued.fetch_add(1, Ordering::SeqCst) + 1,
        })
    }
    fn revalidate_inventory(
        &self,
        lease: &HealthyLease,
        source: &SourceRegistration,
        _origin: &ReviewedNetworkOrigin,
    ) -> std::result::Result<(), NetworkError> {
        assert_eq!(lease.source, source.scope);
        assert_eq!(lease.marker, 1);
        self.validations.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    fn existing_session(
        &self,
        lease: &HealthyLease,
    ) -> std::result::Result<Option<ExistingNetworkSession>, NetworkError> {
        assert_eq!(lease.marker, 1);
        Ok(None)
    }
    fn authorize_generation(
        &self,
        lease: &HealthyLease,
        source: &SourceRegistration,
        generation: &NetworkGeneration,
    ) -> std::result::Result<(), NetworkError> {
        assert_eq!(lease.source, source.scope);
        assert_eq!(generation.scope, source.scope);
        assert_eq!(generation.network_relations.len(), 4);
        Ok(())
    }
}
struct HealthyFence {
    source: SourceScope,
}
impl NetworkPublicationFence for HealthyFence {
    fn partition(&self) -> SourceScope {
        self.source.clone()
    }
    fn baseline_generation_id(&self) -> Option<&str> {
        None
    }
    fn baseline_cache_epoch(&self) -> u64 {
        7
    }
    fn reserved_generation_id(&self) -> &str {
        ID
    }
}
struct HealthyPublisher {
    sidecar_path: PathBuf,
    prepared: usize,
    published: usize,
}
impl NetworkCachePublisher<HealthyLease> for HealthyPublisher {
    type Fence = HealthyFence;
    type Receipt = CacheMetadata;
    type Error = NetworkError;
    fn prepare_cache_publication(
        &mut self,
        source: &SourceRegistration,
        lease: &HealthyLease,
    ) -> std::result::Result<PreparedNetworkCache<HealthyFence>, NetworkError> {
        assert_eq!(lease.marker, 1);
        self.prepared += 1;
        Ok(PreparedNetworkCache {
            baseline: NetworkCacheBaseline {
                cache: None,
                cache_epoch: 7,
                homebox_entities: Vec::new(),
                network_relations: Vec::new(),
            },
            fence: HealthyFence {
                source: source.scope.clone(),
            },
        })
    }
    fn publish_prepared_generation<R>(
        &mut self,
        fence: HealthyFence,
        staged: StagedNetworkPublication<R>,
        lease: &HealthyLease,
    ) -> std::result::Result<CacheMetadata, NetworkError> {
        assert_eq!(lease.marker, 1);
        assert_eq!(fence.partition(), lease.source);
        assert_eq!(staged.proposal().precondition().expected_cache_epoch, 7);
        assert_eq!(
            staged.proposal().precondition().expected_generation_id,
            None
        );
        let db = rusqlite::Connection::open_with_flags(
            &self.sidecar_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        let count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM core_network_generations WHERE generation_id=?1",
                [ID],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1); // The actual SQLite stage committed before this consuming port call.
        let (proposal, _receipt) = staged.into_parts();
        let (state, _precondition) = proposal.into_parts();
        assert_eq!(
            state.cache.generation_id.as_deref(),
            Some(fence.reserved_generation_id())
        );
        self.published += 1;
        Ok(state.cache)
    }
    fn record_cache_failure(
        &mut self,
        _fence: HealthyFence,
        _code: ErrorCode,
        _lease: &HealthyLease,
    ) -> std::result::Result<CacheMetadata, NetworkError> {
        // This peer is not exercised by these positive examples.
        Err(NetworkError {
            code: ErrorCode::Upstream,
        })
    }
}
struct TempDirectory(PathBuf);
impl TempDirectory {
    fn new() -> Self {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "houseatlas-network-healthy-{}-{stamp}",
            std::process::id()
        ));
        std::fs::create_dir(&path).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        Self(path)
    }
}
impl Drop for TempDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[tokio::test(flavor = "current_thread")]
async fn healthy_verified_tls_inventory_stream_durable_stage_and_consuming_fence() {
    let cert = rcgen::generate_simple_self_signed(vec!["127.0.0.1".into()]).unwrap();
    let server = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(
        vec![cert.cert.der().clone()],
        PrivatePkcs8KeyDer::from(cert.signing_key.serialize_der()).into(),
    )
    .unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let acceptor = TlsAcceptor::from(Arc::new(server));
    let fixture = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut stream = acceptor.accept(stream).await.unwrap();
        let mut headers = Vec::new();
        while !headers.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            stream.read_exact(&mut byte).await.unwrap();
            headers.push(byte[0]);
            assert!(headers.len() <= 4096);
        }
        let text = String::from_utf8(headers).unwrap();
        assert_eq!(text.lines().next(), Some("GET /api/inventory HTTP/1.1"));
        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n").await.unwrap();
        for chunk in WIRE.as_bytes().chunks(700) {
            stream
                .write_all(format!("{:x}\r\n", chunk.len()).as_bytes())
                .await
                .unwrap();
            stream.write_all(chunk).await.unwrap();
            stream.write_all(b"\r\n").await.unwrap();
        }
        stream.write_all(b"0\r\n\r\n").await.unwrap();
        stream.shutdown().await.unwrap();
    });
    let source = source();
    let origin =
        ReviewedNetworkOrigin::https(&format!("https://127.0.0.1:{}", address.port())).unwrap();
    let config = NetworkHttpConfig::new(source.clone(), origin, Limits::default(), 2000, 2000)
        .unwrap()
        .with_reviewed_ca_pem(cert.cert.pem().as_bytes())
        .unwrap();
    let authority = Arc::new(HealthyAuthority {
        issued: AtomicUsize::new(0),
        validations: AtomicUsize::new(0),
    });
    let directory = TempDirectory::new();
    let path = directory.0.join("retained.sqlite");
    let mut sidecar = SqliteNetworkSidecar::open(&path, std::slice::from_ref(&source)).unwrap();
    let mut publisher = HealthyPublisher {
        sidecar_path: path.clone(),
        prepared: 0,
        published: 0,
    };
    let mut provider = NetworkProvider::new(source.clone(), review(), Limits::default()).unwrap();
    let outcome = refresh_network(
        &mut provider,
        config,
        authority.clone(),
        &mut publisher,
        &mut sidecar,
        CancellationToken::new(),
        || "2026-01-02T12:00:00Z".into(),
    )
    .await;
    let cache = match outcome {
        Ok(NetworkPublicationOutcome::Published(cache)) => cache,
        _ => panic!("healthy loopback publication"),
    };
    fixture.await.unwrap();
    assert_eq!(publisher.prepared, 1);
    assert_eq!(publisher.published, 1);
    assert_eq!(authority.issued.load(Ordering::SeqCst), 1);
    assert!(authority.validations.load(Ordering::SeqCst) >= 4);
    let row = sidecar.load(&source, ID).unwrap();
    sidecar.stage(&source, &row).unwrap(); // Healthy exact replay.
    sidecar.close().unwrap();
    let reopened = SqliteNetworkSidecar::open(&path, std::slice::from_ref(&source)).unwrap();
    assert_eq!(reopened.load(&source, ID).unwrap(), row);
    let packet = SidecarPacket {
        format: SIDECAR_FORMAT.into(),
        rows: vec![row],
    };
    let state = validate_sidecar_packet(&packet, std::slice::from_ref(&source))
        .unwrap()
        .remove(0);
    assert_eq!(cache, state.cache);
    assert_eq!(
        build_facet(&source, &state, "2026-01-02T12:00:00Z", 300_000)
            .unwrap()
            .current_claims
            .len(),
        3
    );
    reopened.close().unwrap();
}
