//! Concrete original-owner mapping admission. Private exports are documentary
//! inputs until correlated with an ACTUAL retained native Evidence mutation,
//! accepted native room semantics and the original pinned publication handles.
//! No JSON constructor, label, mesh ordinal or historical binding issues a grant.
use super::*;
use crate::config::{
    atlas_scene::ServerAtlasSceneSelection, model_overview::ServerModelOverviewSelection,
};
use serde::Deserialize;
#[cfg(test)]
#[path = "../../../examples/support/unified_atlas_fixture.rs"]
pub(crate) mod generated_publication;

const MAX_EXPORT: usize = 1_048_576;
const METHODS: [&str; 6] = [
    "guessed",
    "estimated",
    "directly-measured",
    "photo-fitted",
    "derived",
    "imported",
];
fn unavailable() -> s::Error {
    s::Error::new(
        "measurement-context-authority-unavailable",
        "Reviewed occurrence authority unavailable",
    )
}
fn stale() -> s::Error {
    s::Error::new(
        "measurement-context-stale-selection",
        "Occurrence selection changed",
    )
}
fn need(v: bool) -> s::Result<()> {
    if v { Ok(()) } else { Err(unavailable()) }
}
fn wire_error(_: c::ContractError) -> s::Error {
    unavailable()
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReviewKey {
    actor_id: String,
    mutation_id: String,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SemanticExport {
    profile: String,
    scope: s::Scope,
    /// Stable targetExpectation fields, EXCLUDING process selectionRevision.
    target: Value,
    room_identity: Value,
    room_semantics: Value,
    mapping_review: Value,
    review_receipt: ReviewKey,
    methods: Vec<Value>,
    evidence: Vec<Value>,
}
#[derive(Clone)]
pub struct OccurrenceAuthority {
    scene: Arc<ServerAtlasSceneSelection>,
    overview: Arc<ServerModelOverviewSelection>,
    export: SemanticExport,
    export_sha256: String,
    retained_reviews: Vec<Arc<OccurrenceAuthority>>,
}
fn record_pin(row: &s::Record) -> s::Result<Value> {
    Ok(
        json!({"record":row.reference(),"revision":row.revision,"payloadSha256":wire::digest(&row.payload).map_err(wire_error)?}),
    )
}
fn personal_support() -> Value {
    json!({"corroboration":"not-established","uncertainties":[{"status":"unknown","explanation":null}],"limitations":["user-reported-measurement"]})
}
fn stable_target(v: &Value) -> Value {
    let mut v = v.clone();
    if let Some(o) = v.as_object_mut() {
        o.remove("selectionRevision");
    }
    v
}
fn current_row<'a>(facts: &'a MeasurementNativeFacts, pin: &Value) -> s::Result<&'a s::Record> {
    let row = facts
        .native
        .records
        .iter()
        .find(|r| {
            r.record_id == pin["record"]["recordId"]
                && r.record_type.as_str() == pin["record"]["recordType"]
                && r.workspace_id == facts.scope.workspace_id
                && r.home_id == facts.scope.home_id
        })
        .ok_or_else(unavailable)?;
    need(row.lifecycle == s::Lifecycle::Active && record_pin(row)? == *pin)?;
    Ok(row)
}
fn retained_row(facts: &MeasurementNativeFacts, pin: &Value) -> s::Result<Value> {
    for row in &facts.native.records {
        if row.scope() == facts.scope && record_pin(row)? == *pin {
            return Ok(serde_json::to_value(row)?);
        }
    }
    for receipt in &facts.native_receipts {
        let row: &Value = &receipt["record"];
        if row["workspaceId"] == facts.scope.workspace_id
            && row["homeId"] == facts.scope.home_id
            && row["recordId"] == pin["record"]["recordId"]
            && row["recordType"] == pin["record"]["recordType"]
            && row["revision"] == pin["revision"]
            && wire::digest(&row["payload"]).map_err(wire_error)? == pin["payloadSha256"]
        {
            return Ok(row.clone());
        }
    }
    for row in facts.documents.iter().chain(&facts.document_history) {
        if row["workspaceId"] == facts.scope.workspace_id
            && row["homeId"] == facts.scope.home_id
            && row["recordId"] == pin["record"]["recordId"]
            && row["recordType"] == pin["record"]["recordType"]
            && row["revision"] == pin["revision"]
            && wire::digest(&row["payload"]).map_err(wire_error)? == pin["payloadSha256"]
        {
            return Ok(row.clone());
        }
    }
    Err(unavailable())
}
impl OccurrenceAuthority {
    /// Captured configuration INPUT, never a retained native review/grant. No
    /// producer content or native rows are opened/qualified during this capture.
    pub(crate) fn capture_configured_input(
        scene: Arc<ServerAtlasSceneSelection>,
        overview: Arc<ServerModelOverviewSelection>,
        bytes: &[u8],
        sha: &str,
    ) -> s::Result<Self> {
        need(!bytes.is_empty() && bytes.len() <= MAX_EXPORT && media::types::sha256(bytes) == sha)?;
        let export: SemanticExport =
            serde_json::from_value(wire::parse(bytes).map_err(wire_error)?)?;
        need(
            export.profile == "houseatlas.private-measurement-semantic-export.v1"
                && export.target.get("selectionRevision").is_none()
                && export.methods.len() == 6
                && export.evidence.len() <= 64,
        )?;
        let result = Self {
            scene,
            overview,
            export,
            export_sha256: sha.into(),
            retained_reviews: vec![],
        };
        wire::validate_value("targetExpectation", &result.target()).map_err(wire_error)?;
        // Documentary correlation with these explicitly configured owners only.
        // Native review/source qualification still requires each request guard.
        let target = result.target();
        let publication = &result.scene.value;
        need(
            serde_json::to_value(&result.export.scope)? == publication["scope"]
                && target["publicationId"] == publication["publicationId"]
                && target["sourceRevisionId"] == publication["sourceRevisionId"]
                && target["sourceSha256"] == publication["sourceSha256"]
                && target["semanticsSha256"] == result.scene.semantics_sha256
                && target["overviewManifestSha256"] == result.overview.manifest_sha256
                && target["artifactSha256"] == result.overview.manifest.original.sha256
                && wire::integer(&target["artifactBytes"]).map_err(wire_error)?
                    == result.overview.manifest.original.bytes,
        )?;
        for pin in [
            &result.export.room_identity,
            &result.export.room_semantics,
            &result.export.mapping_review,
        ] {
            wire::validate_value("nativeRevision", pin).map_err(wire_error)?;
        }
        for (i, option) in result.export.methods.iter().enumerate() {
            wire::validate_value("methodOption", option).map_err(wire_error)?;
            need(option["method"] == METHODS[i])?;
        }
        for evidence in &result.export.evidence {
            wire::validate_value("evidenceProposal", evidence).map_err(wire_error)?;
        }
        a::CanonicalId::parse(&result.export.review_receipt.actor_id).map_err(|_| unavailable())?;
        a::CanonicalId::parse(&result.export.review_receipt.mutation_id)
            .map_err(|_| unavailable())?;
        Ok(result)
    }
    pub(crate) fn configured_selector(&self) -> Value {
        let t = self.target();
        let mut selector = json!({});
        for key in [
            "buildingId",
            "roomId",
            "levelId",
            "occurrenceId",
            "publicationId",
            "selectionRevision",
            "semanticsSha256",
            "overviewManifestSha256",
        ] {
            selector[key] = t[key].clone();
        }
        selector
    }
    pub(crate) fn configured_target_matches(&self, target: &Value) -> bool {
        stable_target(target) == self.export.target
    }
    pub(crate) fn configured_reference_matches(
        &self,
        reference: MeasurementAssociationReference<'_>,
    ) -> bool {
        self.configured_target_matches(reference.target) && *reference.admission == self.admission()
    }
    pub(crate) fn qualify_configured_input(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        p: &RequestPrincipal,
        f: &MeasurementNativeFacts,
        current: bool,
    ) -> s::Result<Self> {
        need(
            std::ptr::eq(guard.principal(), p.principal.principal())
                && self.export.scope == f.scope,
        )?;
        guard
            .authorize(p.principal.scope(), a::Capability::ReadHistory)
            .map_err(storage_access)?;
        let closure = disclosure_closure(f, &[], &[self.admission()])?;
        p.release_guard(guard, &closure).map_err(storage_access)?;
        self.verify_mapping(f, current)?;
        guard.revalidate().map_err(storage_access)?;
        Ok(self.clone())
    }
    #[cfg(test)]
    pub(crate) fn configured_fixture_export(&self) -> s::Result<Vec<u8>> {
        let bytes = serde_json::to_vec(
            &json!({"profile":self.export.profile,"scope":self.export.scope,"target":self.export.target,
            "roomIdentity":self.export.room_identity,"roomSemantics":self.export.room_semantics,"mappingReview":self.export.mapping_review,
            "reviewReceipt":{"actorId":self.export.review_receipt.actor_id,"mutationId":self.export.review_receipt.mutation_id},"methods":self.export.methods,"evidence":self.export.evidence}),
        )?;
        // Original actual audit already pins these bytes. Never mint a new review.
        need(media::types::sha256(&bytes) == self.export_sha256)?;
        Ok(bytes)
    }
    #[cfg(test)]
    pub(crate) fn configured_fixture_retained_exports(&self) -> s::Result<Vec<Vec<u8>>> {
        self.retained_reviews
            .iter()
            .map(|r| r.configured_fixture_export())
            .collect()
    }

