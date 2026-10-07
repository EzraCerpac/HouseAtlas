//! Only fresh, healthy, sequential synthetic exchanges on IPv4 loopback.
use super::*;
use serde_json::{Value, json};
use stock::*;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

fn id(n: u128) -> Uuid {
    Uuid::from_u128(0x00000000000040008000000000000000 + n)
}
fn digest(n: u8) -> Digest {
    Digest::parse(format!("{n:02x}").repeat(32)).unwrap()
}
fn binding() -> DispatchBinding {
    DispatchBinding {
        context: Context {
            workspace_id: id(1),
            home_id: id(2),
        },
        source_instance_id: id(3),
        collection_id: id(4),
        physical_binding: PhysicalBinding {
            deployment_id: id(5),
            physical_database_id: id(6),
            configuration_digest: digest(1),
        },
        owner_id: id(7),
        dispatcher_epoch: 1,
        source_epoch: 1,
        qualification: NativeQualification::SyntheticFixture,
    }
}
fn authority(binding: &DispatchBinding) -> StockAuthority {
    StockAuthority {
        actor_id: id(8),
        source_epoch: binding.source_epoch,
        authority_digest: digest(2),
        physical_binding: binding.physical_binding.clone(),
        qualification: binding.qualification.clone(),
    }
}
fn permit(plan: &NativePlan, binding: &DispatchBinding, n: u128) -> InvocationPermit {
    InvocationPermit {
        operation_id: id(n),
        actor_id: id(8),
        physical_binding: binding.physical_binding.clone(),
        owner_id: binding.owner_id,
        dispatcher_epoch: binding.dispatcher_epoch,
        source_epoch: binding.source_epoch,
        plan_digest: Digest::parse(
            crate::contracts::semantics::canonical_digest(&serde_json::to_value(plan).unwrap())
                .unwrap(),
        )
        .unwrap(),
        qualification: binding.qualification.clone(),
    }
}
fn command(
    name: &str,
    kind: ResourceKind,
    resource: Option<Uuid>,
    owner: Option<Uuid>,
    payload: Value,
) -> StockCommand {
    let b = binding();
    StockCommand {
        command_id: name.into(),
        request_id: id(100),
        idempotency_key: id(101),
        context: b.context,
        target: StockTarget {
            source_instance_id: b.source_instance_id,
            collection_id: b.collection_id,
            resource_kind: kind,
            resource_id: resource,
            entity_id: owner,
        },
        payload,
        native_sync_behavior: None,
        provider_observation: id(102),
        approval_receipt_id: None,
        original_wire: json!({}),
        request_digest: digest(3),
    }
}
struct FixtureResources {
    upload: Vec<u8>,
    inject_header: bool,
}
impl DispatchResources for FixtureResources {
    async fn authorization(
        &self,
        _: &SourceEndpoint,
        _: &InvocationPermit,
        _: &NativePlan,
        _: &StockAuthority,
        _: Instant,
    ) -> Result<Option<AuthorizationHeader>, TransportFault> {
        if self.inject_header {
            Ok(Some(AuthorizationHeader::from_bytes(
                b"Bearer synthetic-loopback-only",
            )?))
        } else {
            Ok(None)
        }
    }
    async fn staged_bytes(
        &self,
        _: &InvocationPermit,
        stage: &StagedUpload,
        max_bytes: usize,
        _: Instant,
    ) -> Result<Vec<u8>, TransportFault> {
        assert!(self.upload.len() <= max_bytes);
        assert_eq!(stage.sha256, body::digest(&self.upload));
        Ok(self.upload.clone())
    }
}
struct FixtureExchange {
    method: &'static str,
    target: String,
    body: Vec<u8>,
    content_type: Option<String>,
    status: u16,
    response: Vec<u8>,
    response_type: &'static str,
    chunked: bool,
    injected_header: bool,
}
async fn serve(listener: TcpListener, cases: Vec<FixtureExchange>) {
    for case in cases {
        let (mut socket, peer) = listener.accept().await.unwrap();
        assert!(peer.ip().is_loopback());
        let mut headers = Vec::new();
        while !headers.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            socket.read_exact(&mut byte).await.unwrap();
            headers.push(byte[0]);
            assert!(headers.len() < 8192);
        }
        let headers = String::from_utf8(headers).unwrap();
        let mut lines = headers.split("\r\n");
        assert_eq!(
            lines.next().unwrap(),
            format!("{} {} HTTP/1.1", case.method, case.target)
        );
        let headers: std::collections::BTreeMap<_, _> = lines
            .filter_map(|line| line.split_once(':'))
            .map(|(k, v)| (k.to_ascii_lowercase(), v.trim().to_owned()))
            .collect();
        assert_eq!(headers["x-tenant"], binding().collection_id.to_string());
        assert_eq!(headers["accept-encoding"], "identity");
        if case.injected_header {
            assert_eq!(headers["authorization"], "Bearer synthetic-loopback-only");
        } else {
            assert!(!headers.contains_key("authorization"));
        }
        assert_eq!(headers.get("content-type"), case.content_type.as_ref());
        let length: usize = headers
            .get("content-length")
            .map_or(0, |v| v.parse().unwrap());
        assert_eq!(length, case.body.len());
        let mut body = vec![0; length];
        socket.read_exact(&mut body).await.unwrap();
        assert_eq!(body, case.body);
        let framing = if case.chunked {
            "Transfer-Encoding: chunked".into()
        } else {
            format!("Content-Length: {}", case.response.len())
        };
        socket
            .write_all(
                format!(
                    "HTTP/1.1 {} OK\r\nContent-Type: {}\r\n{framing}\r\nConnection: close\r\n\r\n",
                    case.status, case.response_type
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        if case.chunked {
            for chunk in case.response.chunks(17) {
                socket
                    .write_all(format!("{:x}\r\n", chunk.len()).as_bytes())
                    .await
                    .unwrap();
                socket.write_all(chunk).await.unwrap();
                socket.write_all(b"\r\n").await.unwrap();
            }
            socket.write_all(b"0\r\n\r\n").await.unwrap();
        } else {
            socket.write_all(&case.response).await.unwrap();
        }
        socket.shutdown().await.unwrap();
    }
}
fn assert_response(
    report: DispatchReport,
    permit: &InvocationPermit,
    response: &[u8],
    status: u16,
) -> NativeResponse {
    assert_eq!(report.evidence.operation_id, permit.operation_id);
    assert_eq!(report.evidence.plan_digest, permit.plan_digest);
    assert_eq!(report.evidence.activity, PhysicalActivity::ResponseReceived);
    assert_eq!(report.evidence.response_status, Some(status));
    assert_eq!(
        report.evidence.response_bytes_observed,
        response.len() as u64
    );
    assert_eq!(
        report.evidence.response_body_digest,
        Some(body::digest(response))
    );
    assert_eq!(report.evidence.fault, None);
    let NativeDispatch::Invoked(receipt) = report.dispatch else {
        panic!("healthy request invoked")
    };
    assert_eq!(receipt.operation_id, permit.operation_id);
    assert_eq!(receipt.plan_digest, permit.plan_digest);
    assert_eq!(receipt.context, binding().context);
    assert_eq!(receipt.source_instance_id, binding().source_instance_id);
    assert_eq!(receipt.collection_id, binding().collection_id);
    assert_eq!(receipt.remote_activity, RemoteActivity::end_unproven());
    let native = receipt.response.unwrap();
    assert_eq!(native.body_digest, body::digest(response));
    assert_eq!(native.status, status);
    native
}
fn limits() -> Limits {
    Limits {
        max_request_bytes: 65536,
        max_response_bytes: 65536,
        timeout: std::time::Duration::from_secs(10),
    }
}

#[tokio::test(flavor = "current_thread")]
async fn healthy_stock_json_methods_and_prepared_bytes() {
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let endpoint = SourceEndpoint::loopback(
        &format!("http://{}", listener.local_addr().unwrap()),
        binding(),
    )
    .unwrap();
    let driver = HttpDispatcher::new(
        endpoint,
        FixtureResources {
            upload: vec![],
            inject_header: false,
        },
        limits(),
    )
    .unwrap();
    let mut plans = Vec::new();
    let create = command(
        "homebox.tag.create",
        ResourceKind::Tag,
        None,
        None,
        json!({"name":"Synthetic Ω", "description":"exact fixture", "parentId":null}),
    );
    plans.push(map_stock(&create, &Preparation::default()).unwrap());
    // Existing writer NativePlan envelope with original source date spelling
    // carried untouched in the prepared JSON.
    let mut put = plans[0].clone();
    put.request = NativeRequest {
        method: NativeMethod::Put,
        path: format!("/api/v1/tags/{}", id(30)),
        query: vec![],
        body: NativeBody::Json(
            json!({"id":id(30),"name":"Synthetic Ω", "description":"retained", "parentId":null,
            "sourceDate":"2025-03-04T05:06:07+02:00"}),
        ),
    };
    put.generated = GeneratedIdentity::None;
    put.success_status = 200;
    plans.push(put);
    let mut patch = plans[0].clone();
    patch.request = NativeRequest {
        method: NativeMethod::Patch,
        path: format!("/api/v1/entities/{}", id(31)),
        query: vec![],
        body: NativeBody::Json(json!({"quantity":12})),
    };
    patch.response = ResponseKind::Entity;
    patch.success_status = 200;
    patch.generated = GeneratedIdentity::None;
    plans.push(patch);
    let mut delete = plans[0].clone();
    delete.request = NativeRequest {
        method: NativeMethod::Delete,
        path: format!("/api/v1/tags/{}", id(32)),
        query: vec![],
        body: NativeBody::None,
    };
    delete.response = ResponseKind::NoContent;
    delete.success_status = 204;
    delete.generated = GeneratedIdentity::None;
    plans.push(delete);
    let mut prepared = Vec::new();
    let mut exchanges = Vec::new();
    let mut expected = Vec::new();
    let cancel = CancellationToken::new();
    for (n, plan) in plans.iter().enumerate() {
        let permit = permit(plan, &binding(), 200 + n as u128);
        let deadline = Instant::now() + limits().timeout;
        let request = driver
            .prepare(&permit, plan, &authority(&binding()), deadline, &cancel)
            .await
            .unwrap();
        assert!(request.deadline() <= deadline);
        let bytes = match &plan.request.body {
            NativeBody::Json(v) => serde_json::to_vec(v).unwrap(),
            _ => vec![],
        };
        assert_eq!(request.body(), bytes);
        assert_eq!(*request.body_digest(), body::digest(&bytes));
        let response = if plan.response == ResponseKind::NoContent {
            vec![]
        } else {
            format!(
                " {{ \"id\" : \"{}\", \"name\" : \"Synthetic Ω\" }} \n",
                id(40 + n as u128)
            )
            .into_bytes()
        };
        exchanges.push(FixtureExchange {
            method: ["POST", "PUT", "PATCH", "DELETE"][n],
            target: plan.request.path.clone(),
            body: bytes,
            content_type: (!matches!(plan.request.body, NativeBody::None))
                .then(|| "application/json".into()),
            status: plan.success_status,
            response: response.clone(),
            response_type: "application/json",
            chunked: n < 3,
            injected_header: false,
        });
        expected.push((permit, response, plan.success_status));
        prepared.push(request);
    }
    let server = tokio::spawn(serve(listener, exchanges));
    for (request, (permit, response, status)) in prepared.into_iter().zip(expected) {
        assert_response(
            driver.send(request, &cancel).await,
            &permit,
            &response,
            status,
        );
    }
    server.await.unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn healthy_stock_file_fields_and_explicit_header() {
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let endpoint = SourceEndpoint::loopback(
        &format!("http://{}", listener.local_addr().unwrap()),
        binding(),
    )
    .unwrap();
    let upload = b"Synthetic exact attachment bytes\n".to_vec();
    let stage = StagedUpload {
        upload_token: id(70),
        sha256: body::digest(&upload),
        byte_size: upload.len() as u64,
        content_type: "text/plain".into(),
        filename: "Synthetic Ω.txt".into(),
    };
    let command = command(
        "homebox.file.upload",
        ResourceKind::Attachment,
        None,
        Some(id(71)),
        json!({"staged":stage,"type":"attachment","primary":false}),
    );
    let owner = command.target.owner_target().unwrap();
    let snapshot = json!({"id":id(71),"attachments":[]});
    let plan = map_stock(
        &command,
        &Preparation {
            staged_upload: Some(stage.clone()),
            snapshots: vec![NativeSnapshot {
                target: owner,
                value: snapshot.clone(),
                digest: body::digest(&serde_json::to_vec(&snapshot).unwrap()),
                complete: true,
                hidden_fields_preserved: true,
            }],
            ..Preparation::default()
        },
    )
    .unwrap();
    let admission = permit(&plan, &binding(), 203);
    let driver = HttpDispatcher::new(
        endpoint,
        FixtureResources {
            upload: upload.clone(),
            inject_header: true,
        },
        limits(),
    )
    .unwrap();
    let cancel = CancellationToken::new();
    let request = driver
        .prepare(
            &admission,
            &plan,
            &authority(&binding()),
            Instant::now() + limits().timeout,
            &cancel,
        )
        .await
        .unwrap();
    let boundary = format!(
        "houseatlas-{}-{}",
        admission.operation_id.simple(),
        &stage.sha256.as_str()[..24]
    );
    let mut multipart = Vec::new();
    for (field, value) in [
        ("name", stage.filename.as_str()),
        ("type", "attachment"),
        ("primary", "false"),
    ] {
        multipart.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"\r\n\r\n{value}\r\n").as_bytes());
    }
    multipart.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{}\"\r\nContent-Type: text/plain\r\n\r\n", stage.filename).as_bytes());
    multipart.extend_from_slice(&upload);
    multipart.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    assert_eq!(request.body(), multipart);
    let response = serde_json::to_vec(&json!({"id":id(71),"attachments":[{"id":id(72),"title":stage.filename,"type":"attachment","primary":false}]})).unwrap();
    let server = tokio::spawn(serve(
        listener,
        vec![FixtureExchange {
            method: "POST",
            target: plan.request.path.clone(),
            body: multipart,
            content_type: Some(format!("multipart/form-data; boundary={boundary}")),
            status: 201,
            response: response.clone(),
            response_type: "application/json",
            chunked: true,
            injected_header: true,
        }],
    ));
    let native = assert_response(
        driver.send(request, &cancel).await,
        &admission,
        &response,
        201,
    );
    assert_eq!(native.value["attachments"][0]["title"], "Synthetic Ω.txt");
    server.await.unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn healthy_stock_multipart_and_print_dispatch_port() {
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let endpoint = SourceEndpoint::loopback(
        &format!("http://{}", listener.local_addr().unwrap()),
        binding(),
    )
    .unwrap();
    let upload = b"name,description\r\nSynthetic fixture,exact source bytes\r\n".to_vec();
    let stage = StagedUpload {
        upload_token: id(60),
        sha256: body::digest(&upload),
        byte_size: upload.len() as u64,
        content_type: "text/csv".into(),
        filename: "synthetic.csv".into(),
    };
    let command = command(
        "homebox.import.csv",
        ResourceKind::Collection,
        None,
        None,
        json!({"stage":stage,"maxRows":1}),
    );
    let import = map_stock(
        &command,
        &Preparation {
            staged_upload: Some(stage.clone()),
            ..Preparation::default()
        },
    )
    .unwrap();
    let driver = HttpDispatcher::new(
        endpoint,
        FixtureResources {
            upload: upload.clone(),
            inject_header: false,
        },
        limits(),
    )
    .unwrap();
    let cancel = CancellationToken::new();
    let admission = permit(&import, &binding(), 201);
    let request = driver
        .prepare(
            &admission,
            &import,
            &authority(&binding()),
            Instant::now() + limits().timeout,
            &cancel,
        )
        .await
        .unwrap();
    let boundary = format!(
        "houseatlas-{}-{}",
        admission.operation_id.simple(),
        &stage.sha256.as_str()[..24]
    );
    let mut multipart = format!("--{boundary}\r\nContent-Disposition: form-data; name=\"csv\"; filename=\"synthetic.csv\"\r\nContent-Type: text/csv\r\n\r\n").into_bytes();
    multipart.extend_from_slice(&upload);
    multipart.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    assert_eq!(request.body(), multipart);
    let print_command = super::healthy::command(
        "homebox.label.output",
        ResourceKind::Entity,
        Some(id(61)),
        None,
        json!({"delivery":"print","subject":"item","resourceId":id(61),"maxBytes":4096}),
    );
    let print = map_stock(&print_command, &Preparation::default()).unwrap();
    // Exact successful print confirmation from the pinned native handler,
    // without promoting HTTP success to physical printer or remote-end proof.
    let confirmation = b"Printed!".to_vec();
    let server = tokio::spawn(serve(
        listener,
        vec![
            FixtureExchange {
                method: "POST",
                target: import.request.path.clone(),
                body: multipart,
                content_type: Some(format!("multipart/form-data; boundary={boundary}")),
                status: 204,
                response: vec![],
                response_type: "application/json",
                chunked: false,
                injected_header: false,
            },
            FixtureExchange {
                method: "GET",
                target: format!("{}?print=true", print.request.path),
                body: vec![],
                content_type: None,
                status: 200,
                response: confirmation.clone(),
                response_type: "text/plain; charset=utf-8",
                chunked: false,
                injected_header: false,
            },
        ],
    ));
    let native = assert_response(driver.send(request, &cancel).await, &admission, &[], 204);
    assert_eq!(native.value, Value::Null);
    let print_permit = permit(&print, &binding(), 202);
    // Exercise the exact accepted writer port, not only the richer report API.
    let dispatch =
        StockDispatchPort::dispatch(&driver, &print_permit, &print, &authority(&binding())).await;
    let NativeDispatch::Invoked(receipt) = dispatch else {
        panic!("print GET invoked")
    };
    assert_eq!(receipt.remote_activity, RemoteActivity::end_unproven());
    let response = receipt.response.unwrap();
    assert_eq!(response.status, 200);
    assert_eq!(response.value, Value::Null);
    assert_eq!(response.body_digest, body::digest(&confirmation));
    server.await.unwrap();
}
