//! One ordinary local read/planning flow through the actual root composition.
//!
//! Native RequestEvidence is constructed directly for AT11, so this example
//! opens no HTTP listener and proves no HTTP transport. The standard disposable
//! lifecycle setup is used unchanged. This flow supplies no upload bytes, opens
//! no upload stage/token, and commits no asset, evidence or identity. Planning a
//! replacement intent does not authorize or execute it.
//!
//! No rejection, guard mutation/omission, replay, expiry, revocation, failure,
//! crash, concurrency, provider, recovery or remote flows are included.

use houseatlas_backend::{
    access as a,
    app::{Core, Reads, RequestPrincipal, ServerRuntime, access_scope},
    domain as d,
    http::{qualified_upload_plan as planning, upload_intake::UploadMetadata},
    lifecycle::{self, Failure},
    storage as s,
};
use s::Runtime;
use serde_json::{Value, json};
use std::{fs, os::unix::fs::PermissionsExt};

const ORIGIN: &str = "https://atlas.synthetic.invalid";

fn id(number: u32) -> String {
    format!("00000000-0000-4000-8000-{number:012}")
}

fn main() -> Result<(), Failure> {
    // Set the process-wide mask before constructing the disposable fixture.
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    let scratch = tempfile::Builder::new()
        .prefix("houseatlas-healthy-canonical-plan-")
        .tempdir_in("/tmp")?;
    let directory = scratch.path().join("fixture");
    let mut core = lifecycle::prepare(&directory, ORIGIN)?;
    assert_eq!(
        fs::metadata(&directory)?.permissions().mode() & 0o777,
        0o700
    );
    let home = core.home.clone();
    let scope = access_scope(&home.scope)?;
    let native_scope: s::Scope = serde_json::from_value(serde_json::to_value(&home.scope)?)?;

    // Read actual private disposable credentials; never print their contents.
    let scratch_receipt: Value =
        serde_json::from_slice(&fs::read(directory.join("smoke-session.json"))?)?;
    let login_body = serde_json::to_vec(
        scratch_receipt
            .get("editorLogin")
            .ok_or("Missing disposable editor credentials")?,
    )?;
    drop(scratch_receipt);
    let login_url = format!("{ORIGIN}/api/atlas/auth/login");
    let (cookie, actor_id) = {
        let mut access = core.access.lock().map_err(|_| "Access unavailable")?;
        let receipt = access.login(
            &a::RequestEvidence {
                method: a::Method::Post,
                url: &login_url,
                origin: Some(ORIGIN),
                sec_fetch_site: Some("same-origin"),
                referer: None,
                cookie: None,
                authorization: None,
                csrf: None,
            },
            &login_body,
            "healthy-canonical-upload-plan",
        )?;
        (
            receipt
                .set_cookie()
                .split(';')
                .next()
                .ok_or("Missing native session cookie")?
                .to_owned(),
            receipt.info().actor_id().as_str().to_owned(),
        )
    };
    drop(login_body);
    assert_eq!(actor_id, id(7));

    // Issue genuine native GET/Read authority using the actual session. No POST
    // mutation authority is issued or substituted for this planning-only flow.
    let read_url = format!(
        "{ORIGIN}/api/atlas/v1/workspaces/{}/homes/{}/view",
        home.scope.workspace_id, home.scope.home_id,
    );
    let read_principal = {
        let mut access = core.access.lock().map_err(|_| "Access unavailable")?;
        access.authorize(
            &a::RequestEvidence {
                method: a::Method::Get,
                url: &read_url,
                origin: Some(ORIGIN),
                sec_fetch_site: Some("same-origin"),
                referer: None,
                cookie: Some(&cookie),
                authorization: None,
                csrf: None,
            },
            &scope,
            a::Action::Read,
        )?
    };
    drop(cookie);
    assert_eq!(read_principal.scope(), &scope);
    assert_eq!(read_principal.actor_id().as_str(), actor_id);
    assert_eq!(read_principal.role(), a::Role::Editor);
    let principal = RequestPrincipal::new(read_principal);
    let original = principal.principal.clone();
    assert!(std::ptr::eq(
        original.principal(),
        principal.principal.principal()
    ));

    // Actual SQLite reads use this same outer RequestPrincipal and its captured
    // sources. No access mutex guard is held while Store authorizes internally.
    let (before, before_audits) = native_state(&mut core, &principal, &native_scope)?;
    assert_eq!(before.records.len(), 6);
    assert_eq!(before.homebox_entities.len(), 2);
    assert_eq!(before_audits, 0);
    let snapshot = d::ReadPort::snapshot(
        &mut Reads(&mut *core.store.lock().map_err(|_| "Store unavailable")?),
        &principal,
        &home.scope,
    )?;
    let projection = snapshot
        .homebox_entities
        .first()
        .ok_or("Missing actual cached HomeBox projection")?;
    // Source selection uses the published key and scope, never its label/type.
    let source = d::SourceRef {
        scope: projection.scope.clone(),
        key: projection.source.clone(),
    };
    let admission = planning::read_admission(&mut core, &principal, &home, &source)
        .map_err(|error| format!("Healthy place admission failed: {error}"))?;
    assert_eq!(admission["canReplaceClassification"], true);
    assert_eq!(admission["maximumReasonCodePoints"], 1024);
    assert_eq!(admission["record"]["recordId"], id(400));
    let runtime = ServerRuntime;
    let metadata: UploadMetadata = serde_json::from_value(json!({
        "schemaVersion": 1,
        "requestId": runtime.new_id()?,
        "idempotencyKey": runtime.new_id()?,
        "context": home.scope,
        "recordId": admission["record"]["recordId"],
        "expectedRevision": admission["record"]["revision"],
        "guards": admission["guards"],
        "statement": "Synthetic local canonical evidence planning only",
        "sourceLicense": {"status": "unknown", "reference": null},
        "reason": "Inspect synthetic canonical evidence attachment planning",
        "filename": "synthetic-planning-only.png",
        "contentType": "image/png",
    }))?;
    assert_eq!(metadata.guards.len(), 3);
    for (guard, (kind, suffix)) in metadata.guards.iter().zip([
        (s::RecordType::Binding, 300),
        (s::RecordType::Evidence, 100),
        (s::RecordType::Identity, 200),
    ]) {
        assert_eq!(guard.record.record_type, kind);
        assert_eq!(guard.record.record_id, id(suffix));
        assert_eq!(guard.expected_revision, 1);
    }
    let original_identity = before
        .records
        .iter()
        .find(|record| record.record_type == s::RecordType::Identity && record.record_id == id(200))
        .ok_or("Missing actual canonical identity")?;
    let identity_revision = metadata
        .guards
        .iter()
        .find(|guard| {
            guard.record.record_type == s::RecordType::Identity
                && guard.record.record_id == original_identity.record_id
        })
        .ok_or("Missing original identity guard")?
        .expected_revision;
    let selection = planning::resolve(&mut core, &principal, &home, &metadata)
        .map_err(|error| format!("Healthy canonical resolution failed: {error}"))?;
    assert!(std::ptr::eq(selection.metadata(), &metadata));
    assert_eq!(selection.source(), &source);
    assert_eq!(selection.semantics().target.record_id, metadata.record_id);
    assert_eq!(selection.semantics().revision, metadata.expected_revision);
    assert_eq!(selection.semantics().payload["semanticKind"], "room");
    assert_eq!(selection.identity().target.record_id, id(200));
    assert_eq!(selection.identity().revision, identity_revision);
    assert_eq!(selection.identity().payload, original_identity.payload);
    assert_eq!(selection.binding().target.record_id, id(300));
    assert_eq!(selection.binding().payload["atlasId"], id(200));
    assert_eq!(selection.guards().len(), 4);
    assert_eq!(&selection.guards()[..3], metadata.guards.as_slice());
    assert_eq!(
        selection.guards()[3],
        s::Guard {
            record: s::RecordRef {
                record_type: s::RecordType::LocationSemantics,
                record_id: metadata.record_id.clone(),
            },
            expected_revision: metadata.expected_revision,
        }
    );

    // Server-issued IDs only. The fresh evidence is a proposed reference here;
    // it is not persisted and supplies no authority, asset or upload seal.
    let child_request_id = runtime.new_id()?;
    let child_key = runtime.new_id()?;
    let new_evidence_id = runtime.new_id()?;
    let identity_request = selection
        .identity_request(&child_request_id, &child_key, &new_evidence_id)
        .map_err(|error| format!("Healthy identity planning failed: {error}"))?;
    let mut expected_payload = original_identity.payload.clone();
    expected_payload["evidenceIds"]
        .as_array_mut()
        .ok_or("Missing original identity evidence IDs")?
        .push(json!(new_evidence_id));
    let expected_guards: Vec<_> = selection
        .guards()
        .iter()
        .map(|guard| {
            json!({
                "target": {"authority": "atlas", "recordType": guard.record.record_type,
                    "recordId": guard.record.record_id},
                "revision": {"kind": "atlas", "value": guard.expected_revision},
            })
        })
        .collect();
    assert_eq!(
        identity_request.raw(),
        &json!({
            "schemaVersion": 3, "commandId": "atlas.identity.replace",
            "requestId": child_request_id, "context": metadata.context,
            "target": {"authority": "atlas", "recordType": "identity",
                "recordId": original_identity.record_id},
            "payload": expected_payload, "idempotencyKey": child_key,
            "reason": metadata.reason,
            "preconditions": {
                "target": {"kind": "atlas", "value": identity_revision},
                "guards": expected_guards,
            },
            "approvalReceiptId": null,
        })
    );
    assert!(std::ptr::eq(
        original.principal(),
        principal.principal.principal()
    ));

    let (after, after_audits) = native_state(&mut core, &principal, &native_scope)?;
    assert_eq!(after.records.len(), 6);
    assert_eq!(after_audits, 0);
    assert_eq!(after, before);
    assert_eq!(after_audits, before_audits);
    assert!(std::ptr::eq(selection.metadata(), &metadata));
    assert!(std::ptr::eq(
        original.principal(),
        principal.principal.principal()
    ));
    drop(selection);
    drop(principal);
    drop(original);
    drop(core);
    scratch.close()?;
    println!(
        "PASS healthy local canonical upload planning: actual GET principal, semantics 400 -> identity 200, original three guards plus semantics guard, full identity payload with one proposed evidence ID; SQLite unchanged at six records and zero audits; no commit or HTTP listener"
    );
    Ok(())
}

// Snapshot has no audit field. Pair actual authorized snapshot/history reads to
// inspect all six seeded records' complete native audit histories, before/after.
fn native_state(
    core: &mut Core,
    principal: &RequestPrincipal,
    scope: &s::Scope,
) -> Result<(s::Snapshot, usize), Failure> {
    let mut store = core.store.lock().map_err(|_| "Store unavailable")?;
    let snapshot = store.read_snapshot(principal, scope)?;
    let mut audits = 0;
    for record in &snapshot.records {
        audits += store.history(principal, scope, &record.reference())?.len();
    }
    Ok((snapshot, audits))
}