    /// Strict stored-inventory qualification. Unknown producer context is NEVER
    /// opened, parsed or evaluated here, even when an original handle exists.
    /// Required native/Document/media closure remains the recovery owner's work;
    /// this additionally proves every retained measurement native pin/history.
    pub(crate) fn inventory(
        &self,
        f: &MeasurementNativeFacts,
        receipts: &[Value],
    ) -> s::Result<MeasurementInventoryReport> {
        let mut producer_contexts = Vec::new();
        let mut models = Vec::new();
        for receipt in receipts {
            let c = &receipt["committed"];
            let parsed = wire::committed(c).map_err(wire_error)?;
            need(
                parsed.assertion.target.scope.workspace_id == f.scope.workspace_id
                    && parsed.assertion.target.scope.home_id == f.scope.home_id,
            )?;
            wire::receipt_digest(receipt).map_err(wire_error)?;
            let admission = &c["targetAdmission"];
            let room = retained_row(f, &admission["roomIdentity"])?;
            let semantics = retained_row(f, &admission["roomSemantics"])?;
            let review = retained_row(f, &admission["mappingReview"])?;
            need(
                room["recordType"] == "identity"
                    && room["payload"]["kind"] == "location"
                    && semantics["recordType"] == "location-semantics"
                    && semantics["payload"]["atlasId"] == room["recordId"]
                    && semantics["payload"]["semanticKind"] == "room"
                    && semantics["payload"]["reviewStatus"] == "accepted"
                    && semantics["payload"]["evidenceIds"]
                        .as_array()
                        .is_some_and(|a| a.contains(&review["recordId"]))
                    && review["recordType"] == "evidence",
            )?;
            let original = f
                .native_receipts
                .iter()
                .find(|r| r["record"] == review)
                .ok_or_else(unavailable)?;
            let reason = original["audit"]["reason"]
                .as_str()
                .ok_or_else(unavailable)?;
            let digest = reason
                .strip_prefix("Reviewed measurement occurrence export sha256:")
                .ok_or_else(unavailable)?;
            need(
                digest.len() == 64
                    && digest
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                    && original["audit"]["workspaceId"] == f.scope.workspace_id
                    && original["audit"]["homeId"] == f.scope.home_id,
            )?;
            if let Some(pin) = c["acquisition"].get("review") {
                retained_row(f, pin)?;
            }
            for e in c["assertion"]["evidence"]
                .as_array()
                .ok_or_else(unavailable)?
            {
                retained_row(f, &e["evidence"])?;
            }
            for input in c["assertion"]["inputs"]
                .as_array()
                .ok_or_else(unavailable)?
            {
                let pin = &input["pin"];
                match pin["kind"].as_str() {
                    Some("native") => {
                        retained_row(f, &pin["native"])?;
                    }
                    Some("assertion") => need(
                        receipts
                            .iter()
                            .any(|r| r["committed"]["assertion"]["version"] == pin["assertion"]),
                    )?,
                    Some("model") => {
                        let m = &pin["model"];
                        if m["custody"]["kind"] != "unknown"
                            || m["physicalRegistration"]["kind"] != "unknown"
                        {
                            return Err(unavailable()); // required model dependencies need an actual qualified original owner
                        }
                    }
                    _ => return Err(unavailable()),
                }
            }
            let model = &c["assertion"]["enteredAgainst"];
            if !models.contains(model) {
                if model["custody"]["kind"] == "unknown"
                    && model["physicalRegistration"]["kind"] == "unknown"
                {
                    producer_contexts.push(ProducerInventoryContext::RecordedContextUnverified {
                        original_model: model.clone(),
                    });
                } else {
                    // The opaque-context exception NEVER downgrades known native
                    // custody. Preserve exact original required qualification.
                    if model["custody"]["kind"] == "native-records" {
                        retained_row(f, &model["custody"]["geometry"])?;
                        retained_row(f, &model["custody"]["association"])?;
                    }
                    if let Some(pin) = model["physicalRegistration"].get("evidence") {
                        retained_row(f, pin)?;
                    }
                    self.check_receipts(f, std::slice::from_ref(receipt))?;
                    producer_contexts.push(
                        ProducerInventoryContext::RequiredNativeCustodyQualified {
                            original_model: model.clone(),
                        },
                    );
                }
                models.push(model.clone());
            }
        }
        let validated_cut_sha256=wire::digest(&json!({"domain":"houseatlas.measurement-inventory-cut/1","scope":f.scope,"receipts":receipts,
            "native":f.native,"nativeReceipts":f.native_receipts,"documents":f.documents,"documentHistory":f.document_history})).map_err(wire_error)?;
        Ok(MeasurementInventoryReport {
            scope: f.scope.clone(),
            validated_cut_sha256,
            producer_contexts,
        })
    }
    /// Root/native review owner calls this under the ORIGINAL authenticated Read
    /// fence using actual Store facts, AFTER its separately audited native review.
    /// Export SHA is bound by that real audit's reason, not evidence-text JSON.
    pub(crate) fn retain_review(
        guard: &a::TransactionAuthorization<'_>,
        p: &RequestPrincipal,
        facts: &MeasurementNativeFacts,
        scene: Arc<ServerAtlasSceneSelection>,
        overview: Arc<ServerModelOverviewSelection>,
        bytes: &[u8],
        expected_sha256: &str,
    ) -> s::Result<Self> {
        need(
            bytes.len() <= MAX_EXPORT && std::ptr::eq(guard.principal(), p.principal.principal()),
        )?;
        guard
            .authorize(p.principal.scope(), a::Capability::ReadHistory)
            .map_err(storage_access)?;
        need(media::types::sha256(bytes) == expected_sha256)?;
        let export: SemanticExport =
            serde_json::from_value(wire::parse(bytes).map_err(wire_error)?)?;
        let result = Self {
            scene,
            overview,
            export,
            export_sha256: expected_sha256.into(),
            retained_reviews: vec![],
        };
        result.verify_mapping(facts, true)?;
        guard.revalidate().map_err(storage_access)?;
        Ok(result)
    }
    pub fn with_retained_reviews(mut self, reviews: Vec<Arc<Self>>) -> s::Result<Self> {
        need(reviews.len() <= 64 && reviews.iter().all(|r| r.retained_reviews.is_empty()))?;
        self.retained_reviews = reviews;
        Ok(self)
    }
    fn target(&self) -> Value {
        let mut v = self.export.target.clone();
        v["selectionRevision"] = json!(self.scene.revision);
        v
    }
    fn admission(&self) -> Value {
        json!({"kind":"resolved","roomIdentity":self.export.room_identity,"roomSemantics":self.export.room_semantics,
        "mappingReview":self.export.mapping_review,"sourceObjectIds":self.export.target["sourceObjectIds"]})
    }
    fn verify_mapping(&self, f: &MeasurementNativeFacts, current: bool) -> s::Result<()> {
        self.verify_export_inner(f, current, false)
    }
    fn qualify_method(
        &self,
        f: &MeasurementNativeFacts,
        option: &Value,
        current: bool,
    ) -> s::Result<()> {
        let target = self.target();
        if option["status"] == "available" {
            wire::validate_value("support", &option["support"]).map_err(wire_error)?;
            wire::validate_value("acquisition", &option["acquisition"]).map_err(wire_error)?;
            need(match option["acquisition"]["kind"].as_str() {
                Some("unqualified") => !matches!(
                    option["method"].as_str(),
                    Some("directly-measured" | "photo-fitted")
                ),
                Some("image-informed-estimate") => option["method"] == "estimated",
                Some("direct-measurement") => option["method"] == "directly-measured",
                Some("photo-fit") => option["method"] == "photo-fitted",
                _ => false,
            })?;
            if let Some(review) = option["acquisition"].get("review") {
                retained_row(f, review)?;
                if current {
                    current_row(f, review)?;
                }
            }
            for input in option["inputs"].as_array().ok_or_else(unavailable)? {
                if input["expectation"]["kind"] == "native" {
                    let e = &input["expectation"]["reference"];
                    let pin = json!({"record":e["record"],"revision":e["expectedRevision"],"payloadSha256":e["expectedPayloadSha256"]});
                    retained_row(f, &pin)?;
                    if current {
                        current_row(f, &pin)?;
                    }
                    // File-backed inputs need their independent original
                    // custody/policy owner; this adapter never substitutes
                    // a documentary availability string for that owner.
                    need(
                        e["record"]["recordType"] == "evidence"
                            && input["provenance"]["pin"]["kind"] == "native"
                            && input["provenance"]["pin"]["native"] == pin,
                    )?;
                } else if input["expectation"]["kind"] == "selected-model" {
                    need(input["provenance"]["pin"]["kind"] == "model")?;
                    let m = &input["provenance"]["pin"]["model"];
                    need(
                        m["artifactSha256"] == target["artifactSha256"]
                            && m["publicationId"] == target["publicationId"]
                            && m["lineage"]["sourceSha256"] == target["sourceSha256"],
                    )?;
                } else {
                    need(input["provenance"]["pin"]["kind"] == "assertion")?;
                }
            }
        } else {
            need(
                option["acquisition"].is_null()
                    && option["support"].is_null()
                    && option["inputs"] == json!([])
                    && option["operations"] == json!([]),
            )?;
        }
        Ok(())
    }
    fn verify_export_inner(
        &self,
        f: &MeasurementNativeFacts,
        current: bool,
        qualify_methods: bool,
    ) -> s::Result<()> {
        need(
            self.export.profile == "houseatlas.private-measurement-semantic-export.v1"
                && self.export.scope == f.scope
                && self.export.target.get("selectionRevision").is_none(),
        )?;
        self.scene
            .read_companion(&self.overview)
            .map_err(|_| unavailable())?;
        self.overview.read_original().map_err(|_| unavailable())?;
        let target = self.target();
        wire::validate_value("targetExpectation", &target).map_err(wire_error)?;
        let publication = &self.scene.value;
        need(
            target["publicationId"] == publication["publicationId"]
                && target["sourceRevisionId"] == publication["sourceRevisionId"]
                && target["sourceSha256"] == publication["sourceSha256"]
                && target["semanticsSha256"] == self.scene.semantics_sha256
                && target["overviewManifestSha256"] == self.overview.manifest_sha256
                && target["artifactId"] == "model"
                && target["artifactSha256"] == self.overview.manifest.original.sha256
                && wire::integer(&target["artifactBytes"]).map_err(wire_error)?
                    == self.overview.manifest.original.bytes
                && publication["scope"] == serde_json::to_value(&f.scope)?,
        )?;
        let occurrence = publication["occurrences"]
            .as_array()
            .ok_or_else(unavailable)?
            .iter()
            .find(|o| {
                o["spaceOccurrenceId"] == target["occurrenceId"]
                    && o["roomId"] == target["roomId"]
                    && o["levelId"] == target["levelId"]
                    && o["buildingId"] == target["buildingId"]
            })
            .ok_or_else(unavailable)?;
        need(
            target["sourceObjectIds"]
                .as_array()
                .is_some_and(|a| !a.is_empty()),
        )?;
        let feature = json!({"domain":"houseatlas.measurement-occurrence-feature/1","scope":f.scope,"publicationId":target["publicationId"],
            "sourceSha256":target["sourceSha256"],"artifactSha256":target["artifactSha256"],"occurrence":occurrence,"sourceObjectIds":target["sourceObjectIds"]});
        need(wire::digest(&feature).map_err(wire_error)? == target["targetFeatureSha256"])?;
        let (room, semantics) = if current {
            (
                serde_json::to_value(current_row(f, &self.export.room_identity)?)?,
                serde_json::to_value(current_row(f, &self.export.room_semantics)?)?,
            )
        } else {
            (
                retained_row(f, &self.export.room_identity)?,
                retained_row(f, &self.export.room_semantics)?,
            )
        };
        need(
            room["payload"]["kind"] == "location"
                && semantics["payload"]["atlasId"] == room["recordId"]
                && semantics["payload"]["semanticKind"] == "room"
                && semantics["payload"]["reviewStatus"] == "accepted"
                && semantics["payload"]["evidenceIds"]
                    .as_array()
                    .is_some_and(|a| a.contains(&self.export.mapping_review["record"]["recordId"])),
        )?;
        let review = retained_row(f, &self.export.mapping_review)?;
        need(review["recordType"] == "evidence")?;
        if current {
            current_row(f, &self.export.mapping_review)?;
        }
        let receipt = f
            .native_receipts
            .iter()
            .find(|r| {
                r["audit"]["actorId"] == self.export.review_receipt.actor_id
                    && r["audit"]["mutationId"] == self.export.review_receipt.mutation_id
                    && r["record"] == review
            })
            .ok_or_else(unavailable)?;
        need(
            receipt["audit"]["workspaceId"] == f.scope.workspace_id
                && receipt["audit"]["homeId"] == f.scope.home_id
                && receipt["audit"]["reason"]
                    == format!(
                        "Reviewed measurement occurrence export sha256:{}",
                        self.export_sha256
                    ),
        )?;
        need(self.export.methods.len() == 6 && self.export.evidence.len() <= 64)?;
        for (index, option) in self.export.methods.iter().enumerate() {
            wire::validate_value("methodOption", option).map_err(wire_error)?;
            need(option["method"] == METHODS[index])?;
            if qualify_methods {
                self.qualify_method(f, option, current)?;
            }
        }
        for choice in &self.export.evidence {
            wire::validate_value("evidenceProposal", choice).map_err(wire_error)?;
            let e = &choice["reference"];
            let pin = json!({"record":e["record"],"revision":e["expectedRevision"],"payloadSha256":e["expectedPayloadSha256"]});
            if qualify_methods {
                if current {
                    current_row(f, &pin)?;
                } else {
                    retained_row(f, &pin)?;
                }
            }
        }
        Ok(())
    }
    fn owner_for(&self, target: &Value, admission: &Value) -> s::Result<&Self> {
        if stable_target(target) == self.export.target && *admission == self.admission() {
            return Ok(self);
        }
        self.retained_reviews
            .iter()
            .map(Arc::as_ref)
            .find(|r| stable_target(target) == r.export.target && *admission == r.admission())
            .ok_or_else(unavailable)
    }
    fn check_receipts(&self, f: &MeasurementNativeFacts, receipts: &[Value]) -> s::Result<()> {
        for receipt in receipts {
            let c = &receipt["committed"];
            wire::committed(c).map_err(wire_error)?;
            let owner = self.owner_for(&c["proposal"]["target"], &c["targetAdmission"])?;
            owner.verify_mapping(f, false)?;
            need(c["targetAdmission"] == owner.admission())?;
            if c["assertion"]["method"] != "user-reported-measured" {
                let option = owner
                    .export
                    .methods
                    .iter()
                    .find(|m| m["method"] == c["assertion"]["method"] && m["status"] == "available")
                    .ok_or_else(unavailable)?;
                owner.qualify_method(f, option, false)?;
                need(
                    c["acquisition"] == option["acquisition"]
                        && c["assertion"]["support"] == option["support"],
                )?;
            }
            for link in c["assertion"]["evidence"]
                .as_array()
                .ok_or_else(unavailable)?
            {
                retained_row(f, &link["evidence"])?;
            }
            for input in c["assertion"]["inputs"]
                .as_array()
                .ok_or_else(unavailable)?
            {
                if input["pin"]["kind"] == "native" {
                    retained_row(f, &input["pin"]["native"])?;
                }
            }
        }
        Ok(())
    }
    fn selector(&self) -> Value {
        let t = self.target();
        let mut v = json!({});
        for k in [
            "buildingId",
            "roomId",
            "levelId",
            "occurrenceId",
            "publicationId",
            "selectionRevision",
            "semanticsSha256",
            "overviewManifestSha256",
        ] {
            v[k] = t[k].clone();
        }
        v
    }
}
impl ReviewedOccurrenceAuthority for OccurrenceAuthority {
    fn disclosure_target_pins(&self, selector: &Value) -> s::Result<Vec<Value>> {
        if *selector != self.selector() {
            return Err(stale());
        }
        Ok(vec![
            self.export.room_identity.clone(),
            self.export.room_semantics.clone(),
            self.export.mapping_review.clone(),
        ])
    }
    fn disclosure_choices(&self, selector: &Value) -> s::Result<Vec<Value>> {
        self.disclosure_target_pins(selector)?;
        Ok(self
            .export
            .methods
            .iter()
            .filter(|option| option["status"] == "available")
            .chain(&self.export.evidence)
            .cloned()
            .collect())
    }
    fn authorize_disclosure(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        p: &RequestPrincipal,
        f: &MeasurementNativeFacts,
        receipts: &[Value],
    ) -> s::Result<()> {
        need(std::ptr::eq(guard.principal(), p.principal.principal()))?;
        let scope = super::super::access_scope(&crate::domain::Scope {
            workspace_id: f.scope.workspace_id.clone(),
            home_id: f.scope.home_id.clone(),
        })
        .map_err(storage_access)?;
        guard
            .authorize(&scope, a::Capability::ReadHistory)
            .map_err(storage_access)?;
        self.inventory(f, receipts)?;
        Ok(())
    }
    fn historical_association(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        p: &RequestPrincipal,
        f: &MeasurementNativeFacts,
        reference: MeasurementAssociationReference<'_>,
        receipt: &Value,
    ) -> s::Result<Value> {
        need(std::ptr::eq(guard.principal(), p.principal.principal()))?;
        guard.revalidate().map_err(storage_access)?;
        guard
            .authorize(p.principal.scope(), a::Capability::ReadHistory)
            .map_err(storage_access)?;
        let c = &receipt["committed"];
        let unavailable =
            || json!({"status":"unavailable","reason":"historical-mapping-owner-unavailable"});
        // Qualify the REFERENCE owner, never select a candidate's own owner and
        // then accidentally compare that candidate with itself.
        let Ok(reference_owner) = self.owner_for(reference.target, reference.admission) else {
            return Ok(unavailable());
        };
        let Ok(candidate_owner) = self.owner_for(&c["proposal"]["target"], &c["targetAdmission"])
        else {
            return Ok(unavailable());
        };
        let closure = disclosure_closure(
            f,
            std::slice::from_ref(receipt),
            &[(*reference.admission).clone()],
        )?;
        p.release_guard(guard, &closure).map_err(storage_access)?;
        if reference_owner.verify_mapping(f, false).is_err()
            || candidate_owner.verify_mapping(f, false).is_err()
        {
            return Ok(unavailable());
        }
        guard.revalidate().map_err(storage_access)?;
        if stable_target(reference.target) == stable_target(&c["proposal"]["target"])
            && *reference.admission == c["targetAdmission"]
        {
            return Ok(
                json!({"status":"reviewed","relation":"applicable","review":reference_owner.export.mapping_review}),
            );
        }
        // Owning both original mappings is NOT pairwise correspondence. No
        // reviewed cross-part/publication relation is supplied by this adapter.
        let same_room = reference.admission["roomIdentity"]["record"]
            == c["targetAdmission"]["roomIdentity"]["record"];
        let reason = if same_room
            && reference.target["publicationId"] == c["proposal"]["target"]["publicationId"]
        {
            "occurrence-part-ambiguous"
        } else if same_room {
            "native-room-candidate-only"
        } else {
            "reviewed-occurrence-association-missing"
        };
        Ok(json!({"status":"review-required","reason":reason}))
    }
    fn occurrence_context(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        p: &RequestPrincipal,
        selector: &Value,
        f: &MeasurementNativeFacts,
        retained: &[Value],
        choices: &[RequestPrincipal],
    ) -> s::Result<Value> {
        need(std::ptr::eq(guard.principal(), p.principal.principal()))?;
        guard
            .authorize(p.principal.scope(), a::Capability::ReadHistory)
            .map_err(storage_access)?;
        if *selector != self.selector() {
            return Err(stale());
        }
        self.verify_mapping(f, true)?;
        self.inventory(f, retained)?;
        // Each optional wrapper retains the SAME original Read allocation.
        // A denied/expired choice never contaminates required value disclosure.
        let authorized = |closure: &sem::ReferenceClosure| {
            p.release_guard(guard, closure).is_ok()
                || choices
                    .iter()
                    .any(|choice| choice.release_guard(guard, closure).is_ok())
        };
        let mut methods = Vec::new();
        for option in &self.export.methods {
            let mut option = option.clone();
            let inputs = option["inputs"].as_array().ok_or_else(unavailable)?;
            let assertion_inputs = inputs
                .iter()
                .any(|i| i["expectation"]["kind"] == "assertion");
            let references_qualified=inputs.iter().filter(|i|i["expectation"]["kind"]=="assertion").all(|input|{
                let e=&input["expectation"];let pin=json!({"assertionId":e["assertionId"],"revision":e["expectedRevision"],"payloadSha256":e["expectedPayloadSha256"]});
                input["provenance"]["pin"]["assertion"]==pin&&retained.iter().any(|r|r["committed"]["assertion"]["version"]==pin)
            });
            // Assertion input choices require the complete authorized retained
            // closure, including transitive native source dependencies. Failed
            // optional capture removes the choice rather than exposing a pin.
            let input_receipts = if assertion_inputs { retained } else { &[] };
            if option["status"] == "available"
                && (!references_qualified
                    || self.qualify_method(f, &option, true).is_err()
                    || !disclosure_closure(f, input_receipts, std::slice::from_ref(&option))
                        .is_ok_and(|closure| authorized(&closure)))
            {
                option["status"] = json!("unavailable");
                option["reason"] = json!("Native method qualification unavailable");
                option["acquisition"] = Value::Null;
                option["support"] = Value::Null;
                option["inputs"] = json!([]);
                option["operations"] = json!([]);
            }
            methods.push(option);
        }
        // Native prerequisite only: Store separately intersects this advisory
        // result with its exact independently captured mutation-source closure.
        // Neither this disclosure principal nor method availability grants write.
        let eligible =
            p.principal.role() == a::Role::Editor && self.check_receipts(f, retained).is_ok();
        let reason = if p.principal.role() != a::Role::Editor {
            "read-only-role"
        } else {
            "required-mutation-owner-unavailable"
        };
        let eligibility = if eligible {
            json!({"advisory":true,"status":"eligible"})
        } else {
            json!({"advisory":true,"status":"ineligible","reason":reason})
        };
        methods.push(json!({"method":"user-reported-measured","status":if eligible{"available"}else{"unavailable"},"reason":if eligible{Value::Null}else{json!("Current writing is unavailable")},
            "acquisition":null,"support":if eligible{personal_support()}else{Value::Null},"inputs":[],"operations":[]}));
        let evidence=self.export.evidence.iter().filter(|choice|{let e=&choice["reference"];
            current_row(f,&json!({"record":e["record"],"revision":e["expectedRevision"],"payloadSha256":e["expectedPayloadSha256"]})).is_ok()
                &&disclosure_closure(f,&[],std::slice::from_ref(*choice)).is_ok_and(|closure|authorized(&closure))
        }).cloned().collect::<Vec<_>>();
        guard.revalidate().map_err(storage_access)?;
        Ok(
            json!({"target":self.target(),"targetAdmission":self.admission(),"methods":methods,"evidence":evidence,"writeEligibility":eligibility}),
        )
    }
    fn materialize(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        p: &RequestPrincipal,
        proposal: &online::OnlineProposal,
        f: &MeasurementNativeFacts,
        retained: &[Value],
    ) -> s::Result<MeasurementMaterial> {
        need(std::ptr::eq(guard.principal(), p.principal.principal()))?;
        self.verify_mapping(f, true)?;
        self.check_receipts(f, retained)?;
        let raw = wire::parse(
            online::canonical_proposal(proposal)
                .map_err(|_| unavailable())?
                .as_bytes(),
        )
        .map_err(wire_error)?;
        let t = &raw["target"];
        if stable_target(t) != self.export.target {
            return Err(stale());
        }
        if matches!(proposal.operation, online::OnlineOperation::Create) && *t != self.target() {
            return Err(stale());
        }
        let personal = proposal.area.method
            == crate::measurement_assertions::MeasurementMethod::UserReportedMeasured;
        let ordinary = json!({"method":"user-reported-measured","status":"available","acquisition":null,"support":personal_support(),"inputs":[],"operations":[]});
        let option = if personal {
            &ordinary
        } else {
            self.export
                .methods
                .iter()
                .find(|m| m["method"] == raw["area"]["method"] && m["status"] == "available")
                .ok_or_else(unavailable)?
        };
        if !personal {
            self.qualify_method(f, option, true)?;
        }
        let evidence = raw["area"]["evidence"].as_array().ok_or_else(unavailable)?;
        need(evidence.iter().all(|e| self.export.evidence.contains(e)))?;
        let mut inputs = Vec::new();
        for e in raw["area"]["inputs"].as_array().ok_or_else(unavailable)? {
            let input = option["inputs"]
                .as_array()
                .ok_or_else(unavailable)?
                .iter()
                .find(|i| i["expectation"] == *e)
                .ok_or_else(unavailable)?;
            inputs.push(input["provenance"].clone());
        }
        if !raw["area"]["operation"].is_null() {
            need(
                option["operations"]
                    .as_array()
                    .is_some_and(|a| a.contains(&raw["area"]["operation"])),
            )?;
        }
        let model = json!({"scope":f.scope,"buildingId":t["buildingId"],"publicationId":t["publicationId"],"artifactId":"model","artifactSha256":t["artifactSha256"],"artifactBytes":t["artifactBytes"],
            "lineage":{"kind":"unified-atlas-publication","sourceRevisionId":t["sourceRevisionId"],"sourceSha256":t["sourceSha256"],"semanticsSha256":t["semanticsSha256"],"overviewManifestSha256":t["overviewManifestSha256"],"selectionRevision":t["selectionRevision"]},"custody":{"kind":"unknown"},"physicalRegistration":{"kind":"unknown"}});
        for (expected, input) in raw["area"]["inputs"]
            .as_array()
            .ok_or_else(unavailable)?
            .iter()
            .zip(&mut inputs)
        {
            if expected["kind"] == "selected-model" {
                input["pin"]["model"] = model.clone();
            }
        }
        let evidence=evidence.iter().map(|e|json!({"role":e["role"],"evidence":{"record":e["reference"]["record"],"revision":e["reference"]["expectedRevision"],"payloadSha256":e["reference"]["expectedPayloadSha256"]}})).collect::<Vec<_>>();
        Ok(MeasurementMaterial {
            target: json!({"scope":f.scope,"namespace":{"kind":"producer-publication","publicationId":t["publicationId"]},"buildingId":t["buildingId"],"roomId":t["roomId"],"floorId":t["levelId"],"occurrenceId":t["occurrenceId"],"feature":{"kind":"room"}}),
            model,
            target_admission: self.admission(),
            acquisition: if personal {
                MeasurementAcquisitionPlan::UserReportedPersonalMeasurement {
                    attestation: online::PersonalMeasurementAttestation::PersonallyMeasured,
                }
            } else {
                MeasurementAcquisitionPlan::Qualified(option["acquisition"].clone())
            },
            support: option["support"].clone(),
            inputs: json!(inputs),
            evidence: json!(evidence),
            review: json!({"kind":"no-known-issue"}),
        })
    }
    fn qualify(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        p: &RequestPrincipal,
        _phase: MeasurementPhase,
        proposal: &online::OnlineProposal,
        f: &MeasurementNativeFacts,
        material: &MeasurementMaterial,
    ) -> s::Result<()> {
        need(std::ptr::eq(guard.principal(), p.principal.principal()))?;
        guard.revalidate().map_err(storage_access)?;
        self.verify_mapping(f, true)?;
        let raw = wire::parse(
            online::canonical_proposal(proposal)
                .map_err(|_| unavailable())?
                .as_bytes(),
        )
        .map_err(wire_error)?;
        need(
            stable_target(&raw["target"]) == self.export.target
                && material.target_admission == self.admission(),
        )
    }
    fn authorize_retained(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        p: &RequestPrincipal,
        _phase: MeasurementPhase,
        f: &MeasurementNativeFacts,
        receipts: &[Value],
    ) -> s::Result<()> {
        need(std::ptr::eq(guard.principal(), p.principal.principal()))?;
        guard
            .authorize(p.principal.scope(), a::Capability::ReadHistory)
            .map_err(storage_access)?;
        self.check_receipts(f, receipts)
    }
}
impl crate::storage::MeasurementRecoveryEvidence for OccurrenceAuthority {
    fn verify_retained(
        &self,
        f: &MeasurementNativeFacts,
        receipts: &[Value],
    ) -> s::Result<MeasurementInventoryReport> {
        self.inventory(f, receipts)
    }
}
