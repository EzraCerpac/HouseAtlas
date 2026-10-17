//! Opt-in documentary export. Content identifiers never authorize a read.
use super::*;
use crate::{media as m, storage as s};
use axum::http::HeaderMap;
use base64::{Engine, engine::general_purpose::STANDARD};
use m::native::{NativeMediaAccess, NativeMediaStorage, RetainedPrincipal};
use m::service::{
    DeliveryMode, MediaService, MediaStoragePort, OwnedDescriptor, ReadMethod, StoredAsset,
};
use sha2::{Digest, Sha256};
use std::{collections::VecDeque, time::Duration};
const METADATA: usize = 16 * 1024 * 1024;
const SECTION: usize = 8 * 1024 * 1024;
const TOTAL: usize = 128 * 1024 * 1024;
const RANGE: usize = 4 * 1024 * 1024;
fn unavailable() -> HttpFailure {
    failure(StatusCode::SERVICE_UNAVAILABLE)
}
fn conflict() -> HttpFailure {
    failure(StatusCode::CONFLICT)
}
fn encoded(value: &Value) -> Result<Vec<u8>, HttpFailure> {
    serde_json::to_vec(value).map_err(|_| unavailable())
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn scope_storage(scope: &d::Scope) -> s::Scope {
    s::Scope {
        workspace_id: scope.workspace_id.clone(),
        home_id: scope.home_id.clone(),
    }
}
fn media_scope(scope: &d::Scope) -> m::types::Scope {
    m::types::Scope {
        workspace_id: scope.workspace_id.clone(),
        home_id: scope.home_id.clone(),
    }
}
fn media_error(error: m::MediaError) -> HttpFailure {
    failure(StatusCode::from_u16(error.status()).unwrap_or(StatusCode::SERVICE_UNAVAILABLE))
}
#[derive(Clone)]
struct Resource {
    descriptor: Value,
    bytes: Arc<Vec<u8>>,
}
struct Pack {
    scope: d::Scope,
    fingerprint: Vec<u8>,
    manifest: Vec<u8>,
    resources: BTreeMap<String, Resource>,
}
impl Pack {
    fn size(&self) -> usize {
        self.manifest.len()
            + self
                .resources
                .values()
                .map(|r| r.bytes.len())
                .sum::<usize>()
    }
}
#[derive(Default)]
pub(super) struct Registry {
    packs: VecDeque<(String, Arc<Pack>)>,
}
impl Registry {
    fn insert(&mut self, id: String, pack: Arc<Pack>) {
        self.packs.retain(|(key, _)| *key != id);
        while self.packs.len() >= 2
            || self.packs.iter().map(|(_, p)| p.size()).sum::<usize>() + pack.size() > 2 * TOTAL
        {
            if self.packs.pop_front().is_none() {
                break;
            }
        }
        self.packs.push_back((id, pack));
    }
    fn get(&self, id: &str, scope: &d::Scope) -> Result<Arc<Pack>, HttpFailure> {
        self.packs
            .iter()
            .find(|(key, p)| key == id && p.scope == *scope)
            .map(|(_, p)| p.clone())
            .ok_or_else(|| failure(StatusCode::NOT_FOUND))
    }
}
struct Prepared {
    snapshot: s::Snapshot,
    metadata: s::home_read_pack::Metadata,
    fingerprint: Vec<u8>,
    visibility: Value,
    publication: Value,
    label: String,
    access: crate::app::Access,
    store: Arc<Mutex<crate::app::Store>>,
    vault: Arc<m::AssetVault>,
    media: RetainedPrincipal,
}
fn fingerprint(
    snapshot: &s::Snapshot,
    metadata: &s::home_read_pack::Metadata,
    host: &Host,
    scope: &d::Scope,
) -> Result<Vec<u8>, HttpFailure> {
    encoded(
        &json!({"snapshot":snapshot,"metadata":metadata.fingerprint().map_err(|_|unavailable())?,
        "model":host.model_overview.as_ref().filter(|m|m.matches(scope)).map(|m|&m.manifest_sha256)}),
    )
}
fn prepare(
    host: &Host,
    p: &RequestPrincipal,
    headers: &CheckedHeaders,
    uri: &Uri,
    method: &Method,
    scope: &d::Scope,
) -> Result<Prepared, HttpFailure> {
    let mut core = host.core.lock().map_err(|_| unavailable())?;
    let label = core
        .homes
        .iter()
        .find(|h| h.scope == *scope)
        .ok_or_else(|| failure(StatusCode::NOT_FOUND))?
        .label
        .clone();
    let (snapshot, metadata) = reads::retained_pack_cut(&mut core, host, p, &scope_storage(scope))?;
    p.seal_source_capture();
    let url = format!(
        "{}{}",
        host.origin,
        uri.path_and_query().map_or("/", |v| v.as_str())
    );
    let observed = evidence(&host.origin, headers, uri, &url, method).map_err(access_error)?;
    let media = NativeMediaAccess::new(core.access.clone())
        .authorize_request(&observed, &media_scope(scope))
        .map_err(media_error)?;
    if snapshot.records.len() > 10_000
        || snapshot.homebox_entities.len() + snapshot.network_relations.len() > 10_000
    {
        return Err(failure(StatusCode::PAYLOAD_TOO_LARGE));
    }
    let fingerprint = fingerprint(&snapshot, &metadata, host, scope)?;
    if fingerprint.len() > METADATA {
        return Err(failure(StatusCode::PAYLOAD_TOO_LARGE));
    }
    let mut prepared = Prepared {
        snapshot,
        metadata,
        fingerprint,
        visibility: Value::Null,
        publication: Value::Null,
        label,
        access: core.access.clone(),
        store: core.store.clone(),
        vault: core.vault.clone(),
        media,
    };
    drop(core);
    prepared.publication = publication_state(host, scope);
    let mut scratch = Builder::empty();
    prepared.visibility = documents(host, &prepared, scope, &mut scratch, false)?;
    Ok(prepared)
}
fn recheck(
    host: &Host,
    p: &RequestPrincipal,
    prepared: &Prepared,
    scope: &d::Scope,
) -> Result<(), HttpFailure> {
    let mut core = host.core.lock().map_err(|_| unavailable())?;
    if !Arc::ptr_eq(&core.store, &prepared.store)
        || !Arc::ptr_eq(&core.access, &prepared.access)
        || !Arc::ptr_eq(&core.vault, &prepared.vault)
    {
        return Err(conflict());
    }
    let (snapshot, metadata) = reads::retained_pack_cut(&mut core, host, p, &scope_storage(scope))?;
    if fingerprint(&snapshot, &metadata, host, scope)? != prepared.fingerprint {
        return Err(conflict());
    }
    drop(core);
    if publication_state(host, scope) != prepared.publication
        || documents(host, prepared, scope, &mut Builder::empty(), false)? != prepared.visibility
    {
        return Err(conflict());
    }
    let access = prepared.access.lock().map_err(|_| unavailable())?;
    access
        .authorize_storage(
            prepared.media.principal(),
            &crate::app::access_scope(scope).map_err(|_| conflict())?,
            a::Capability::ReadAssetManifest,
        )
        .map_err(access_error)?;
    access
        .revalidate(prepared.media.principal())
        .map_err(access_error)?;
    Ok(())
}
// Native adapter retains the exact captured record + manifest before and after Media reads.
struct FrozenAssets<'a> {
    prepared: &'a Prepared,
}
impl MediaStoragePort<RetainedPrincipal> for FrozenAssets<'_> {
    fn read_owned_asset(
        &self,
        p: &RetainedPrincipal,
        scope: &m::types::Scope,
        id: &str,
    ) -> m::MediaResult<StoredAsset> {
        let request = RequestPrincipal::from_retained(p.clone());
        let found =
            NativeMediaStorage::new(&self.prepared.store).read_owned_asset(&request, scope, id)?;
        let expected = self
            .prepared
            .snapshot
            .records
            .iter()
            .find(|r| r.record_type == s::RecordType::Asset && r.record_id == id)
            .ok_or(m::MediaError::Conflict)?;
        let actual = serde_json::to_value(&found.record).map_err(|_| m::MediaError::Unavailable)?;
        let expected = serde_json::to_value(expected).map_err(|_| m::MediaError::Unavailable)?;
        if actual != expected
            || serde_json::to_value(&found.manifest).map_err(|_| m::MediaError::Unavailable)?
                != expected["payload"]
        {
            return Err(m::MediaError::Conflict);
        }
        Ok(found)
    }
}
struct Builder {
    resources: BTreeMap<String, Resource>,
    order: Vec<String>,
    bytes: usize,
    metadata: usize,
    exclusions: Vec<Value>,
}
impl Builder {
    fn empty() -> Self {
        Self {
            resources: BTreeMap::new(),
            order: Vec::new(),
            bytes: 0,
            metadata: 0,
            exclusions: Vec::new(),
        }
    }
    fn exclusion(&mut self, section: &str, code: &str, label: &str) {
        self.exclusions
            .push(json!({"section":section,"code":code,"label":label}));
    }
    fn add(
        &mut self,
        bytes: Vec<u8>,
        mime: &str,
        section: &str,
        role: &str,
        record: Value,
    ) -> Result<Option<String>, HttpFailure> {
        let hash = digest(&bytes);
        if let Some(prior) = self.resources.get(&hash) {
            if prior.descriptor["contentType"] != mime {
                self.exclusion(
                    section,
                    "mime-conflict",
                    "Equal content has conflicting declared types",
                );
                return Ok(None);
            }
            return Ok(Some(hash));
        }
        if self.resources.len() >= 512
            || self.bytes + bytes.len()
                > if role == "section" {
                    TOTAL
                } else {
                    TOTAL - METADATA
                }
        {
            self.exclusion(
                section,
                "byte-budget",
                "Required retained bytes exceed pack bounds",
            );
            return Ok(None);
        }
        if role == "section" {
            self.metadata += bytes.len();
            if self.metadata > METADATA {
                return Err(failure(StatusCode::PAYLOAD_TOO_LARGE));
            }
        }
        self.bytes += bytes.len();
        self.order.push(hash.clone());
        self.resources.insert(hash.clone(),Resource { descriptor:json!({"sha256":hash,"bytes":bytes.len(),"contentType":mime,"section":section,"role":role,"record":record}),bytes:Arc::new(bytes) });
        Ok(Some(hash))
    }
    fn section(
        &mut self,
        value: Value,
        section: &str,
        complete: bool,
    ) -> Result<Value, HttpFailure> {
        let bytes = encoded(&value)?;
        if bytes.len() > SECTION {
            return Err(failure(StatusCode::PAYLOAD_TOO_LARGE));
        }
        let mut hash = self.add(bytes, "application/json", section, "section", Value::Null)?;
        if hash.as_ref().is_some_and(|hash| {
            let descriptor = &self.resources[hash].descriptor;
            descriptor["role"] != "section" || descriptor["section"] != section
        }) {
            // Preserve the first canonical descriptor. A section root must not
            // point to an original/another section under the closed v1 envelope.
            self.exclusion(
                section,
                "section-attribution-conflict",
                "The section root has another canonical content attribution",
            );
            hash = None;
        }
        Ok(
            json!({"state":if complete&&hash.is_some(){"complete"}else{"partial"},"resourceSha256":hash,"requiredBytesComplete":complete&&hash.is_some()}),
        )
    }
}
/// Remove action-routing/private custody keys, preserving source/provenance URLs as inert text.
fn documentary(value: &Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.iter().map(documentary).collect()),
        Value::Object(values) => Value::Object(
            values
                .iter()
                .filter_map(|(key, value)| {
                    if matches!(
                        key.as_str(),
                        "storageKey"
                            | "cookie"
                            | "csrfToken"
                            | "authorization"
                            | "sessionToken"
                            | "accessToken"
                            | "refreshToken"
                    ) {
                        return None;
                    }
                    let value = if key == "nativeLinks" {
                        json!([])
                    } else if matches!(key.as_str(), "href" | "proxyRef") {
                        Value::Null
                    } else {
                        documentary(value)
                    };
                    Some((key.clone(), value))
                })
                .collect(),
        ),
        _ => value.clone(),
    }
}
fn empty_section(state: &str) -> Value {
    json!({"state":state,"resourceSha256":null,"requiredBytesComplete":state=="not-configured"})
}
fn budget() -> Result<m::WorkBudget, HttpFailure> {
    // Ordinary Media policy remains ten seconds; a read-pack is not an offline recovery command.
    m::WorkBudget::new(Duration::from_secs(10), m::Cancellation::default()).map_err(media_error)
}
fn documents(
    host: &Host,
    prepared: &Prepared,
    scope: &d::Scope,
    builder: &mut Builder,
    include_bytes: bool,
) -> Result<Value, HttpFailure> {
    if host.full_geodata_identity.is_none() {
        if host.geodata_dataset.is_some() {
            builder.exclusion(
                "documents",
                "separate-dataset",
                "Documents cannot form a coherent cut with the selected native dataset",
            );
            return Ok(empty_section("unavailable"));
        }
        return Ok(empty_section("not-configured"));
    }
    let store = prepared.store.lock().map_err(|_| unavailable())?;
    let identity = host
        .full_geodata_identity
        .as_ref()
        .ok_or_else(unavailable)?;
    if !store.matches_full_geodata_identity(identity)
        || !store.full_geodata_belongs_to(&prepared.access, &prepared.vault)
    {
        return Err(conflict());
    }
    let mut access = prepared.access.lock().map_err(|_| unavailable())?;
    let mut output = None;
    access.with_read_authorization(prepared.media.principal(), |guard|->Result<(),HttpFailure> {
        let facet=store.geodata_facet(guard).map_err(|_|unavailable())?;
        let mut docs=Vec::new();let mut originals=Vec::new();let mut previews=Vec::new();let mut exclusions=Vec::new();let mut complete=true;
        let budget=budget()?;
        for document in &prepared.metadata.documents {
            let asset=prepared.metadata.document_assets.iter().find(|a|a["recordId"]==document["payload"]["original"]["assetId"]).ok_or_else(conflict)?;
            match facet.authorize_pack_document(prepared.media.principal(),&scope_storage(scope),document,asset) {
                Ok(())=>{},Err(e) if matches!(e.code,"not-found"|"forbidden")=>continue,Err(_)=>return Err(conflict()),
            }
            if document["lifecycle"]!="active" { continue; }
            let mut retained=document.clone();
            // Native document payloads contain provenance, not vault paths.
            if let Some(payload)=retained.get_mut("payload").and_then(Value::as_object_mut) { payload.remove("storageKey"); }
            docs.push(retained);
            for (role,pin) in [("original",&document["payload"]["original"]),("preview",&document["payload"]["preview"]["asset"])] {
                if pin.is_null() { continue; }
                let mut hash=None;
                if include_bytes {
                    let id=document["recordId"].as_str().ok_or_else(conflict)?;
                    let revision=document["revision"].as_u64().ok_or_else(conflict)?;
                    let read=if role=="original" { facet.read_original(prepared.media.principal(),&scope_storage(scope),id,revision,&budget) } else { facet.read_preview(prepared.media.principal(),&scope_storage(scope),id,revision,&budget) };
                    if let Ok((frame,bytes))=read {
                        let mime=frame["measuredContentType"].as_str().ok_or_else(conflict)?;
                        if digest(&bytes)!=pin["sha256"] || bytes.len() as u64!=pin["bytes"].as_u64().ok_or_else(conflict)? { return Err(conflict()); }
                        hash=builder.add(bytes,mime,"documents",role,json!({"recordType":"geodata-document","recordId":id,"revision":revision}))?;
                    }
                    if hash.is_none() { complete=false;let exclusion=json!({"section":"documents","code":"retained-bytes-unavailable","label":"A permitted Document byte resource is unavailable"});exclusions.push(exclusion.clone());builder.exclusions.push(exclusion); }
                }
                let reference=json!({"documentId":document["recordId"],"documentRevision":document["revision"],"assetId":pin["assetId"],"resourceSha256":hash,"availability":if hash.is_some(){"available"}else{"unavailable"}});
                if role=="original" { originals.push(reference); }else{previews.push(reference);}
            }
        }
        output=Some(if include_bytes { builder.section(json!({"profile":"houseatlas.home-read-pack.documents.v1","documents":docs,"originals":originals,"previews":previews,"exclusions":exclusions}),"documents",complete)? } else { Value::Array(docs) });
        Ok(())
    })?;
    output.ok_or_else(unavailable)
}
// Immutable publication files are checked outside Core, before and after byte work.
// An unavailable selection stays explicit; a change of availability fences the cut.
fn publication_state(host: &Host, scope: &d::Scope) -> Value {
    let Some(overview) = host.model_overview.as_deref().filter(|s| s.matches(scope)) else {
        return Value::Null;
    };
    let scene = host.atlas_scene.as_deref();
    json!({"overview":overview.manifest_sha256,
        "original":overview.read_original().ok().map(|b|digest(&b)),
        "scene":scene.map(|s|json!({"semanticsSha256":s.semantics_sha256,"selectionRevision":s.revision,
            "bytes":s.read_companion(overview).ok().map(|b|digest(&b))})),
        "roomLinks":host.atlas_room_links.as_deref().map(|links|
            scene.and_then(|scene|links.read(scene,overview).ok()).map(|b|digest(&b)))})
}
fn model(host: &Host, scope: &d::Scope, b: &mut Builder) -> Result<Value, HttpFailure> {
    let Some(selected) = host.model_overview.as_deref().filter(|s| s.matches(scope)) else {
        return Ok(empty_section("not-configured"));
    };
    let m = &selected.manifest;
    let original = match selected.read_original() {
        Ok(bytes) => b.add(bytes, "model/gltf-binary", "model", "model", Value::Null)?,
        Err(_) => None,
    };
    let overview = json!({"profile":"houseatlas.model-overview-read.v1","scope":m.scope,
        "publicationId":m.publication_id,"manifestSha256":selected.manifest_sha256,"label":m.label,
        "qualification":m.qualification,"frame":m.frame,"components":m.components,"sourceNote":m.source_note,
        "original":{"contentType":m.original.content_type,"sha256":m.original.sha256,"bytes":m.original.bytes,
        "resourceSha256":original}});
    let mut complete = original.is_some();
    if !complete {
        b.exclusion(
            "model",
            "selected-model-unavailable",
            "The selected complete GLB cannot be included",
        );
    }
    let mut unified = Value::Null;
    if let Some(scene) = host.atlas_scene.as_deref() {
        if let Ok(bytes) = scene.read_companion(selected) {
            let size = bytes.len();
            // This bounded 12 MiB source resource is deliberately not a generic
            // section body; v1 section consumers have a stricter JSON parser.
            let companion = b.add(bytes, "application/json", "model", "model", Value::Null)?;
            let mut room_links = Value::Null;
            if let Some(links) = host.atlas_room_links.as_deref()
                && let Ok(bytes) = links.read(scene, selected)
            {
                let size = bytes.len();
                if let Some(resource) =
                    b.add(bytes, "application/json", "model", "model", Value::Null)?
                {
                    room_links = json!({"resourceSha256":resource,"bytes":size,"contentType":"application/json"});
                }
            }
            if room_links.is_null() {
                complete = false;
                b.exclusion(
                    "model",
                    "room-map-unavailable",
                    "No independently qualified room map is included for this publication",
                );
            }
            complete &= companion.is_some();
            if let (Some(companion), Some(original)) = (companion, original.as_ref()) {
                unified = json!({"profile":"houseatlas.home-read-pack.unified-atlas.v1","scope":scope,
                    "publicationId":m.publication_id,"semanticsSha256":scene.semantics_sha256,
                    "selectionRevision":scene.revision,"companion":{"resourceSha256":companion,
                    "bytes":size,"contentType":"application/json"},"originalResourceSha256":original,"roomLinks":room_links});
            }
        } else {
            complete = false;
            b.exclusion(
                "model",
                "unified-companion-unavailable",
                "The admitted unified Atlas companion cannot be included",
            );
        }
    } else {
        complete = false;
        b.exclusion("model", "unified-atlas-not-configured", "Only an overview is selected; unified plans and documentary overlays are not configured");
    }
    b.section(json!({"profile":"houseatlas.home-read-pack.model.v2","overview":overview,"unifiedAtlas":unified}), "model", complete)
}
fn build(
    host: &Host,
    prepared: &Prepared,
    scope: &d::Scope,
) -> Result<(String, Arc<Pack>), HttpFailure> {
    let mut b = Builder::empty();
    let mut sections = serde_json::Map::new();
    sections.insert("home".into(),b.section(json!({"profile":"houseatlas.home-read-pack.home.v1","scope":scope,"label":prepared.label,"selection":{"workspaceId":scope.workspace_id,"homeId":scope.home_id,"buildingId":null,"floorId":null,"roomId":null}}),"home",true)?);
    let mut records =
        serde_json::to_value(&prepared.snapshot.records).map_err(|_| unavailable())?;
    for record in records.as_array_mut().ok_or_else(unavailable)? {
        if record["recordType"] == "asset"
            && let Some(payload) = record["payload"].as_object_mut()
        {
            payload.remove("storageKey");
        }
    }
    let revisions=prepared.snapshot.records.iter().map(|r|json!({"recordType":r.record_type,"recordId":r.record_id,"revision":r.revision,"lastAuditId":r.last_audit_id})).collect::<Vec<_>>();
    let mut atlas_complete = true;
    let frozen = FrozenAssets { prepared };
    let access = NativeMediaAccess::new(prepared.access.clone());
    let service = MediaService::new(&frozen, &access, &prepared.vault);
    let budget = budget()?;
    for record in &prepared.snapshot.records {
        if record.record_type != s::RecordType::Asset || record.lifecycle != s::Lifecycle::Active {
            continue;
        }
        let delivered = service.deliver(
            &prepared.media,
            &media_scope(scope),
            &OwnedDescriptor::AtlasAsset {
                asset_id: record.record_id.clone(),
            },
            ReadMethod::Get,
            DeliveryMode::Download,
            &budget,
        );
        let saved = match delivered {
            Ok(delivered) => {
                let mime = delivered
                    .headers
                    .iter()
                    .find(|(k, _)| *k == "content-type")
                    .map(|(_, v)| v.as_str())
                    .ok_or_else(unavailable)?;
                if digest(&delivered.body) != record.payload["sha256"] {
                    return Err(conflict());
                }
                b.add(delivered.body,mime,"atlas","original",json!({"recordType":"asset","recordId":record.record_id,"revision":record.revision}))?.is_some()
            }
            Err(_) => false,
        };
        if !saved {
            atlas_complete = false;
            b.exclusion(
                "atlas",
                "retained-bytes-unavailable",
                "An active native asset cannot be included through its current Media policy",
            );
        }
    }
    let mut scans = Vec::new();
    let mut admitted_floor = false;
    for semantics in prepared.snapshot.records.iter().filter(|r| {
        r.record_type == s::RecordType::LocationSemantics
            && r.lifecycle == s::Lifecycle::Active
            && r.payload["semanticKind"] == "building"
            && r.payload["reviewStatus"] == "accepted"
    }) {
        let building_id = semantics.payload["atlasId"].as_str().ok_or_else(conflict)?;
        let mut offered = Vec::new();
        let mut complete = true;
        match m::geometry_bundle::floors(
            &prepared.snapshot,
            &scope_storage(scope),
            building_id,
            &prepared.vault,
            &budget,
        ) {
            Ok(floors) => {
                for floor in floors {
                    let original = &floor.original.payload;
                    let derivative = &floor.derivative.payload;
                    let included = [original, derivative].iter().all(|p| {
                        b.resources.get(&p.sha256).is_some_and(|r| {
                            r.descriptor["contentType"] == p.content_type
                                && r.bytes.len() as u64 == p.byte_size
                        })
                    });
                    if included {
                        admitted_floor = true;
                        offered.push(json!({"floor":floor.descriptor,"originalResourceSha256":original.sha256,"derivativeResourceSha256":derivative.sha256}));
                    } else {
                        complete = false;
                    }
                }
            }
            Err(_) => complete = false,
        }
        if !complete {
            atlas_complete = false;
            b.exclusion(
                "atlas",
                "scans-unavailable",
                "A native scan cannot be included through its admitted geometry and Media owners",
            );
        }
        scans.push(json!({"profile":"houseatlas.native-geometry.v2","scope":scope,"buildingId":building_id,"state":if complete{"complete"}else{"unavailable"},"floors":offered,"physicalScale":"unknown","floorAlignment":"unknown","stageToHouseTransform":null}));
    }
    if !admitted_floor
        && prepared.snapshot.records.iter().any(|r| {
            r.record_type == s::RecordType::Geometry && r.lifecycle == s::Lifecycle::Active
        })
    {
        atlas_complete = false;
        b.exclusion(
            "atlas",
            "scans-unavailable",
            "Retained geometry has no admitted floor descriptor for offline rendering",
        );
    }
    sections.insert("atlas".into(),b.section(json!({"contractVersion":prepared.snapshot.contract_version,"synthetic":prepared.snapshot.synthetic,"records":documentary(&records),"revisions":revisions,"nativeGeometry":scans,"sources":prepared.snapshot.sources,"caches":prepared.snapshot.caches}),"atlas",atlas_complete)?);
    let source_complete = !prepared
        .snapshot
        .caches
        .iter()
        .any(|c| c["status"] == "access-revoked");
    if !source_complete {
        b.exclusion(
            "inventory",
            "source-withheld",
            "A retained source partition is not included under current authorization",
        );
    }
    let inventory_complete = !prepared
        .snapshot
        .homebox_entities
        .iter()
        .any(|row| row["attachments"].as_array().is_some_and(|a| !a.is_empty()));
    if !inventory_complete {
        b.exclusion(
            "inventory",
            "external-attachments-unarchived",
            "HomeBox attachment bytes are not included by the retained projection API",
        );
    }
    sections.insert("inventory".into(),b.section(json!({"entities":documentary(&json!(prepared.snapshot.homebox_entities)),"sources":prepared.snapshot.sources,"caches":prepared.snapshot.caches}),"inventory",inventory_complete&&source_complete)?);
    sections.insert("network".into(),b.section(json!({"relations":prepared.snapshot.network_relations,"sources":prepared.snapshot.sources,"caches":prepared.snapshot.caches}),"network",source_complete)?);
    sections.insert(
        "documents".into(),
        documents(host, prepared, scope, &mut b, true)?,
    );
    let model = model(host, scope, &mut b)?;
    sections.insert("model".into(), model);
    let mut manifest = json!({"profile":"houseatlas.home-read-pack.v1","scope":scope,"capturedAt":time::OffsetDateTime::from(std::time::SystemTime::now()).format(&time::format_description::well_known::Rfc3339).map_err(|_|unavailable())?,"completeness":if b.exclusions.is_empty(){"complete"}else{"partial"},"limits":{"metadataBytes":METADATA,"totalBytes":TOTAL,"resources":512,"rangeBytes":RANGE},"totals":{"bytes":b.bytes,"resources":b.resources.len()},"sections":sections,"resources":b.order.iter().map(|h|b.resources[h].descriptor.clone()).collect::<Vec<_>>(),"exclusions":b.exclusions});
    let id = digest(&encoded(&manifest)?);
    manifest["snapshotId"] = json!(id);
    for resource in manifest["resources"]
        .as_array_mut()
        .ok_or_else(unavailable)?
    {
        resource["href"] = json!(format!(
            "/api/atlas/offline/v1/workspaces/{}/homes/{}/snapshots/{}/resources/{}",
            scope.workspace_id,
            scope.home_id,
            id,
            resource["sha256"].as_str().ok_or_else(unavailable)?
        ));
    }
    let manifest = encoded(&manifest)?;
    if b.metadata + manifest.len() > METADATA {
        return Err(failure(StatusCode::PAYLOAD_TOO_LARGE));
    }
    Ok((
        id,
        Arc::new(Pack {
            scope: scope.clone(),
            fingerprint: encoded(
                &json!({"cut":digest(&prepared.fingerprint),"visibility":prepared.visibility,"publication":prepared.publication}),
            )?,
            manifest,
            resources: b.resources,
        }),
    ))
}
fn response(
    bytes: Vec<u8>,
    mime: &str,
    whole: &str,
    range: Option<(usize, usize, usize)>,
) -> HttpResult {
    let hash = Sha256::digest(&bytes);
    let len = bytes.len();
    let mut response = bytes.into_response();
    for (key, value) in [
        ("content-type", mime.to_string()),
        ("content-length", len.to_string()),
        ("accept-ranges", "bytes".into()),
        ("etag", format!("\"{whole}\"")),
        (
            "content-digest",
            format!("sha-256=:{}:", STANDARD.encode(hash)),
        ),
        ("x-atlas-offline-resource-sha256", whole.to_string()),
    ] {
        response.headers_mut().insert(
            header::HeaderName::from_static(key),
            header::HeaderValue::from_str(&value).map_err(|_| unavailable())?,
        );
    }
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        header::HeaderValue::from_static("attachment; filename=\"offline-resource\""),
    );
    response.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        header::HeaderValue::from_static("default-src 'none'; sandbox"),
    );
    if let Some((start, end, total)) = range {
        *response.status_mut() = StatusCode::PARTIAL_CONTENT;
        response.headers_mut().insert(
            header::CONTENT_RANGE,
            header::HeaderValue::from_str(&format!("bytes {start}-{end}/{total}"))
                .map_err(|_| unavailable())?,
        );
    }
    Ok(response)
}
fn parse_range(value: Option<&str>, len: usize) -> Result<Option<(usize, usize)>, HttpFailure> {
    let Some(value) = value else { return Ok(None) };
    let invalid = || failure(StatusCode::RANGE_NOT_SATISFIABLE);
    let (start, end) = value
        .strip_prefix("bytes=")
        .and_then(|s| s.split_once('-'))
        .ok_or_else(invalid)?;
    let start = start.parse::<usize>().map_err(|_| invalid())?;
    let end = end.parse::<usize>().map_err(|_| invalid())?;
    if end < start || end >= len || end - start >= RANGE {
        return Err(invalid());
    }
    Ok(Some((start, end)))
}
enum Request {
    Capture,
    Manifest(String),
    Resource(String, String, Option<String>),
}
fn serve(
    host: &Host,
    headers: &CheckedHeaders,
    uri: &Uri,
    method: &Method,
    scope: &d::Scope,
    request: Request,
) -> HttpResult {
    if uri.query().is_some() {
        return Err(failure(StatusCode::NOT_FOUND));
    }
    authorized_read_unlocked(host, headers, uri, method, scope.clone(), |p| {
        let prepared = prepare(host, p, headers, uri, method, scope)?;
        match request {
            Request::Capture => {
                let (id, pack) = build(host, &prepared, scope)?;
                recheck(host, p, &prepared, scope)?;
                let body = pack.manifest.clone();
                host.offline_packs
                    .lock()
                    .map_err(|_| unavailable())?
                    .insert(id, pack);
                response(body.clone(), "application/json", &digest(&body), None)
            }
            ref resumed @ (Request::Manifest(ref id) | Request::Resource(ref id, _, _)) => {
                let pack = host
                    .offline_packs
                    .lock()
                    .map_err(|_| unavailable())?
                    .get(id, scope)?;
                if pack.fingerprint
                    != encoded(
                        &json!({"cut":digest(&prepared.fingerprint),"visibility":prepared.visibility,"publication":prepared.publication}),
                    )?
                {
                    return Err(conflict());
                }
                // Re-enter each actual native byte owner, including preview receipt
                // qualification. The registry correlates immutable data, not authority.
                let (_, current) = build(host, &prepared, scope)?;
                if current.resources.len() != pack.resources.len()
                    || current.resources.iter().any(|(hash, value)| {
                        pack.resources.get(hash).is_none_or(|old| {
                            old.descriptor != value.descriptor
                                || old.bytes.as_ref() != value.bytes.as_ref()
                        })
                    })
                {
                    return Err(conflict());
                }
                recheck(host, p, &prepared, scope)?;
                match resumed {
                    Request::Manifest(_) => response(
                        pack.manifest.clone(),
                        "application/json",
                        &digest(&pack.manifest),
                        None,
                    ),
                    Request::Resource(_, hash, range) => {
                        let resource = pack
                            .resources
                            .get(hash)
                            .ok_or_else(|| failure(StatusCode::NOT_FOUND))?;
                        let mime = resource.descriptor["contentType"]
                            .as_str()
                            .ok_or_else(unavailable)?;
                        if let Some((start, end)) =
                            parse_range(range.as_deref(), resource.bytes.len())?
                        {
                            response(
                                resource.bytes[start..=end].to_vec(),
                                mime,
                                hash,
                                Some((start, end, resource.bytes.len())),
                            )
                        } else {
                            response(resource.bytes.as_ref().clone(), mime, hash, None)
                        }
                    }
                    Request::Capture => Err(unavailable()),
                }
            }
        }
    })
}
pub(super) async fn manifest(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let _permit = headers.admission_permit()?;
        serve(
            &host,
            &headers,
            &uri,
            &method,
            &d::Scope {
                workspace_id,
                home_id,
            },
            Request::Capture,
        )
    })
    .await
    .map_err(|_| unavailable())?
}
pub(super) async fn retained_manifest(
    State(host): State<Host>,
    Path((workspace_id, home_id, id)): Path<(String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let _permit = headers.admission_permit()?;
        serve(
            &host,
            &headers,
            &uri,
            &method,
            &d::Scope {
                workspace_id,
                home_id,
            },
            Request::Manifest(id),
        )
    })
    .await
    .map_err(|_| unavailable())?
}
pub(super) async fn resource(
    State(host): State<Host>,
    Path((workspace_id, home_id, id, hash)): Path<(String, String, String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    raw: HeaderMap,
    uri: Uri,
    method: Method,
) -> HttpResult {
    let range = headers::single(&raw, "range").map_err(access_error)?;
    tokio::task::spawn_blocking(move || {
        let _permit = headers.admission_permit()?;
        serve(
            &host,
            &headers,
            &uri,
            &method,
            &d::Scope {
                workspace_id,
                home_id,
            },
            Request::Resource(id, hash, range),
        )
    })
    .await
    .map_err(|_| unavailable())?
}
