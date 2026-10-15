//! Explicit fresh v2 native dataset. Never upgrades or reads a legacy database.
//! Stock/presence commands are disabled; v1 core history is retained by adapters.
use super::{Error, Result, Scope};
use crate::{
    access as a, app,
    contracts::v2,
    media::{self as m, types as mt},
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
pub const LINEAGE: &str = "houseatlas-rust-storage/geodata/2";
pub const CONTRACT: &str = "2.0.0";
pub const SCHEMA: u32 = 1;
pub const RECOVERY_FORMAT: &str = "houseatlas-native-geodata-recovery/1";
const SQL: &str = include_str!("../../migrations/0001_geodata_v2.sql");
fn invalid() -> Error {
    Error::new(
        "schema-incompatible",
        "Geodata profile evidence is incompatible",
    )
}
fn need(ok: bool) -> Result<()> {
    if ok { Ok(()) } else { Err(invalid()) }
}
fn canonical(v: &Value) -> Result<String> {
    serde_jcs::to_string(v).map_err(|_| invalid())
}
fn hash(s: impl AsRef<[u8]>) -> String {
    m::types::sha256(s.as_ref())
}
fn parse(body: &str) -> Result<Value> {
    v2::parse_value(body.as_bytes()).map_err(|_| invalid())
}
fn shape(name: &str, value: &Value) -> Result<()> {
    v2::validate_value(name, value)
        .map_err(|_| Error::new("invalid-contract", "Invalid v2 contract"))
}
fn field<'a>(v: &'a Value, k: &str) -> Result<&'a str> {
    v[k].as_str().ok_or_else(invalid)
}
fn scope_value(s: &Scope) -> Value {
    json!({"workspaceId":s.workspace_id,"homeId":s.home_id})
}
fn media_error(_: m::MediaError) -> Error {
    Error::new("asset-unavailable", "Retained geodata bytes unavailable")
}
impl From<a::AccessError> for Error {
    fn from(_: a::AccessError) -> Self {
        Error::new("forbidden", "Native geodata authority unavailable")
    }
}
/// Trusted configuration port; source text, URL and license cannot issue grants.
/// Implementations must recheck current source policy for the exact record/pins.
/// Calls must be bounded and nonblocking. Use the borrowed native guard for
/// native checks; never reenter the held AccessBoundary or GeodataStore locks.
/// This port is a distinct source policy, not a SourceRef inferred from a URL.
pub trait GeodataSourcePolicy: Send + Sync {
    fn authorize(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        document: &Value,
        mutation: bool,
    ) -> Result<()>;
}
struct ListCursor {
    principal: a::Principal,
    scope: Scope,
    epoch: String,
    limit: u64,
    after: String,
    expires: Instant,
}
/// Owned fresh profile, retaining its existing public API and selection.
pub type GeodataStore = GeodataRepository<Connection, NativeGeodataAuthority>;
#[doc(hidden)]
pub trait GeodataConnection {
    fn connection(&self) -> &Connection;
}
impl GeodataConnection for Connection {
    fn connection(&self) -> &Connection {
        self
    }
}
impl GeodataConnection for &Connection {
    fn connection(&self) -> &Connection {
        self
    }
}
#[doc(hidden)]
pub trait GeodataAuthority: Clone {
    fn read(
        &self,
        p: &a::Principal,
        work: impl FnOnce(&a::TransactionAuthorization<'_>) -> Result<()>,
    ) -> Result<()>;
    fn mutate(
        &self,
        p: &a::Principal,
        work: impl FnOnce(&a::TransactionAuthorization<'_>) -> Result<()>,
    ) -> Result<()>;
}
#[doc(hidden)]
#[derive(Clone)]
pub struct NativeGeodataAuthority(app::Access);
impl GeodataAuthority for NativeGeodataAuthority {
    fn read(
        &self,
        p: &a::Principal,
        work: impl FnOnce(&a::TransactionAuthorization<'_>) -> Result<()>,
    ) -> Result<()> {
        self.0
            .lock()
            .map_err(|_| invalid())?
            .with_read_authorization(p, work)
    }
    fn mutate(
        &self,
        p: &a::Principal,
        work: impl FnOnce(&a::TransactionAuthorization<'_>) -> Result<()>,
    ) -> Result<()> {
        self.0
            .lock()
            .map_err(|_| invalid())?
            .with_mutation_authorization(p, work)
    }
}
#[derive(Clone, Copy)]
pub(crate) struct HeldGeodataAuthority<'a>(&'a a::TransactionAuthorization<'a>);
impl GeodataAuthority for HeldGeodataAuthority<'_> {
    fn read(
        &self,
        p: &a::Principal,
        work: impl FnOnce(&a::TransactionAuthorization<'_>) -> Result<()>,
    ) -> Result<()> {
        need(std::ptr::eq(p, self.0.principal()))?;
        self.0.revalidate()?;
        work(self.0)?;
        self.0.revalidate()?;
        Ok(())
    }
    fn mutate(
        &self,
        p: &a::Principal,
        work: impl FnOnce(&a::TransactionAuthorization<'_>) -> Result<()>,
    ) -> Result<()> {
        need(std::ptr::eq(p, self.0.principal()))?;
        self.0.assert_mutation()?;
        work(self.0)?;
        self.0.assert_mutation()?;
        Ok(())
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum GeodataSelection {
    Fresh,
    Full,
}
/// Trusted owners for a Document facet borrowing the original Core store.
#[derive(Clone)]
pub struct GeodataOwners {
    access: app::Access,
    vault: Arc<m::AssetVault>,
    policy: Arc<dyn GeodataSourcePolicy>,
    cursors: Arc<Mutex<BTreeMap<String, ListCursor>>>,
}
impl GeodataOwners {
    pub fn new(
        access: app::Access,
        vault: Arc<m::AssetVault>,
        policy: Arc<dyn GeodataSourcePolicy>,
    ) -> Self {
        Self {
            access,
            vault,
            policy,
            cursors: Arc::new(Mutex::new(BTreeMap::new())),
        }
    }
    pub fn belongs_to(&self, access: &app::Access, vault: &Arc<m::AssetVault>) -> bool {
        Arc::ptr_eq(&self.access, access) && Arc::ptr_eq(&self.vault, vault)
    }
    pub(crate) fn guarded<'a>(
        &self,
        db: &'a Connection,
        guard: &'a a::TransactionAuthorization<'a>,
    ) -> GeodataRepository<&'a Connection, HeldGeodataAuthority<'a>> {
        GeodataRepository {
            db,
            authority: HeldGeodataAuthority(guard),
            selection: GeodataSelection::Full,
            cursors: self.cursors.clone(),
            access: self.access.clone(),
            vault: self.vault.clone(),
            policy: self.policy.clone(),
        }
    }
    pub(crate) fn recovery<'a>(
        &self,
        db: &'a Connection,
    ) -> GeodataRepository<&'a Connection, NativeGeodataAuthority> {
        GeodataRepository {
            db,
            authority: NativeGeodataAuthority(self.access.clone()),
            selection: GeodataSelection::Full,
            cursors: self.cursors.clone(),
            access: self.access.clone(),
            vault: self.vault.clone(),
            policy: self.policy.clone(),
        }
    }
    pub(crate) fn for_vault(&self, vault: Arc<m::AssetVault>) -> Self {
        Self {
            access: self.access.clone(),
            vault,
            policy: self.policy.clone(),
            cursors: Arc::new(Mutex::new(BTreeMap::new())),
        }
    }
    pub(crate) fn vault(&self) -> &Arc<m::AssetVault> {
        &self.vault
    }
}
#[doc(hidden)]
pub struct GeodataRepository<D, U> {
    db: D,
    authority: U,
    selection: GeodataSelection,
    cursors: Arc<Mutex<BTreeMap<String, ListCursor>>>,
    access: app::Access,
    vault: Arc<m::AssetVault>,
    policy: Arc<dyn GeodataSourcePolicy>,
}
fn catalog(db: &Connection) -> Result<Vec<(String, String, String, String)>> {
    Ok(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name")?
        .query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?.collect::<rusqlite::Result<_>>()?)
}
pub(crate) fn validate_catalog(db: &Connection) -> Result<()> {
    let reference = Connection::open_in_memory()?;
    reference.execute_batch(SQL)?;
    need(catalog(db)? == catalog(&reference)?)?;
    need(db.query_row("PRAGMA user_version", [], |r| r.get::<_, u32>(0))? == SCHEMA)?;
    let metadata = db
        .prepare("SELECT key,value FROM atlas_rust_metadata ORDER BY key")?
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    need(
        metadata
            == vec![
                ("contractVersion".into(), CONTRACT.into()),
                ("lineage".into(), LINEAGE.into()),
            ],
    )?;
    let ledger = db
        .prepare("SELECT version,sha256 FROM atlas_rust_migrations ORDER BY version")?
        .query_map([], |r| Ok((r.get::<_, u32>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    need(ledger == vec![(SCHEMA, hash(SQL))])
}
impl GeodataStore {
    /// Fresh means an empty database. Existing paths are strictly refused here.
    pub fn create_fresh(
        path: &Path,
        access: app::Access,
        vault: Arc<m::AssetVault>,
        policy: Arc<dyn GeodataSourcePolicy>,
    ) -> Result<Self> {
        match std::fs::symlink_metadata(path) {
            Ok(metadata) => need(
                metadata.is_file() && !metadata.file_type().is_symlink() && metadata.len() == 0,
            )?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(invalid()),
        }
        let mut db = Connection::open_with_flags(
            path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE
                | rusqlite::OpenFlags::SQLITE_OPEN_CREATE
                | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        need(tx.query_row("PRAGMA user_version", [], |r| r.get::<_, u32>(0))? == 0)?;
        need(
            tx.query_row(
                "SELECT count(*) FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'",
                [],
                |r| r.get::<_, i64>(0),
            )? == 0,
        )?;
        tx.execute_batch(SQL)?;
        tx.execute(
            "INSERT INTO atlas_rust_migrations VALUES(1,?1)",
            [hash(SQL)],
        )?;
        tx.pragma_update(None, "user_version", SCHEMA)?;
        tx.commit()?;
        validate_catalog(&db)?;
        db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")?;
        Ok(Self {
            db,
            cursors: Arc::new(Mutex::new(BTreeMap::new())),
            authority: NativeGeodataAuthority(access.clone()),
            selection: GeodataSelection::Fresh,
            access,
            vault,
            policy,
        })
    }
    /// Validate with a read-only handle before any writable PRAGMA or WAL work.
    pub fn open_existing(
        path: &Path,
        access: app::Access,
        vault: Arc<m::AssetVault>,
        policy: Arc<dyn GeodataSourcePolicy>,
        budget: &m::WorkBudget,
    ) -> Result<Self> {
        let db = Connection::open_with_flags(
            path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )?;
        let probe = Self {
            db,
            cursors: Arc::new(Mutex::new(BTreeMap::new())),
            authority: NativeGeodataAuthority(access.clone()),
            selection: GeodataSelection::Fresh,
            access: access.clone(),
            vault: vault.clone(),
            policy: policy.clone(),
        };
        probe.validate_recovery(budget)?;
        drop(probe);
        let db = Connection::open_with_flags(
            path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )?;
        let selected = Self {
            db,
            cursors: Arc::new(Mutex::new(BTreeMap::new())),
            authority: NativeGeodataAuthority(access.clone()),
            selection: GeodataSelection::Fresh,
            access,
            vault,
            policy,
        };
        selected.validate_recovery(budget)?;
        selected
            .db
            .execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")?;
        Ok(selected)
    }
    pub fn access(&self) -> &app::Access {
        &self.access
    }
    pub fn vault(&self) -> &Arc<m::AssetVault> {
        &self.vault
    }
}
impl<D: GeodataConnection, U: GeodataAuthority> GeodataRepository<D, U> {
    fn authorize(
        guard: &a::TransactionAuthorization<'_>,
        scope: &Scope,
        mutation: bool,
    ) -> Result<()> {
        let selected = app::access_scope(&crate::domain::Scope {
            workspace_id: scope.workspace_id.clone(),
            home_id: scope.home_id.clone(),
        })?;
        guard.authorize(
            &selected,
            if mutation {
                a::Capability::Mutate
            } else {
                a::Capability::Read
            },
        )?;
        Ok(())
    }
    /// Atomically creates measured retained original, custody receipt and Document.
    /// IDs and request semantics are caller selected; audit metadata is server derived.
    pub fn create_original(
        &mut self,
        principal: &a::Principal,
        scope: &Scope,
        request: &Value,
        bytes: &[u8],
        budget: &m::WorkBudget,
    ) -> Result<Value> {
        let authority = self.authority.clone();
        let mut result = None;
        authority.mutate(principal,|guard| -> Result<()> {
            Self::authorize(guard,scope,true)?;
            need(request.as_object().is_some_and(|v|v.len()==7 && ["mutationId","documentId","assetId","title","contentType","provenance","reason"].iter().all(|k|v.contains_key(*k))))?;
            let normalized_request=canonical(&json!({"scope":scope_value(scope),"request":request,"sha256":hash(bytes),"bytes":bytes.len()}))?;
            let request_hash=hash(&normalized_request);
            let mutation=field(request,"mutationId")?;need(mt::is_uuid(mutation))?;
            if let Some((saved_hash,body))=self.db.connection().query_row("SELECT payload_hash,body FROM geodata_mutation_receipts WHERE workspace_id=?1 AND home_id=?2 AND actor_id=?3 AND mutation_id=?4",params![scope.workspace_id,scope.home_id,principal.actor_id().as_str(),mutation],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).optional()? {
                if saved_hash!=request_hash {return Err(Error::new("identity-conflict","Mutation identity already retained"));}
                let saved=parse(&body)?;self.policy.authorize(guard,&saved["document"],true)?;
                self.validate_mutation_evidence(budget)?;guard.assert_mutation()?;result=Some(saved);return Ok(());
            }
            let kind=mt::ContentType::parse_owned(field(request,"contentType")?).map_err(media_error)?;
            need(matches!(kind,mt::ContentType::GeoJson|mt::ContentType::GeoTiff|mt::ContentType::CityJson|mt::ContentType::Json|mt::ContentType::Pdf|mt::ContentType::Png))?;
            need(!bytes.is_empty() && bytes.len()<=m::MAX_BYTES)?;
            m::content::validate_original_content(bytes,kind,budget).map_err(media_error)?;
            let ms=mt::Scope{workspace_id:scope.workspace_id.clone(),home_id:scope.home_id.clone()};
            let prepared=self.vault.prepare_original(&ms,mt::AssetPurpose::EvidenceOriginal,kind,&mut &*bytes,budget).map_err(media_error)?;
            let asset_id=field(request,"assetId")?;let document_id=field(request,"documentId")?;need(mt::is_uuid(asset_id)&&mt::is_uuid(document_id)&&asset_id!=document_id)?;
            let now=app::now().map_err(|_|invalid())?;
            let pin=json!({"assetId":asset_id,"revision":1,"sha256":prepared.identity.sha256,"bytes":prepared.identity.byte_size});
            let mut provenance=request["provenance"].clone();need(provenance.as_object().is_some_and(|o|!o.contains_key("custodyReceiptSha256")))?;
            let custody=json!({"profile":"houseatlas.geodata-custody-receipt.v1","scope":scope_value(scope),"asset":pin,"retrievedAt":provenance["retrievedAt"],"sourceUrl":provenance["url"],"admissionProfile":admission_profile(kind),"measuredContentType":kind.as_str()});
            let custody_body=canonical(&custody)?;let custody_hash=hash(&custody_body);provenance["custodyReceiptSha256"]=json!(custody_hash);
            let license:mt::SourceLicense=serde_json::from_value(provenance["license"].clone())?;
            let manifest=prepared.into_measured().with_provenance(license.clone(),vec![]).map_err(media_error)?;
            let asset_audit=app::new_id()?;let doc_audit=app::new_id()?;
            let asset=json!({"schemaVersion":2,"recordType":"asset","recordId":asset_id,"workspaceId":scope.workspace_id,"homeId":scope.home_id,"revision":1,"lifecycle":"active","createdAt":now,"updatedAt":now,"lastAuditId":asset_audit,"payload":{"owner":"atlas","purpose":"original","sha256":pin["sha256"],"bytes":pin["bytes"],"contentType":kind.as_str(),"sourceLicense":license,"availability":"available"}});
            let mut document=json!({"schemaVersion":2,"recordType":"geodata-document","recordId":document_id,"workspaceId":scope.workspace_id,"homeId":scope.home_id,"revision":1,"lifecycle":"active","createdAt":now,"updatedAt":now,"lastAuditId":doc_audit,"payload":{"profile":"houseatlas.geodata-document.v2","title":request["title"],"original":pin,"provenance":provenance,"preview":null}});
            shape("record",&asset)?;validate_document(&document,self.selection==GeodataSelection::Full)?;shape("geodataCustodyReceipt",&custody)?;self.policy.authorize(guard,&document,true)?;
            let preview=self.qualify_png(&mut document,&asset,&manifest,bytes,budget)?;
            validate_document(&document,self.selection==GeodataSelection::Full)?;
            let result_body=json!({"document":document,"asset":asset});
            let tx=rusqlite::Transaction::new_unchecked(self.db.connection(),TransactionBehavior::Immediate)?;
            insert_record(&tx,&asset)?;insert_record(&tx,&document)?;
            if let Some((preview_asset,preview_manifest,receipt_sha,receipt_body))=&preview {
                insert_record(&tx,preview_asset)?;tx.execute("INSERT INTO geodata_asset_manifests VALUES(?1,?2,?3,?4)",params![scope.workspace_id,scope.home_id,field(preview_asset,"recordId")?,canonical(&serde_json::to_value(preview_manifest)?)?])?;
                tx.execute("INSERT OR IGNORE INTO geodata_receipts VALUES(?1,'derivation',?2,?3,?4)",params![receipt_sha,scope.workspace_id,scope.home_id,receipt_body])?;
                journal(&tx,preview_asset,None,principal,mutation,field(request,"reason")?)?;
            }

            tx.execute("INSERT INTO geodata_receipts VALUES(?1,'custody',?2,?3,?4)",params![custody_hash,scope.workspace_id,scope.home_id,custody_body])?;
            tx.execute("INSERT INTO geodata_asset_manifests VALUES(?1,?2,?3,?4)",params![scope.workspace_id,scope.home_id,asset_id,canonical(&serde_json::to_value(manifest)?)?])?;
            insert_ref(&tx,&document)?;
            journal(&tx,&asset,None,principal,mutation,field(request,"reason")?)?;journal(&tx,&document,None,principal,mutation,field(request,"reason")?)?;
            tx.execute("INSERT INTO geodata_mutation_receipts VALUES(?1,?2,?3,?4,?5,?6,?7)",params![scope.workspace_id,scope.home_id,principal.actor_id().as_str(),mutation,request_hash,canonical(&result_body)?,normalized_request])?;
            Self::authorize(guard,scope,true)?;self.policy.authorize(guard,&document,true)?;guard.assert_mutation()?;budget.check().map_err(media_error)?;tx.commit()?;result=Some(result_body);Ok(())
        })?;
        result.ok_or_else(invalid)
    }
}
fn insert_record(db: &Connection, r: &Value) -> Result<()> {
    db.execute(
        "INSERT INTO geodata_records VALUES(?1,?2,?3,?4,?5,?6)",
        params![
            field(r, "workspaceId")?,
            field(r, "homeId")?,
            field(r, "recordId")?,
            field(r, "recordType")?,
            r["revision"].as_i64().ok_or_else(invalid)?,
            canonical(r)?
        ],
    )?;
    Ok(())
}
fn insert_ref(db: &Connection, d: &Value) -> Result<()> {
    let p = &d["payload"]["original"];
    db.execute(
        "INSERT INTO geodata_document_refs VALUES(?1,?2,?3,?4,?5,?6,?7,'original',?8)",
        params![
            field(d, "workspaceId")?,
            field(d, "homeId")?,
            field(d, "recordId")?,
            field(p, "assetId")?,
            p["revision"].as_i64().ok_or_else(invalid)?,
            field(p, "sha256")?,
            p["bytes"].as_i64().ok_or_else(invalid)?,
            field(&d["payload"]["provenance"], "custodyReceiptSha256")?
        ],
    )?;
    if !d["payload"]["preview"].is_null() {
        let p = &d["payload"]["preview"]["asset"];
        db.execute(
            "INSERT INTO geodata_document_refs VALUES(?1,?2,?3,?4,?5,?6,?7,'preview',?8)",
            params![
                field(d, "workspaceId")?,
                field(d, "homeId")?,
                field(d, "recordId")?,
                field(p, "assetId")?,
                p["revision"].as_i64().ok_or_else(invalid)?,
                field(p, "sha256")?,
                p["bytes"].as_i64().ok_or_else(invalid)?,
                field(&d["payload"]["preview"], "qualificationReceiptSha256")?
            ],
        )?;
    }
    Ok(())
}
fn journal(
    db: &Connection,
    r: &Value,
    before: Option<&Value>,
    principal: &a::Principal,
    mutation: &str,
    reason: &str,
) -> Result<Value> {
    let audit = json!({"schemaVersion":1,"auditId":r["lastAuditId"],"workspaceId":r["workspaceId"],"homeId":r["homeId"],"record":{"recordType":r["recordType"],"recordId":r["recordId"]},"operation":if before.is_none(){"create"}else if r["lifecycle"]=="tombstoned"{"tombstone"}else if before.is_some_and(|v|v["lifecycle"]=="tombstoned"){"restore"}else{"replace"},"previousRevision":before.map(|r|r["revision"].clone()),"resultRevision":r["revision"],"actorId":principal.actor_id().as_str(),"at":r["updatedAt"],"reason":reason,"mutationId":mutation,"beforeDigest":before.map(|r|canonical(r).map(hash)).transpose()?,"afterDigest":hash(canonical(r)?)});
    shape("audit", &audit)?;
    db.execute("INSERT INTO geodata_audits(workspace_id,home_id,record_id,audit_id,body,record_body) VALUES(?1,?2,?3,?4,?5,?6)",params![field(r,"workspaceId")?,field(r,"homeId")?,field(r,"recordId")?,field(r,"lastAuditId")?,canonical(&audit)?,canonical(r)?])?;
    Ok(audit)
}
impl<D: GeodataConnection, U: GeodataAuthority> GeodataRepository<D, U> {
    fn raw_record(&self, scope: &Scope, id: &str) -> Result<Value> {
        let body=self.db.connection().query_row("SELECT body FROM geodata_records WHERE workspace_id=?1 AND home_id=?2 AND record_id=?3",params![scope.workspace_id,scope.home_id,id],|r|r.get::<_,String>(0)).optional()?.ok_or(Error::new("not-found","Document unavailable"))?;
        parse(&body)
    }
    fn asset_media(&self, asset: &Value) -> Result<mt::AssetRecord> {
        let body=self.db.connection().query_row("SELECT body FROM geodata_asset_manifests WHERE workspace_id=?1 AND home_id=?2 AND record_id=?3",params![field(asset,"workspaceId")?,field(asset,"homeId")?,field(asset,"recordId")?],|r|r.get::<_,String>(0))?;
        let payload: mt::AssetPayload = serde_json::from_value(parse(&body)?)?;
        need(
            payload.owner == mt::AssetOwner::Atlas
                && payload.preview_policy == mt::PreviewPolicy::DownloadOnly
                && canonical(&serde_json::to_value(&payload)?)? == body
                && ((payload.purpose == mt::AssetPurpose::EvidenceOriginal
                    && asset["payload"]["purpose"] == "original")
                    || (payload.purpose == mt::AssetPurpose::DerivedPreview
                        && asset["payload"]["purpose"] == "preview"))
                && serde_json::to_value(payload.availability)? == asset["payload"]["availability"]
                && payload.evidence_ids.is_empty()
                && payload.sha256 == asset["payload"]["sha256"]
                && json!(payload.byte_size) == asset["payload"]["bytes"]
                && payload.content_type == asset["payload"]["contentType"]
                && serde_json::to_value(&payload.source_license)?
                    == asset["payload"]["sourceLicense"],
        )?;
        Ok(mt::AssetRecord {
            schema_version: 1,
            record_type: mt::AssetRecordType::Asset,
            record_id: field(asset, "recordId")?.into(),
            workspace_id: field(asset, "workspaceId")?.into(),
            home_id: field(asset, "homeId")?.into(),
            revision: asset["revision"].as_u64().ok_or_else(invalid)?,
            lifecycle: mt::Lifecycle::Active,
            created_at: field(asset, "createdAt")?.into(),
            updated_at: field(asset, "updatedAt")?.into(),
            last_audit_id: field(asset, "lastAuditId")?.into(),
            payload,
        })
    }
    fn original(&self, d: &Value) -> Result<Value> {
        let scope = Scope {
            workspace_id: field(d, "workspaceId")?.into(),
            home_id: field(d, "homeId")?.into(),
        };
        let pin = &d["payload"]["original"];
        let asset = self.raw_record(&scope, field(pin, "assetId")?)?;
        need(
            asset["recordType"] == "asset"
                && asset["payload"]["purpose"] == "original"
                && asset["revision"] == pin["revision"]
                && asset["payload"]["sha256"] == pin["sha256"]
                && asset["payload"]["bytes"] == pin["bytes"],
        )?;
        Ok(asset)
    }
    fn projection(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        d: Value,
        budget: &m::WorkBudget,
    ) -> Result<Value> {
        self.policy.authorize(guard, &d, false)?;
        let asset = self.original(&d)?;
        let available = if d["lifecycle"] != "active"
            || asset["lifecycle"] != "active"
            || asset["payload"]["availability"] != "available"
        {
            "unavailable"
        } else if self
            .vault
            .read_retained(&self.asset_media(&asset)?, budget)
            .is_ok()
        {
            "available"
        } else {
            "unavailable"
        };
        let preview = if d["payload"]["preview"].is_null() {
            "not-qualified"
        } else if available == "available" && self.verified_preview(&d, budget).is_ok() {
            "available"
        } else {
            "unavailable"
        };
        let value = json!({"profile":"houseatlas.geodata-document-read.v2","scope":{"workspaceId":d["workspaceId"],"homeId":d["homeId"]},"document":d,"availability":{"original":available,"preview":preview}});
        shape("geodataDocumentRead", &value)?;
        Ok(value)
    }
    pub fn get(
        &self,
        principal: &a::Principal,
        scope: &Scope,
        id: &str,
        budget: &m::WorkBudget,
    ) -> Result<Value> {
        let authority = self.authority.clone();
        let mut result = None;
        authority.read(principal, |guard| -> Result<()> {
            Self::authorize(guard, scope, false)?;
            let d = self.raw_record(scope, id)?;
            need(d["recordType"] == "geodata-document")?;
            let value = self.projection(guard, d.clone(), budget)?;
            need(self.raw_record(scope, id)? == d)?;
            self.policy.authorize(guard, &d, false)?;
            Self::authorize(guard, scope, false)?;
            result = Some(value);
            Ok(())
        })?;
        result.ok_or_else(invalid)
    }
    /// Cursor is opaque canonical JSON encoded URL-safe; its epoch binds every
    /// committed revision and scope. New writes invalidate earlier pages.
    pub fn list(
        &self,
        principal: &a::Principal,
        scope: &Scope,
        cursor: Option<&str>,
        limit: u64,
        budget: &m::WorkBudget,
    ) -> Result<Value> {
        need((1..=100).contains(&limit))?;
        let authority = self.authority.clone();
        let mut result = None;
        authority.read(principal,|guard|->Result<()> {
            Self::authorize(guard,scope,false)?;
            let epoch=self.epoch(scope)?;let mut after=String::new();
            if let Some(cursor)=cursor {
                need(cursor.len()==64)?;
                let mut cursors=self.cursors.lock().map_err(|_|invalid())?;
                cursors.retain(|_,c|c.expires>Instant::now());
                let c=cursors.get(cursor).ok_or(Error::new("revision-conflict","List continuation expired"))?;
                need(c.principal.same_authenticated_session(principal)&&c.scope==*scope&&c.epoch==epoch&&c.limit==limit)?;
                after=c.after.clone();
                cursors.remove(cursor);
            }
            let mut rows=self.db.connection().prepare("SELECT body FROM geodata_records WHERE workspace_id=?1 AND home_id=?2 AND record_type='geodata-document' AND record_id>?3 ORDER BY record_id LIMIT 1001")?;
            let bodies=rows.query_map(params![scope.workspace_id,scope.home_id,after],|r|r.get::<_,String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
            // Bound total work as well as response size; continuation includes
            // skipped denied rows and reveals no denied count.
            let mut documents=Vec::new();let mut last=None;let mut more=false;
            for body in &bodies {budget.check().map_err(media_error)?;let d=parse(body)?;if documents.len()>=limit as usize {more=true;break;}last=Some(field(&d,"recordId")?.to_owned());if d["lifecycle"]!="active" {continue;}match self.policy.authorize(guard,&d,false){Ok(())=>documents.push(self.projection(guard,d,budget)?),Err(e) if matches!(e.code,"not-found"|"forbidden")=>continue,Err(e)=>return Err(e)}}
            if bodies.len()==1001 {more=true;}
            for document in &documents { self.policy.authorize(guard,&document["document"],false)?; }
            need(self.epoch(scope)?==epoch)?;Self::authorize(guard,scope,false)?;
            let next=if more {if let Some(after)=last {
                let mut random=[0u8;32];getrandom::fill(&mut random).map_err(|_|invalid())?;
                let token=random.iter().map(|b|format!("{b:02x}")).collect::<String>();
                let mut cursors=self.cursors.lock().map_err(|_|invalid())?;
                cursors.retain(|_,c|c.expires>Instant::now());
                if cursors.len()>=256 {return Err(Error::new("storage-unavailable","List continuation capacity unavailable"));}
                cursors.insert(token.clone(),ListCursor{principal:principal.clone(),scope:scope.clone(),epoch:epoch.clone(),limit,after,expires:Instant::now()+Duration::from_secs(300)});Some(token)
            }else{None}}else{None};
            let page=json!({"profile":"houseatlas.geodata-document-list.v2","scope":scope_value(scope),"documents":documents,"nextCursor":next});shape("geodataDocumentList",&page)?;result=Some(page);Ok(())
        })?;
        result.ok_or_else(invalid)
    }
    fn epoch(&self, scope: &Scope) -> Result<String> {
        let epoch = self
            .db
            .connection()
            .query_row(
                "SELECT epoch FROM geodata_epochs WHERE workspace_id=?1 AND home_id=?2",
                params![scope.workspace_id, scope.home_id],
                |r| r.get::<_, i64>(0),
            )
            .optional()?
            .unwrap_or(0);
        Ok(epoch.to_string())
    }
    pub fn read_original(
        &self,
        principal: &a::Principal,
        scope: &Scope,
        id: &str,
        expected_revision: u64,
        budget: &m::WorkBudget,
    ) -> Result<(Value, Vec<u8>)> {
        let authority = self.authority.clone();
        let mut result = None;
        authority.read(principal,|guard|->Result<()> {
            Self::authorize(guard,scope,false)?;let d=self.raw_record(scope,id)?;need(d["recordType"]=="geodata-document")?;
            if d["revision"]!=expected_revision {return Err(Error::new("revision-conflict","Document revision changed"));}
            need(d["lifecycle"]=="active")?;self.policy.authorize(guard,&d,false)?;
            let asset=self.original(&d)?;need(asset["lifecycle"]=="active"&&asset["payload"]["availability"]=="available")?;
            let bytes=self.vault.read_retained(&self.asset_media(&asset)?,budget).map_err(media_error)?;
            need(self.raw_record(scope,id)?==d && self.original(&d)?==asset)?;
            self.policy.authorize(guard,&d,false)?;Self::authorize(guard,scope,false)?;budget.check().map_err(media_error)?;
            let frame=json!({"profile":"houseatlas.geodata-document-bytes.v2","scope":scope_value(scope),"documentId":id,"documentRevision":expected_revision,"mode":"original","asset":d["payload"]["original"],"measuredContentType":asset["payload"]["contentType"]});
            shape("geodataDocumentByteFrame",&frame)?;result=Some((frame,bytes));Ok(())
        })?;
        result.ok_or_else(invalid)
    }
}
fn admission_profile(kind: mt::ContentType) -> &'static str {
    match kind {
        mt::ContentType::GeoJson => "houseatlas.geodata-original.geojson.v1",
        mt::ContentType::GeoTiff => "houseatlas.geodata-original.geotiff.v1",
        mt::ContentType::CityJson => "houseatlas.geodata-original.cityjson.v1",
        mt::ContentType::Json => "houseatlas.native-original.json.v1",
        mt::ContentType::Pdf => "houseatlas.native-original.pdf.v1",
        mt::ContentType::Png => "houseatlas.native-original.png.v1",
        _ => "unsupported",
    }
}
fn validate_document(d: &Value, preview_allowed: bool) -> Result<()> {
    shape("geodataDocumentRecord", d)?;
    // This installer selects original-only admission. It cannot fabricate preview qualification.
    need(preview_allowed || d["payload"]["preview"].is_null())?;
    let provenance = &d["payload"]["provenance"];
    for name in ["published", "observed"] {
        let date = &provenance[name];
        if date.is_null() {
            continue;
        }
        let value = field(date, "value")?;
        match field(date, "precision")? {
            "year" => need(value.len() == 4 && value.bytes().all(|b| b.is_ascii_digit()))?,
            "day" => need(chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok())?,
            "instant" => need(chrono::DateTime::parse_from_rfc3339(value).is_ok())?,
            _ => return Err(invalid()),
        }
    }
    let frame = &provenance["frame"];
    if let Some(extent) = frame["extent"].as_array() {
        need(matches!(extent.len(), 4 | 6))?;
        let values = extent
            .iter()
            .map(|v| v.as_f64().filter(|n| n.is_finite()).ok_or_else(invalid))
            .collect::<Result<Vec<_>>>()?;
        need((0..values.len() / 2).all(|i| values[i] <= values[i + values.len() / 2]))?;
    }
    if let Some(url) = provenance["url"].as_str() {
        let url = url::Url::parse(url).map_err(|_| invalid())?;
        need(
            url.scheme() == "https"
                && url.username().is_empty()
                && url.password().is_none()
                && url.fragment().is_none()
                && url.host_str().is_some(),
        )?;
        for (key, _) in url.query_pairs() {
            let key = key.to_ascii_lowercase();
            // Only reviewed public selectors enter retained provenance. The
            // trusted source policy additionally qualifies their values/meaning.
            need(
                [
                    "bbox",
                    "bbox-crs",
                    "count",
                    "crs",
                    "cursor",
                    "f",
                    "fq",
                    "limit",
                    "outputformat",
                    "q",
                    "request",
                    "rows",
                    "service",
                    "typenames",
                    "version",
                ]
                .contains(&key.as_str()),
            )?;
        }
    }
    Ok(())
}
impl<D: GeodataConnection, U: GeodataAuthority> GeodataRepository<D, U> {
    /// Exhaustive same-profile validation: schema/catalog, legacy native core,
    /// immutable receipts, every historical body, exact refs and retained bytes.
    /// Credentials/sessions/grants are external and never reconstructed here.
    pub fn validate_recovery(&self, budget: &m::WorkBudget) -> Result<()> {
        if self.selection != GeodataSelection::Fresh {
            return Err(Error::new(
                "owner-unavailable",
                "Full profile recovery requires complete native Stock Jobs and Media peers",
            ));
        }
        validate_catalog(self.db.connection())?;
        let mut check = || budget.check().map_err(media_error);
        let legacy = super::validate_geodata_v1_core(
            self.db.connection(),
            &crate::http::contracts::NativeContracts,
            &mut check,
        )?;
        for r in legacy.assets {
            let record: mt::AssetRecord = serde_json::from_value(serde_json::to_value(r)?)?;
            self.vault
                .read_retained(&record, budget)
                .map_err(media_error)?;
        }
        self.validate_document_closure(budget)
    }
    fn validate_mutation_evidence(&self, budget: &m::WorkBudget) -> Result<()> {
        if self.selection == GeodataSelection::Fresh {
            self.validate_recovery(budget)
        } else {
            self.validate_document_closure(budget)
        }
    }
    pub(crate) fn validate_document_closure(&self, budget: &m::WorkBudget) -> Result<()> {
        need(!self.db.connection().query_row("SELECT EXISTS(SELECT 1 FROM records JOIN geodata_records USING(workspace_id,record_id))",[],|r|r.get::<_,bool>(0))?)?;
        let check = || budget.check().map_err(media_error);
        let mut records = BTreeMap::new();
        let mut assets = BTreeSet::new();
        let mut documents = BTreeMap::new();
        let mut rows=self.db.connection().prepare("SELECT workspace_id,home_id,record_id,record_type,revision,body FROM geodata_records ORDER BY workspace_id,record_id")?;
        let mut rows = rows.query([])?;
        while let Some(row) = rows.next()? {
            check()?;
            let body: String = row.get(5)?;
            let r = parse(&body)?;
            shape("record", &r)?;
            need(canonical(&r)? == body)?;
            need(
                field(&r, "workspaceId")? == row.get::<_, String>(0)?
                    && field(&r, "homeId")? == row.get::<_, String>(1)?
                    && field(&r, "recordId")? == row.get::<_, String>(2)?
                    && field(&r, "recordType")? == row.get::<_, String>(3)?
                    && r["revision"].as_i64() == Some(row.get(4)?),
            )?;
            need(r["schemaVersion"] == 2)?;
            let key = (
                field(&r, "workspaceId")?.to_owned(),
                field(&r, "recordId")?.to_owned(),
            );
            if r["recordType"] == "geodata-document" {
                validate_document(&r, self.selection == GeodataSelection::Full)?;
                self.validate_custody(&r)?;
                self.verified_preview(&r, budget)?;
                documents.insert(key.clone(), r.clone());
            } else {
                shape("geodataAssetRecord", &r)?;
                need(
                    r["payload"]["purpose"] == "original"
                        || (self.selection == GeodataSelection::Full
                            && r["payload"]["purpose"] == "preview"),
                )?;
                let media = self.asset_media(&r)?;
                let bytes = self
                    .vault
                    .read_retained(&media, budget)
                    .map_err(media_error)?;
                let kind = mt::ContentType::parse_owned(&media.payload.content_type)
                    .map_err(media_error)?;
                m::content::validate_original_content(&bytes, kind, budget).map_err(media_error)?;
                assets.insert(key.clone());
            }
            records.insert(key, r);
        }
        let manifests = self
            .db
            .connection()
            .prepare("SELECT workspace_id,record_id FROM geodata_asset_manifests")?
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<BTreeSet<_>>>()?;
        need(manifests == assets)?;
        let mut prior: BTreeMap<(String, String), Value> = BTreeMap::new();
        let mut audit_ids = BTreeSet::new();
        let mut audit_bodies = BTreeMap::new();
        let mut history = BTreeMap::new();
        let mut used_custody = BTreeSet::new();
        let mut document_history = BTreeMap::new();
        let mut rows=self.db.connection().prepare("SELECT workspace_id,home_id,record_id,audit_id,body,record_body FROM geodata_audits ORDER BY seq")?;
        let mut rows = rows.query([])?;
        while let Some(row) = rows.next()? {
            check()?;
            let body: String = row.get(4)?;
            let rb: String = row.get(5)?;
            let audit = parse(&body)?;
            let r = parse(&rb)?;
            shape("audit", &audit)?;
            shape("record", &r)?;
            need(r["schemaVersion"] == 2)?;
            need(canonical(&audit)? == body && canonical(&r)? == rb)?;
            let key = (
                field(&r, "workspaceId")?.to_owned(),
                field(&r, "recordId")?.to_owned(),
            );
            need(
                field(&r, "workspaceId")? == row.get::<_, String>(0)?
                    && field(&r, "homeId")? == row.get::<_, String>(1)?
                    && field(&r, "recordId")? == row.get::<_, String>(2)?
                    && field(&r, "lastAuditId")? == row.get::<_, String>(3)?,
            )?;
            need(
                audit["workspaceId"] == r["workspaceId"]
                    && audit["homeId"] == r["homeId"]
                    && audit["record"]["recordId"] == r["recordId"]
                    && audit["record"]["recordType"] == r["recordType"]
                    && audit["auditId"] == r["lastAuditId"]
                    && audit["resultRevision"] == r["revision"]
                    && audit["at"] == r["updatedAt"]
                    && audit["afterDigest"] == hash(&rb),
            )?;
            if let Some(p) = prior.get(&key) {
                need(
                    audit["previousRevision"] == p["revision"]
                        && r["revision"].as_u64()
                            == p["revision"].as_u64().and_then(|n| n.checked_add(1))
                        && r["createdAt"] == p["createdAt"]
                        && r["recordType"] == p["recordType"]
                        && r["homeId"] == p["homeId"]
                        && audit["beforeDigest"] == hash(canonical(p)?),
                )?;
                match field(&audit, "operation")? {
                    "replace" => need(p["lifecycle"] == "active" && r["lifecycle"] == "active")?,
                    "tombstone" => need(
                        p["lifecycle"] == "active"
                            && r["lifecycle"] == "tombstoned"
                            && p["payload"] == r["payload"],
                    )?,
                    "restore" => need(
                        p["lifecycle"] == "tombstoned"
                            && r["lifecycle"] == "active"
                            && p["payload"] == r["payload"],
                    )?,
                    _ => return Err(invalid()),
                }
                if r["recordType"] == "geodata-document" {
                    need(r["payload"]["original"] == p["payload"]["original"])?;
                } else {
                    need(r["payload"] == p["payload"])?;
                }
            } else {
                need(
                    r["revision"] == 1
                        && r["lifecycle"] == "active"
                        && audit["operation"] == "create"
                        && audit["previousRevision"].is_null()
                        && audit["beforeDigest"].is_null()
                        && r["createdAt"] == r["updatedAt"],
                )?;
            }
            if r["recordType"] == "geodata-document" {
                validate_document(&r, self.selection == GeodataSelection::Full)?;
                self.validate_custody(&r)?;
                self.verified_preview(&r, budget)?;
                if let Some(digest) = r["payload"]["preview"]["qualificationReceiptSha256"].as_str()
                {
                    used_custody.insert(digest.to_owned());
                }
                used_custody
                    .insert(field(&r["payload"]["provenance"], "custodyReceiptSha256")?.to_owned());
            }
            need(audit_ids.insert(field(&audit, "auditId")?.to_owned()))?;
            audit_bodies.insert(field(&audit, "auditId")?.to_owned(), audit.clone());
            history
                .entry((
                    field(&audit, "workspaceId")?.to_owned(),
                    field(&audit, "homeId")?.to_owned(),
                    field(&audit, "actorId")?.to_owned(),
                    field(&audit, "mutationId")?.to_owned(),
                ))
                .or_insert_with(Vec::new)
                .push(r.clone());
            if r["recordType"] == "geodata-document" {
                document_history.insert(
                    (key.clone(), r["revision"].as_u64().ok_or_else(invalid)?),
                    r.clone(),
                );
            }
            prior.insert(key, r);
        }
        need(prior == records)?;
        let mut combined =
            serde_json::to_value(super::repository::snapshot(self.db.connection())?)?;
        combined["contractVersion"] = json!(CONTRACT);
        let all = combined["records"].as_array_mut().ok_or_else(invalid)?;
        all.extend(records.values().cloned());
        shape("snapshot", &combined)?;
        let receipts = self
            .db
            .connection()
            .prepare("SELECT sha256,kind,workspace_id,home_id,body FROM geodata_receipts")?
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut retained = BTreeSet::new();
        for (digest, kind, w, h, body) in receipts {
            check()?;
            let receipt = parse(&body)?;
            shape(
                if kind == "custody" {
                    "geodataCustodyReceipt"
                } else {
                    "geodataDerivationReceipt"
                },
                &receipt,
            )?;
            need(
                (kind == "custody"
                    || (self.selection == GeodataSelection::Full && kind == "derivation"))
                    && hash(&body) == digest
                    && canonical(&receipt)? == body
                    && receipt["scope"]["workspaceId"] == w
                    && receipt["scope"]["homeId"] == h,
            )?;
            retained.insert(digest);
        }
        need(retained == used_custody)?;
        let mut expected_refs = BTreeSet::new();
        for d in documents.values() {
            let p = &d["payload"]["original"];
            expected_refs.insert((
                field(d, "workspaceId")?.to_owned(),
                field(d, "homeId")?.to_owned(),
                field(d, "recordId")?.to_owned(),
                field(p, "assetId")?.to_owned(),
                p["revision"].as_i64().ok_or_else(invalid)?,
                field(p, "sha256")?.to_owned(),
                p["bytes"].as_i64().ok_or_else(invalid)?,
                "original".to_owned(),
                field(&d["payload"]["provenance"], "custodyReceiptSha256")?.to_owned(),
            ));
        }
        for d in documents.values() {
            if !d["payload"]["preview"].is_null() {
                let p = &d["payload"]["preview"]["asset"];
                expected_refs.insert((
                    field(d, "workspaceId")?.to_owned(),
                    field(d, "homeId")?.to_owned(),
                    field(d, "recordId")?.to_owned(),
                    field(p, "assetId")?.to_owned(),
                    p["revision"].as_i64().ok_or_else(invalid)?,
                    field(p, "sha256")?.to_owned(),
                    p["bytes"].as_i64().ok_or_else(invalid)?,
                    "preview".into(),
                    field(&d["payload"]["preview"], "qualificationReceiptSha256")?.into(),
                ));
            }
        }
        let refs=self.db.connection().prepare("SELECT workspace_id,home_id,document_id,asset_id,asset_revision,sha256,bytes,role,receipt_sha256 FROM geodata_document_refs")?.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,i64>(4)?,r.get::<_,String>(5)?,r.get::<_,i64>(6)?,r.get::<_,String>(7)?,r.get::<_,String>(8)?)))?.collect::<rusqlite::Result<BTreeSet<_>>>()?;
        need(refs == expected_refs)?;
        let mut seen = BTreeSet::new();
        let mut rows=self.db.connection().prepare("SELECT workspace_id,home_id,actor_id,mutation_id,payload_hash,body,request_body FROM geodata_mutation_receipts")?;
        let mut rows = rows.query([])?;
        while let Some(row) = rows.next()? {
            check()?;
            let key = (
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            );
            let body: String = row.get(5)?;
            let request: String = row.get(6)?;
            let result = parse(&body)?;
            need(
                canonical(&result)? == body
                    && canonical(&parse(&request)?)? == request
                    && hash(&request) == row.get::<_, String>(4)?,
            )?;
            let retained = history.get(&key).ok_or_else(invalid)?;
            let normalized = parse(&request)?;
            let document = result.get("document").unwrap_or(&result["record"]);
            let audit = audit_bodies
                .get(field(document, "lastAuditId")?)
                .ok_or_else(invalid)?;
            need(normalized["scope"] == json!({"workspaceId":key.0,"homeId":key.1}))?;
            if let Some(asset) = result.get("asset") {
                need(
                    result.as_object().is_some_and(|o| o.len() == 2)
                        && normalized.as_object().is_some_and(|o| o.len() == 4),
                )?;
                let input = &normalized["request"];
                need(input.as_object().is_some_and(|v| {
                    v.len() == 7
                        && [
                            "mutationId",
                            "documentId",
                            "assetId",
                            "title",
                            "contentType",
                            "provenance",
                            "reason",
                        ]
                        .iter()
                        .all(|k| v.contains_key(*k))
                }))?;
                need(
                    input["mutationId"] == key.3
                        && input["documentId"] == document["recordId"]
                        && input["assetId"] == asset["recordId"]
                        && input["title"] == document["payload"]["title"]
                        && input["contentType"] == asset["payload"]["contentType"]
                        && normalized["sha256"] == asset["payload"]["sha256"]
                        && normalized["bytes"] == asset["payload"]["bytes"],
                )?;
                let mut provenance = document["payload"]["provenance"].clone();
                provenance
                    .as_object_mut()
                    .ok_or_else(invalid)?
                    .remove("custodyReceiptSha256");
                need(provenance == input["provenance"])?;
                for record in retained {
                    let a = audit_bodies
                        .get(field(record, "lastAuditId")?)
                        .ok_or_else(invalid)?;
                    need(
                        a["operation"] == "create"
                            && a["reason"] == input["reason"]
                            && record["revision"] == 1
                            && record["lifecycle"] == "active",
                    )?;
                }
            } else {
                shape("geodataDocumentMutationResult", &result)?;
                need(
                    result["audit"] == *audit
                        && result["replayed"] == false
                        && normalized.as_object().is_some_and(|o| o.len() == 3),
                )?;
                let command = &normalized["command"];
                shape("geodataDocumentMutation", command)?;
                need(
                    normalized["documentId"] == document["recordId"]
                        && command["mutationId"] == key.3
                        && command["operation"] == audit["operation"]
                        && command["expectedRevision"] == audit["previousRevision"]
                        && command["reason"] == audit["reason"],
                )?;
                if matches!(field(command, "operation")?, "create" | "replace") {
                    need(command["value"]["payload"] == document["payload"])?;
                }
                let before = match command["expectedRevision"].as_u64() {
                    Some(revision) => Some(
                        document_history
                            .get(&(
                                (
                                    field(document, "workspaceId")?.to_owned(),
                                    field(document, "recordId")?.to_owned(),
                                ),
                                revision,
                            ))
                            .ok_or_else(invalid)?,
                    ),
                    None => None,
                };
                need(command["guards"] == preview::required_guards(before, document))?;
            }
            need(retained.contains(result.get("document").unwrap_or(&result["record"])))?;
            if let Some(asset) = result.get("asset") {
                need(retained.contains(asset))?;
            }
            let expected = if result.get("asset").is_some() {
                if document["payload"]["preview"].is_null() {
                    2
                } else {
                    let (preview_asset, _) = self
                        .verified_preview(document, budget)?
                        .ok_or_else(invalid)?;
                    need(retained.contains(&preview_asset))?;
                    3
                }
            } else {
                1
            };
            need(retained.len() == expected)?;
            seen.insert(key);
        }
        need(seen == history.keys().cloned().collect())?;
        let expected_epochs=self.db.connection().prepare("SELECT workspace_id,home_id,count(*) FROM geodata_audits GROUP BY workspace_id,home_id ORDER BY workspace_id,home_id")?.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,i64>(2)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
        let epochs=self.db.connection().prepare("SELECT workspace_id,home_id,epoch FROM geodata_epochs ORDER BY workspace_id,home_id")?.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,i64>(2)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
        need(epochs == expected_epochs)?;
        for record in self
            .recovery_media()?
            .into_iter()
            .filter(|_| self.selection == GeodataSelection::Fresh)
        {
            self.vault
                .read_retained(&record, budget)
                .map_err(media_error)?;
        }
        check()
    }
    fn validate_custody(&self, d: &Value) -> Result<()> {
        let asset = self.original(d)?;
        let provenance = &d["payload"]["provenance"];
        let digest = field(provenance, "custodyReceiptSha256")?;
        let body=self.db.connection().query_row("SELECT body FROM geodata_receipts WHERE sha256=?1 AND workspace_id=?2 AND home_id=?3 AND kind='custody'",params![digest,field(d,"workspaceId")?,field(d,"homeId")?],|r|r.get::<_,String>(0))?;
        let receipt = parse(&body)?;
        shape("geodataCustodyReceipt", &receipt)?;
        let kind = mt::ContentType::parse_owned(field(&asset["payload"], "contentType")?)
            .map_err(media_error)?;
        need(
            hash(&body) == digest
                && canonical(&receipt)? == body
                && receipt["asset"] == d["payload"]["original"]
                && receipt["retrievedAt"] == provenance["retrievedAt"]
                && receipt["sourceUrl"] == provenance["url"]
                && receipt["admissionProfile"] == admission_profile(kind)
                && receipt["measuredContentType"] == asset["payload"]["contentType"]
                && asset["payload"]["sourceLicense"] == provenance["license"],
        )
    }
}
impl<D: GeodataConnection, U: GeodataAuthority> GeodataRepository<D, U> {
    /// Native create/associate and CAS edits share retained-byte/source checks.
    /// Callers may reference only assets and receipts already in this dataset.
    pub fn mutate_document(
        &mut self,
        principal: &a::Principal,
        scope: &Scope,
        id: &str,
        command: &Value,
        budget: &m::WorkBudget,
    ) -> Result<Value> {
        shape("geodataDocumentMutation", command)?;
        need(mt::is_uuid(id))?;
        let authority = self.authority.clone();
        let mut result = None;
        authority.mutate(principal,|guard|->Result<()> {
            Self::authorize(guard,scope,true)?;
            let normalized=canonical(&json!({"scope":scope_value(scope),"documentId":id,"command":command}))?;let digest=hash(&normalized);let mutation=field(command,"mutationId")?;
            if let Some((saved_hash,body))=self.db.connection().query_row("SELECT payload_hash,body FROM geodata_mutation_receipts WHERE workspace_id=?1 AND home_id=?2 AND actor_id=?3 AND mutation_id=?4",params![scope.workspace_id,scope.home_id,principal.actor_id().as_str(),mutation],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).optional()? {if saved_hash!=digest{return Err(Error::new("identity-conflict","Mutation identity already retained"));}let mut saved=parse(&body)?;self.policy.authorize(guard,&saved["record"],true)?;self.validate_mutation_evidence(budget)?;guard.assert_mutation()?;saved["replayed"]=json!(true);result=Some(saved);return Ok(());}
            let old=match self.raw_record(scope,id){Ok(r)=>Some(r),Err(e)if e.code=="not-found"=>None,Err(e)=>return Err(e)};
            let operation=field(command,"operation")?;
            match (&old,operation){(None,"create")=>need(command["expectedRevision"].is_null())?,(Some(r),"replace"|"tombstone"|"restore")=>{if command["expectedRevision"]!=r["revision"]{return Err(Error::new("revision-conflict","Document revision changed"));}need(r["recordType"]=="geodata-document")?;self.policy.authorize(guard,r,true)?;need(if operation=="restore"{r["lifecycle"]=="tombstoned"}else{r["lifecycle"]=="active"})?;},_=>return Err(Error::new("invalid-transition","Document transition unavailable"))}
            let revision=old.as_ref().map_or(Some(1),|r|r["revision"].as_u64().and_then(|n|n.checked_add(1))).filter(|n|*n<=super::MAX_REVISION).ok_or_else(invalid)?;
            let now=app::now().map_err(|_|invalid())?;
            let payload=if matches!(operation,"create"|"replace"){command["value"]["payload"].clone()}else{old.as_ref().ok_or_else(invalid)?["payload"].clone()};
            let d=json!({"schemaVersion":2,"recordType":"geodata-document","recordId":id,"workspaceId":scope.workspace_id,"homeId":scope.home_id,"revision":revision,"lifecycle":if operation=="tombstone"{"tombstoned"}else{"active"},"createdAt":old.as_ref().map(|r|r["createdAt"].clone()).unwrap_or(json!(now)),"updatedAt":now,"lastAuditId":app::new_id()?,"payload":payload});
            validate_document(&d,self.selection==GeodataSelection::Full)?;if let Some(old)=&old{need(old["payload"]["original"]==d["payload"]["original"])?;}
            self.validate_custody(&d)?;let asset=self.original(&d)?;need(asset["lifecycle"]=="active"&&asset["payload"]["availability"]=="available")?;
            // Original-only profile requires the complete original guard.
            need(command["guards"]==preview::required_guards(old.as_ref(),&d))?;if let Some(old)=&old && old["payload"]["preview"]!=d["payload"]["preview"]{self.verified_preview(old,budget)?;}self.verified_preview(&d,budget)?;
            self.vault.read_retained(&self.asset_media(&asset)?,budget).map_err(media_error)?;self.policy.authorize(guard,&d,true)?;
            let tx=rusqlite::Transaction::new_unchecked(self.db.connection(),TransactionBehavior::Immediate)?;
            if let Some(old)=&old{let updated=tx.execute("UPDATE geodata_records SET revision=?1,body=?2 WHERE workspace_id=?3 AND home_id=?4 AND record_id=?5 AND revision=?6",params![revision as i64,canonical(&d)?,scope.workspace_id,scope.home_id,id,old["revision"].as_i64().ok_or_else(invalid)?])?;need(updated==1)?;tx.execute("DELETE FROM geodata_document_refs WHERE workspace_id=?1 AND document_id=?2",params![scope.workspace_id,id])?;}else{insert_record(&tx,&d)?;}
            insert_ref(&tx,&d)?;let audit=journal(&tx,&d,old.as_ref(),principal,mutation,field(command,"reason")?)?;
            let saved=json!({"schemaVersion":1,"record":d,"audit":audit,"replayed":false});shape("geodataDocumentMutationResult",&saved)?;tx.execute("INSERT INTO geodata_mutation_receipts VALUES(?1,?2,?3,?4,?5,?6,?7)",params![scope.workspace_id,scope.home_id,principal.actor_id().as_str(),mutation,digest,canonical(&saved)?,normalized])?;
            Self::authorize(guard,scope,true)?;self.policy.authorize(guard,&d,true)?;guard.assert_mutation()?;budget.check().map_err(media_error)?;tx.commit()?;result=Some(saved);Ok(())
        })?;
        result.ok_or_else(invalid)
    }
}
impl<D: GeodataConnection, U: GeodataAuthority> GeodataRepository<D, U> {
    pub(crate) fn recovery_media(&self) -> Result<Vec<mt::AssetRecord>> {
        let mut all = BTreeMap::new();
        for table in ["records", "receipts", "batch_receipts"] {
            let sql = match table {
                "records" => "SELECT body FROM records",
                "receipts" => "SELECT body FROM receipts",
                _ => "SELECT body FROM batch_receipts",
            };
            let bodies = self
                .db
                .connection()
                .prepare(sql)?
                .query_map([], |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            for body in bodies {
                let value: Value = serde_json::from_str(&body)?;
                let candidates = if table == "records" {
                    vec![&value]
                } else if table == "receipts" {
                    vec![&value["record"]]
                } else {
                    value
                        .as_array()
                        .ok_or_else(invalid)?
                        .iter()
                        .map(|r| &r["record"])
                        .collect()
                };
                for r in candidates {
                    if r["recordType"] == "asset" {
                        let media: mt::AssetRecord = serde_json::from_value(r.clone())?;
                        let key = (
                            media.workspace_id.clone(),
                            media.home_id.clone(),
                            media.record_id.clone(),
                            media.revision,
                            media.payload.sha256.clone(),
                        );
                        all.insert(key, media);
                    }
                }
            }
        }
        let bodies=self.db.connection().prepare("SELECT record_body FROM geodata_audits WHERE json_extract(record_body,'$.recordType')='asset'")?.query_map([],|r|r.get::<_,String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
        for body in bodies {
            let r = parse(&body)?;
            let media = self.asset_media(&r)?;
            let key = (
                media.workspace_id.clone(),
                media.home_id.clone(),
                media.record_id.clone(),
                media.revision,
                media.payload.sha256.clone(),
            );
            all.insert(key, media);
        }
        need(all.len() <= 4096)?;
        let mut bytes = 0u64;
        for media in all.values() {
            bytes = bytes
                .checked_add(media.payload.byte_size)
                .ok_or_else(invalid)?;
        }
        need(bytes <= 256 * 1024 * 1024)?;
        Ok(all.into_values().collect())
    }
}
impl GeodataStore {
    /// Capture a new private recovery directory from one SQLite read snapshot.
    /// The bundle contains no credentials/session/grants and selects no service.
    pub fn capture_recovery(&self, destination: &Path, budget: &m::WorkBudget) -> Result<Value> {
        use std::{
            fs,
            os::unix::fs::{DirBuilderExt, OpenOptionsExt},
        };
        fs::DirBuilder::new()
            .mode(0o700)
            .create(destination)
            .map_err(|_| invalid())?;
        let transaction = self.db.connection().unchecked_transaction()?;
        // Establish and retain this exact read epoch across SQL and blob capture.
        self.validate_recovery(budget)?;
        let media = self.recovery_media()?;
        let database = destination.join("snapshot.sqlite");
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&database)
            .map_err(|_| invalid())?;
        drop(file);
        let mut output = Connection::open(&database)?;
        {
            let copy = rusqlite::backup::Backup::new(self.db.connection(), &mut output)?;
            loop {
                budget.check().map_err(media_error)?;
                match copy.step(128)? {
                    rusqlite::backup::StepResult::Done => break,
                    rusqlite::backup::StepResult::More => {}
                    rusqlite::backup::StepResult::Busy | rusqlite::backup::StepResult::Locked => {
                        return Err(Error::new("storage-unavailable", "Recovery snapshot busy"));
                    }
                    _ => return Err(invalid()),
                }
            }
        }
        output.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;")?;
        drop(output);
        let vault = Arc::new(m::AssetVault::open(&destination.join("media")).map_err(media_error)?);
        for record in &media {
            let bytes = self
                .vault
                .read_retained(record, budget)
                .map_err(media_error)?;
            vault
                .restore_retained(record, bytes.as_slice(), budget)
                .map_err(media_error)?;
        }
        transaction.commit()?;
        need(fs::metadata(&database).map_err(|_| invalid())?.len() <= 256 * 1024 * 1024)?;
        let bytes = fs::read(&database).map_err(|_| invalid())?;
        let assets=media.iter().map(|r|json!({"scope":{"workspaceId":r.workspace_id,"homeId":r.home_id},"assetId":r.record_id,"revision":r.revision,"sha256":r.payload.sha256,"bytes":r.payload.byte_size})).collect::<Vec<_>>();
        let manifest = json!({"format":RECOVERY_FORMAT,"lineage":LINEAGE,"contractVersion":CONTRACT,"schema":SCHEMA,"catalogSha256":hash(SQL),"database":{"sha256":hash(&bytes),"bytes":bytes.len()},"assets":assets,"conversionAncestry":null});
        let body = canonical(&manifest)?;
        let path = destination.join("manifest.json");
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)
            .map_err(|_| invalid())?;
        use std::io::Write;
        f.write_all(body.as_bytes()).map_err(|_| invalid())?;
        f.sync_all().map_err(|_| invalid())?;
        Self::verify_recovery(
            destination,
            self.access.clone(),
            self.policy.clone(),
            budget,
        )?;
        Ok(manifest)
    }
    /// Independent read-only bundle verification; no sessions, grants, source
    /// fetching, migration, repair or service selection occurs.
    pub fn verify_recovery(
        directory: &Path,
        access: app::Access,
        policy: Arc<dyn GeodataSourcePolicy>,
        budget: &m::WorkBudget,
    ) -> Result<Value> {
        let manifest_path = directory.join("manifest.json");
        let metadata = std::fs::symlink_metadata(&manifest_path).map_err(|_| invalid())?;
        need(
            metadata.is_file()
                && !metadata.file_type().is_symlink()
                && metadata.len() <= 4 * 1024 * 1024,
        )?;
        let manifest_bytes = std::fs::read(manifest_path).map_err(|_| invalid())?;
        let manifest = v2::parse_value(&manifest_bytes).map_err(|_| invalid())?;
        need(
            canonical(&manifest)?.as_bytes() == manifest_bytes
                && manifest.as_object().is_some_and(|m| m.len() == 8)
                && manifest["format"] == RECOVERY_FORMAT
                && manifest["lineage"] == LINEAGE
                && manifest["contractVersion"] == CONTRACT
                && manifest["schema"] == SCHEMA
                && manifest["catalogSha256"] == hash(SQL)
                && manifest["conversionAncestry"].is_null(),
        )?;
        let path = directory.join("snapshot.sqlite");
        let metadata = std::fs::symlink_metadata(&path).map_err(|_| invalid())?;
        need(
            metadata.is_file()
                && !metadata.file_type().is_symlink()
                && metadata.len() <= 256 * 1024 * 1024,
        )?;
        for suffix in ["-wal", "-shm", "-journal"] {
            let mut p = path.as_os_str().to_os_string();
            p.push(suffix);
            need(!Path::new(&p).exists())?;
        }
        let bytes = std::fs::read(&path).map_err(|_| invalid())?;
        // Recovery snapshots are standalone DELETE images, never dependent on
        // an omitted journal/WAL or a sidefile created while opening read-only.
        need(
            bytes.len() >= 100
                && &bytes[..16] == b"SQLite format 3\0"
                && bytes[18] == 1
                && bytes[19] == 1,
        )?;
        need(manifest["database"] == json!({"sha256":hash(&bytes),"bytes":bytes.len()}))?;
        let db = Connection::open_with_flags(
            &path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )?;
        let store = Self {
            db,
            cursors: Arc::new(Mutex::new(BTreeMap::new())),
            authority: NativeGeodataAuthority(access.clone()),
            selection: GeodataSelection::Fresh,
            access,
            vault: Arc::new(
                m::AssetVault::open_existing(&directory.join("media")).map_err(media_error)?,
            ),
            policy,
        };
        store.validate_recovery(budget)?;
        let assets=store.recovery_media()?.into_iter().map(|r|json!({"scope":{"workspaceId":r.workspace_id,"homeId":r.home_id},"assetId":r.record_id,"revision":r.revision,"sha256":r.payload.sha256,"bytes":r.payload.byte_size})).collect::<Vec<_>>();
        need(manifest["assets"] == json!(assets))?;
        Ok(manifest)
    }
}
impl GeodataStore {
    /// Restore a verified bundle to one newly created private directory. This
    /// selects no service and restores no credentials, sessions or source grants.
    pub fn restore_recovery(
        bundle: &Path,
        destination: &Path,
        access: app::Access,
        policy: Arc<dyn GeodataSourcePolicy>,
        budget: &m::WorkBudget,
    ) -> Result<Self> {
        use std::{
            fs,
            io::Write,
            os::unix::fs::{DirBuilderExt, OpenOptionsExt},
        };
        let manifest = Self::verify_recovery(bundle, access.clone(), policy.clone(), budget)?;
        fs::DirBuilder::new()
            .mode(0o700)
            .create(destination)
            .map_err(|_| invalid())?;
        let source = Connection::open_with_flags(
            bundle.join("snapshot.sqlite"),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )?;
        let source_store = Self {
            db: source,
            cursors: Arc::new(Mutex::new(BTreeMap::new())),
            authority: NativeGeodataAuthority(access.clone()),
            selection: GeodataSelection::Fresh,
            access: access.clone(),
            vault: Arc::new(
                m::AssetVault::open_existing(&bundle.join("media")).map_err(media_error)?,
            ),
            policy: policy.clone(),
        };
        // Revalidate this retained handle, not just a path opened earlier.
        source_store.validate_recovery(budget)?;
        let bytes = fs::read(bundle.join("snapshot.sqlite")).map_err(|_| invalid())?;
        need(manifest["database"] == json!({"sha256":hash(&bytes),"bytes":bytes.len()}))?;
        let path = destination.join("atlas.sqlite");
        let mut database = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
            .map_err(|_| invalid())?;
        database.write_all(&bytes).map_err(|_| invalid())?;
        database.sync_all().map_err(|_| invalid())?;
        drop(database);
        let vault = Arc::new(m::AssetVault::open(&destination.join("media")).map_err(media_error)?);
        for record in source_store.recovery_media()? {
            budget.check().map_err(media_error)?;
            let bytes = source_store
                .vault
                .read_retained(&record, budget)
                .map_err(media_error)?;
            vault
                .restore_retained(&record, bytes.as_slice(), budget)
                .map_err(media_error)?;
        }
        fs::File::open(destination)
            .and_then(|f| f.sync_all())
            .map_err(|_| invalid())?;
        Self::open_existing(&path, access, vault, policy, budget)
    }
}

#[path = "geodata_preview.rs"]
mod preview;
