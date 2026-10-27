//! Same-Store online measurement transactions. No connection escapes, source
//! transport, disconnected queue, inferred target authority or closure endpoint.
struct MeasurementProjectionInput<'a, 'guard> {
    pub guard: &'a crate::access::TransactionAuthorization<'guard>,
    pub p: &'a RequestPrincipal,
    pub owners: &'a MeasurementOwners,
    pub f: &'a MeasurementNativeFacts,
    pub selected: &'a repo::Retained,
    pub rows: &'a [repo::Retained],
    pub all_heads: &'a [repo::Retained],
    pub point: &'a online::ReadPoint,
    pub complete: bool,
}

pub struct MeasurementContextInput<'a, 'guard> {
    pub p: &'a RequestPrincipal,
    pub guard: &'a crate::access::TransactionAuthorization<'guard>,
    pub binding: &'a MeasurementBinding,
    pub prepared: &'a MeasurementPreparation,
    pub historical: Option<&'a RequestPrincipal>,
    pub mutation_sources: Option<&'a RequestPrincipal>,
    pub choice_sources: &'a [RequestPrincipal],
    pub input: &'a Value,
}

pub struct MeasurementOccurrenceReviewInput<'a, 'guard> {
    pub p: &'a RequestPrincipal,
    pub guard: &'a crate::access::TransactionAuthorization<'guard>,
    pub scope: &'a Scope,
    pub access: &'a crate::app::Access,
    pub vault: &'a Arc<crate::media::AssetVault>,
    pub scene: Arc<crate::config::atlas_scene::ServerAtlasSceneSelection>,
    pub overview: Arc<crate::config::model_overview::ServerModelOverviewSelection>,
    pub bytes: &'a [u8],
    pub sha256: &'a str,
}

use super::super::{
    Authorization, Contract, Error, Result, Runtime, Scope, repository as native_repo,
};
use super::{
    AtlasStore, measurement_assertions_repository as repo, measurement_profile as profile,
};
use crate::{
    app::{
        RequestPrincipal,
        measurement_assertions::{
            self as owner, MeasurementNativeFacts, MeasurementOwners, MeasurementPhase,
        },
    },
    contracts::measurement_assertions as wire,
    measurement_assertions::{self as m, online_contract as online},
};
use rusqlite::{Connection, TransactionBehavior, params};
use serde_json::{Value, json};
use std::sync::Arc;

fn invalid() -> Error {
    Error::new("schema-incompatible", "Measurement facts are incompatible")
}
fn contract(_: crate::contracts::ContractError) -> Error {
    invalid()
}
fn access_error(e: crate::access::AccessError) -> Error {
    Error::new(e.code(), "Original measurement read fence unavailable")
}
fn policy(_: m::ValidationError) -> Error {
    Error::new(
        "invalid-contract",
        "Measurement history or proposal is invalid",
    )
}
fn require(ok: bool) -> Result<()> {
    if ok { Ok(()) } else { Err(invalid()) }
}
#[derive(Clone)]
pub struct MeasurementBinding {
    pub(super) identity: profile::MeasurementProfileIdentity,
    pub(super) owners: MeasurementOwners,
}
impl MeasurementBinding {
    pub fn belongs_to(
        &self,
        access: &crate::app::Access,
        vault: &Arc<crate::media::AssetVault>,
    ) -> bool {
        self.owners.belongs_to(access, vault)
    }
}
pub struct MeasurementPreparation {
    instance: Arc<()>,
    scope: Scope,
    fingerprint: String,
    closure: crate::contracts::semantics::ReferenceClosure,
    historical_closure: Option<crate::contracts::semantics::ReferenceClosure>,
    advisory_mutation_closure: Option<crate::contracts::semantics::ReferenceClosure>,
    optional_choice_closures: Vec<crate::contracts::semantics::ReferenceClosure>,
    disclosure_keys: Vec<(String, String)>,
    receipt_cut: Option<String>,
}
impl MeasurementPreparation {
    pub fn source_closure(&self) -> &crate::contracts::semantics::ReferenceClosure {
        &self.closure
    }
    pub fn historical_source_closure(
        &self,
    ) -> Option<&crate::contracts::semantics::ReferenceClosure> {
        self.historical_closure.as_ref()
    }
    /// Context-only planning for the EXACT whole-home closure used by writes.
    /// This is independent of both current and historical disclosure planning.
    pub fn advisory_mutation_source_closure(
        &self,
    ) -> Option<&crate::contracts::semantics::ReferenceClosure> {
        self.advisory_mutation_closure.as_ref()
    }
    pub fn optional_choice_source_closures(&self) -> &[crate::contracts::semantics::ReferenceClosure] {
        &self.optional_choice_closures
    }
}
pub enum MeasurementRead {
    Current { assertion_id: String },
    FullHistory { assertion_id: String },
    MutationOutcome { mutation_id: String },
}

pub(super) fn facts(db: &Connection, scope: &Scope) -> Result<MeasurementNativeFacts> {
    let native = native_repo::scoped_snapshot_limit(db, scope, true)?;
    let mut documents = Vec::new();
    let mut bytes = serde_json::to_vec(&native)?.len();
    if bytes > repo::MAX_HOME_BYTES {
        return Err(Error::new(
            "export-too-large",
            "Native measurement context exceeds bound",
        ));
    }
    let mut stmt = db.prepare("SELECT body FROM geodata_records WHERE workspace_id=?1 AND home_id=?2 ORDER BY record_id LIMIT 10001")?;
    let mut rows = stmt.query(params![scope.workspace_id, scope.home_id])?;
    while let Some(row) = rows.next()? {
        let body: String = row.get(0)?;
        bytes = bytes.saturating_add(body.len());
        if bytes > repo::MAX_HOME_BYTES || documents.len() >= 10_000 {
            return Err(Error::new(
                "export-too-large",
                "Native measurement context exceeds bound",
            ));
        }
        documents.push(crate::contracts::v2::parse_value(body.as_bytes()).map_err(contract)?);
    }
    let mut retained = |sql: &str| -> Result<Vec<Value>> {
        let mut statement = db.prepare(sql)?;
        let mut rows = statement.query(params![scope.workspace_id, scope.home_id])?;
        let mut result = Vec::new();
        while let Some(r) = rows.next()? {
            let body: String = r.get(0)?;
            bytes = bytes.saturating_add(body.len());
            if bytes > repo::MAX_HOME_BYTES || result.len() >= 10_000 {
                return Err(Error::new(
                    "export-too-large",
                    "Native retained context exceeds bound",
                ));
            }
            result.push(crate::contracts::v2::parse_value(body.as_bytes()).map_err(contract)?);
        }
        Ok(result)
    };
    let native_receipts = retained(
        "SELECT body FROM receipts WHERE workspace_id=?1 AND home_id=?2 ORDER BY rowid LIMIT 10001",
    )?;
    let document_history = retained(
        "SELECT record_body FROM geodata_audits WHERE workspace_id=?1 AND home_id=?2 ORDER BY seq LIMIT 10001",
    )?;
    Ok(MeasurementNativeFacts {
        scope: scope.clone(),
        native,
        documents,
        native_receipts,
        document_history,
    })
}
fn fingerprint(facts: &MeasurementNativeFacts) -> Result<String> {
    wire::digest(&json!({"native":facts.native,"documents":facts.documents,"nativeReceipts":facts.native_receipts,"documentHistory":facts.document_history})).map_err(contract)
}
pub(super) fn assertions(rows: &[repo::Retained]) -> Result<Vec<m::MeasurementAssertion>> {
    rows.iter()
        .map(|r| wire::assertion(&r.body["committed"]["assertion"]).map_err(contract))
        .collect()
}
pub(super) fn history(
    scope: &Scope,
    id: &str,
    head: &repo::Retained,
    rows: &[repo::Retained],
    point: &online::ReadPoint,
) -> Result<online::FullHistory> {
    let versions = rows
        .iter()
        .filter(|r| r.body["committed"]["assertion"]["version"]["assertionId"] == id)
        .map(|r| wire::committed(&r.body["committed"]).map_err(contract))
        .collect::<Result<Vec<_>>>()?;
    Ok(online::FullHistory {
        scope: serde_json::from_value(serde_json::to_value(scope)?)?,
        assertion_id: id.into(),
        expected_current_head: wire::assertion(&head.body["committed"]["assertion"])
            .map_err(contract)?
            .version,
        read_point: point.clone(),
        versions,
    })
}
fn response(receipt: &repo::Retained, replayed: bool) -> Result<Value> {
    let v = json!({"profile":"houseatlas.measurement-mutation-result.v1","receipt":receipt.body,"receiptSha256":receipt.sha256,"replayed":replayed});
    wire::validate_value("mutationResult", &v).map_err(contract)?;
    Ok(v)
}
fn row_key(r: &repo::Retained) -> Result<(String, String)> {
    let k = &r.body["committed"]["receiptKey"];
    Ok((
        repo::text(k, "actorId")?.into(),
        repo::text(k, "mutationId")?.into(),
    ))
}
fn receipt_cut(rows: &[repo::Retained]) -> Result<String> {
    wire::digest(&json!(rows.iter().map(|r| &r.sha256).collect::<Vec<_>>())).map_err(contract)
}
fn expand_disclosure(
    rows: &[repo::Retained],
    mut selected: Vec<repo::Retained>,
) -> Result<Vec<repo::Retained>> {
    fn pins(v: &Value, out: &mut Vec<Value>) {
        match v {
            Value::Array(a) => {
                for v in a {
                    pins(v, out)
                }
            }
            Value::Object(o) => {
                if o.contains_key("assertionId")
                    && (o.contains_key("payloadSha256") || o.contains_key("expectedPayloadSha256"))
                {
                    out.push(v.clone());
                }
                for v in o.values() {
                    pins(v, out);
                }
            }
            _ => {}
        }
    }
    loop {
        let before = selected.len();
        let mut wanted = Vec::new();
        for r in &selected {
            pins(&r.body, &mut wanted);
        }
        for r in rows {
            let v = &r.body["committed"]["assertion"]["version"];
            if wanted.iter().any(|p| {
                p["assertionId"] == v["assertionId"]
                    && (p["revision"] == v["revision"] || p["expectedRevision"] == v["revision"])
                    && (p["payloadSha256"] == v["payloadSha256"]
                        || p["expectedPayloadSha256"] == v["payloadSha256"])
            }) && !selected.iter().any(|s| s.sha256 == r.sha256)
            {
                selected.push(r.clone());
            }
        }
        if selected.len() == before {
            break;
        }
    }
    Ok(selected)
}
fn digest_metadata(r: &repo::Retained) -> Value {
    json!({"assertion":r.body["committed"]["assertion"]["version"],"receiptSha256":r.sha256})
}
fn heads(db: &Connection, scope: &Scope, rows: &[repo::Retained]) -> Result<Vec<repo::Retained>> {
    let mut seen = std::collections::BTreeSet::new();
    let mut result = Vec::new();
    for r in rows {
        let id = repo::text(&r.body["committed"]["assertion"]["version"], "assertionId")?;
        if seen.insert(id.to_owned()) {
            let h = repo::head(db, scope, id)?.ok_or_else(invalid)?;
            require(rows.iter().any(|r| r.sha256 == h.sha256))?;
            result.push(h);
        }
    }
    Ok(result)
}
fn same_room(a: &repo::Retained, b: &repo::Retained) -> bool {
    a.body["committed"]["targetAdmission"]["roomIdentity"]["record"]
        == b.body["committed"]["targetAdmission"]["roomIdentity"]["record"]
}
fn same_target(a: &repo::Retained, b: &repo::Retained) -> bool {
    a.body["committed"]["assertion"]["target"] == b.body["committed"]["assertion"]["target"]
}
fn history_value(
    scope: &Scope,
    id: &str,
    head: &repo::Retained,
    rows: &[repo::Retained],
    point: &online::ReadPoint,
) -> Result<Value> {
    let h = history(scope, id, head, rows, point)?;
    let all = assertions(rows)?;
    online::validate_full_history(&h, &all).map_err(policy)?;
    let stream = rows
        .iter()
        .filter(|r| r.body["committed"]["assertion"]["version"]["assertionId"] == id)
        .collect::<Vec<_>>();
    Ok(
        json!({"profile":"houseatlas.measurement-history.v1","scope":scope,"assertionId":id,"expectedCurrentHead":wire::version_value(&h.expected_current_head),"readPoint":{"marker":point.marker},
        "versions":stream.iter().map(|r|&r.body).collect::<Vec<_>>(),"receiptDigests":stream.iter().map(|r|digest_metadata(r)).collect::<Vec<_>>()}),
    )
}
fn projections(input: MeasurementProjectionInput<'_, '_>) -> Result<(Value, Value)> {
    let MeasurementProjectionInput {
        guard,
        p,
        owners,
        f,
        selected,
        rows,
        all_heads,
        point,
        complete,
    } = input;
    let pin = &selected.body["committed"]["assertion"]["version"];
    let unavailable = |reason: &str| {
        let value = json!({"assertion":pin,"readPoint":{"marker":point.marker},"status":"unavailable","reason":reason});
        (value.clone(), value)
    };
    if !complete {
        return Ok(unavailable("historical-disclosure-unavailable"));
    }
    let reference = owner::MeasurementAssociationReference::new(
        &selected.body["committed"]["proposal"]["target"],
        &selected.body["committed"]["targetAdmission"],
    );
    let exact = owners.association(guard, p, f, reference, &selected.body)?;
    if exact["status"] != "reviewed" || exact["relation"] != "applicable" {
        return Ok(unavailable("historical-source-unavailable"));
    }
    let mut associated = Vec::new();
    for other in all_heads
        .iter()
        .filter(|r| same_room(selected, r) && !same_target(selected, r))
    {
        let association = owners.association(guard, p, f, reference, &other.body)?;
        match association["status"].as_str() {
            Some("reviewed") => {
                if association["relation"] == "applicable" {
                    associated.push(other);
                }
            }
            Some("review-required") => return Ok(unavailable("historical-association-unreviewed")),
            _ => return Ok(unavailable("historical-source-unavailable")),
        }
    }
    let all = assertions(rows)?;
    let id = repo::text(pin, "assertionId")?;
    let h = history(&f.scope, id, selected, rows, point)?;
    let fresh = online::current(
        &h,
        online::CurrentClosure::CompleteAtReadPoint {
            read_point: point.clone(),
            assertions: &all,
        },
    )
    .map_err(policy)?;
    let mut review = wire::current_value_review(
        &fresh.head.assertion,
        online::CurrentClosure::CompleteAtReadPoint {
            read_point: point.clone(),
            assertions: &all,
        },
    )
    .map_err(contract)?;
    for other in associated {
        let a = wire::assertion(&other.body["committed"]["assertion"]).map_err(contract)?;
        if a.value
            .compare(&fresh.head.assertion.value)
            .map_err(policy)?
            != std::cmp::Ordering::Equal
        {
            review["status"] = json!("review-required");
            review["conflictingAssertions"]
                .as_array_mut()
                .ok_or_else(invalid)?
                .push(wire::version_value(&a.version));
        }
    }
    Ok((
        wire::conflicts_value(&fresh.current_conflicts).map_err(contract)?,
        review,
    ))
}

impl<C, A, R> AtlasStore<C, A, R>
where
    C: Contract,
    A: Authorization<Principal = RequestPrincipal>,
    R: Runtime,
{
    /// Read-only context: no assertion/mutation/audit allocation or write. The
    /// marker is an opaque disclosure cut, not a persisted revision or grant.
    pub fn measurement_occurrence_context(
        &mut self,
        input: MeasurementContextInput<'_, '_>,
    ) -> Result<Value> {
        let MeasurementContextInput {
            p,
            guard,
            binding,
            prepared,
            historical,
            mutation_sources,
            choice_sources,
            input,
        } = input;
        wire::validate_value("contextRequest", input)
            .map_err(|_| Error::new("invalid-contract", "Invalid occurrence context request"))?;
        require(
            self.measurement_binding_matches(binding)
                && Arc::ptr_eq(&self.instance, &prepared.instance)
                && input["scope"] == serde_json::to_value(&prepared.scope)?,
        )?;
        let tx = self.db.transaction()?;
        let f = facts(&tx, &prepared.scope)?;
        let rows = repo::complete_home(&tx, &prepared.scope)?;
        require(
            fingerprint(&f)? == prepared.fingerprint
                && prepared.receipt_cut.as_ref() == Some(&receipt_cut(&rows)?),
        )?;
        binding
            .owners
            .authorize(guard, p, &f, &prepared.closure, false)?;
        let selected = rows
            .iter()
            .filter(|r| row_key(r).is_ok_and(|k| prepared.disclosure_keys.contains(&k)))
            .cloned()
            .collect::<Vec<_>>();
        binding.owners.disclose(
            guard,
            p,
            &f,
            &selected.iter().map(|r| r.body.clone()).collect::<Vec<_>>(),
        )?;
        let complete = match (historical, &prepared.historical_closure) {
            (Some(h), Some(c)) => {
                require(std::ptr::eq(
                    h.principal.principal(),
                    p.principal.principal(),
                ))?;
                h.release_guard(guard, c).is_ok()
            }
            _ => false,
        };
        let disclosed = if complete {
            historical.ok_or_else(invalid)?
        } else {
            p
        };
        // Complete receipts stay internal for dependency planning/qualification.
        // Current claims and historical exposure retain their separate fences.
        let all_bodies = rows.iter().map(|r| r.body.clone()).collect::<Vec<_>>();
        if complete {
            binding.owners.disclose(guard, disclosed, &f, &all_bodies)?;
        }
        require(
            binding.owners.optional_choice_closures(&input["selector"], &f, &all_bodies)?
                == prepared.optional_choice_closures,
        )?;
        let mut admitted = binding.owners.context(
            guard,
            disclosed,
            &input["selector"],
            &f,
            &all_bodies,
            choice_sources,
        )?;
        // Advisory source completeness is NOT historical disclosure completeness.
        // Recompute the actual mutation-required closure at this same SQL cut,
        // then revalidate the separately captured SAME original Read allocation.
        // No Mutate probe, new authorization or source-policy fallback occurs.
        let required_mutation_closure = owner::source_closure(&f)?;
        require(prepared.advisory_mutation_closure.as_ref() == Some(&required_mutation_closure))?;
        let mutation_source_complete = match mutation_sources {
            Some(captured) => {
                require(std::ptr::eq(
                    captured.principal.principal(),
                    p.principal.principal(),
                ))?;
                captured
                    .release_guard(guard, &required_mutation_closure)
                    .is_ok()
            }
            None => false,
        };
        if !mutation_source_complete {
            admitted["writeEligibility"] = json!({"advisory":true,"status":"ineligible","reason":"required-source-access-unavailable"});
            if let Some(methods) = admitted["methods"].as_array_mut() {
                for method in methods {
                    if method["method"] == "user-reported-measured" {
                        method["status"] = json!("unavailable");
                        method["reason"] = json!("Required source authorization unavailable");
                        method["support"] = Value::Null;
                    }
                }
            }
        }
        let point=online::ReadPoint{marker:wire::digest(&json!({"domain":"houseatlas.measurement-context-read-point/1","facts":prepared.fingerprint,
            "actorId":p.principal.actor_id().as_str(),"selector":input["selector"],"receipts":receipt_cut(&rows)?})).map_err(contract)?};
        let all_heads = heads(&tx, &prepared.scope, &rows)?;
        let t = &admitted["target"];
        let mut claims = Vec::new();
        let mut historical_streams = Vec::new();
        let mut review_reasons = Vec::<String>::new();
        let mut unavailable_reasons = Vec::<String>::new();
        for head in &all_heads {
            let c = &head.body["committed"];
            let target = &c["assertion"]["target"];
            let current = target["namespace"]["publicationId"] == t["publicationId"]
                && target["buildingId"] == t["buildingId"]
                && target["roomId"] == t["roomId"]
                && target["floorId"] == t["levelId"]
                && target["occurrenceId"] == t["occurrenceId"];
            let id = repo::text(&c["assertion"]["version"], "assertionId")?;
            if current {
                require(selected.iter().any(|r| r.sha256 == head.sha256))?;
                for key in [
                    "sourceRevisionId",
                    "sourceSha256",
                    "semanticsSha256",
                    "overviewManifestSha256",
                    "artifactId",
                    "artifactSha256",
                    "artifactBytes",
                    "targetFeatureSha256",
                    "sourceObjectIds",
                ] {
                    if c["proposal"]["target"][key] != t[key] {
                        return Err(Error::new(
                            "measurement-context-incomplete-coverage",
                            "Reviewed target correspondence unavailable",
                        ));
                    }
                }
                let (conflicts, values) = projections(MeasurementProjectionInput {
                    guard,
                    p: disclosed,
                    owners: &binding.owners,
                    f: &f,
                    selected: head,
                    rows: &rows,
                    all_heads: &all_heads,
                    point: &point,
                    complete,
                })?;
                claims.push(json!({"profile":"houseatlas.measurement-current.v1","head":head.body,"receiptDigest":digest_metadata(head),"readPoint":{"marker":point.marker},
                    "currentConflicts":conflicts,"currentValueReview":values}));
            } else if complete
                && c["targetAdmission"]["roomIdentity"]["record"]
                    == admitted["targetAdmission"]["roomIdentity"]["record"]
            {
                let reference = owner::MeasurementAssociationReference::new(
                    &admitted["target"],
                    &admitted["targetAdmission"],
                );
                let association = binding
                    .owners
                    .association(guard, disclosed, &f, reference, &head.body)?;
                if association["status"] == "review-required" {
                    let reason = repo::text(&association, "reason")?.to_owned();
                    if !review_reasons.contains(&reason) {
                        review_reasons.push(reason);
                    }
                }
                if association["status"] == "unavailable" {
                    let reason = repo::text(&association, "reason")?.to_owned();
                    if !unavailable_reasons.contains(&reason) {
                        unavailable_reasons.push(reason);
                    }
                }
                let model = &c["assertion"]["enteredAgainst"];
                historical_streams.push(json!({"history":history_value(&prepared.scope,id,head,&rows,&point)?,"association":association,
                    "producerContext":{"state":if model["custody"]["kind"]=="unknown"&&model["physicalRegistration"]["kind"]=="unknown"{"recorded-context-unverified"}else{"required-native-custody-qualified"},
                        "originalModel":model,"currentApplicability":"not-qualified-by-inventory-validation"}}));
            }
        }
        let historical_coverage = if !complete {
            json!({"status":"unavailable","readPoint":{"marker":point.marker},"reasons":["disclosure-not-authorized"]})
        } else if !unavailable_reasons.is_empty() {
            json!({"status":"unavailable","readPoint":{"marker":point.marker},"reasons":unavailable_reasons})
        } else if !review_reasons.is_empty() {
            json!({"status":"association-review-required","readPoint":{"marker":point.marker},"reasons":review_reasons})
        } else {
            json!({"status":"complete","readPoint":{"marker":point.marker}})
        };
        let mutations = if complete {
            rows.iter().filter(|r|r.body["committed"]["receiptKey"]["actorId"]==p.principal.actor_id().as_str()).map(|r|{
            let c=&r.body["committed"];json!({"mutationId":c["receiptKey"]["mutationId"],"assertion":c["assertion"]["version"],"proposalSha256":c["proposalSha256"],"receiptSha256":r.sha256})
        }).collect::<Vec<_>>()
        } else {
            vec![]
        };
        let coverage = if complete {
            json!({"status":"complete-for-exact-publication-occurrence","priorPublications":"not-retargeted","retainedHomeVersions":rows.len(),"mutationCoverage":"current-actor-complete-home-retained-measurement-receipts"})
        } else {
            json!({"status":"limited-current-publication-occurrence","priorPublications":"not-retargeted","mutationCoverage":"unavailable"})
        };
        let result = json!({"profile":"houseatlas.measurement-occurrence-context.v1","scope":prepared.scope,"actorId":p.principal.actor_id().as_str(),"readPoint":{"marker":point.marker},
            "selector":input["selector"],"target":admitted["target"],"targetAdmission":admitted["targetAdmission"],"writeEligibility":admitted["writeEligibility"],"coverage":coverage,
            "claims":claims,"historical":{"coverage":historical_coverage,"streams":historical_streams},"methods":admitted["methods"],"evidence":admitted["evidence"],"committedMutations":mutations,
            "unrecordedIntentRecovery":"unavailable-after-client-state-loss"});
        wire::validate_value("contextResponse", &result).map_err(contract)?;
        for claim in result["claims"].as_array().ok_or_else(invalid)? {
            wire::validate_external_receipts(claim).map_err(contract)?;
        }
        for stream in result["historical"]["streams"]
            .as_array()
            .ok_or_else(invalid)?
        {
            wire::validate_external_receipts(&stream["history"]).map_err(contract)?;
        }
        if serde_json::to_vec(&result)?.len() > repo::MAX_HOME_BYTES {
            return Err(Error::new(
                "measurement-context-incomplete-coverage",
                "Occurrence context exceeds bound",
            ));
        }
        // Recheck CURRENT mapping only. Historical opaque context never becomes
        // a requirement to open old producer content or an applicability grant.
        let again = binding
            .owners
            .context(guard, disclosed, &input["selector"], &f, &all_bodies, choice_sources)?;
        require(
            again["target"] == admitted["target"]
                && again["targetAdmission"] == admitted["targetAdmission"],
        )?;
        if complete {
            disclosed
                .release_guard(
                    guard,
                    prepared.historical_closure.as_ref().ok_or_else(invalid)?,
                )
                .map_err(access_error)?;
        }
        binding
            .owners
            .authorize(guard, p, &f, &prepared.closure, false)?;
        tx.commit()?;
        Ok(result)
    }
    pub fn measurement_binding_matches(&self, binding: &MeasurementBinding) -> bool {
        Arc::ptr_eq(&self.instance, &binding.identity.instance)
            && self.full_geodata.as_ref().is_some_and(|o| {
                o.belongs_to(
                    binding.owners.access(),
                    &binding.owners.vault_for_composition(),
                )
            })
    }
    /// Scope-read authorization precedes SQL preparation. This captures no
    /// receipt outcome and allocates no assertion ID. Original source grants
    /// are captured by the caller before entering its native Access fence.
    pub fn prepare_measurement(
        &mut self,
        p: &RequestPrincipal,
        scope: &Scope,
        binding: &MeasurementBinding,
    ) -> Result<MeasurementPreparation> {
        require(self.measurement_binding_matches(binding))?;
        super::authorize(
            &self.contract,
            &self.authorization,
            p,
            super::read_request(scope, super::super::Capability::Read, &[]),
        )?;
        let tx = self.db.transaction()?;
        let f = facts(&tx, scope)?;
        let closure = owner::source_closure(&f)?;
        let fingerprint = fingerprint(&f)?;
        tx.commit()?;
        Ok(MeasurementPreparation {
            instance: self.instance.clone(),
            scope: scope.clone(),
            fingerprint,
            closure,
            historical_closure: None,
            advisory_mutation_closure: None,
            optional_choice_closures: vec![],
            disclosure_keys: vec![],
            receipt_cut: None,
        })
    }
    /// Detached read planning only. Native body exposure waits for original
    /// source-grant capture, the same SQL-cut proof and held Read authorization.
    pub fn prepare_measurement_disclosure(
        &mut self,
        p: &RequestPrincipal,
        scope: &Scope,
        binding: &MeasurementBinding,
        selector: Option<&Value>,
        assertion_id: Option<&str>,
        mutation_id: Option<&str>,
    ) -> Result<MeasurementPreparation> {
        require(self.measurement_binding_matches(binding))?;
        super::authorize(
            &self.contract,
            &self.authorization,
            p,
            super::read_request(scope, super::super::Capability::ReadHistory, &[]),
        )?;
        let tx = self.db.transaction()?;
        let f = facts(&tx, scope)?;
        let rows = repo::complete_home(&tx, scope)?;
        let mut extra = Vec::new();
        if let Some(selector) = selector {
            extra = binding.owners.target_pins(selector)?;
        }
        let seeds = rows
            .iter()
            .filter(|r| {
                let c = &r.body["committed"];
                let t = &c["proposal"]["target"];
                if let Some(s) = selector {
                    return [
                        "publicationId",
                        "buildingId",
                        "roomId",
                        "levelId",
                        "occurrenceId",
                    ]
                    .iter()
                    .all(|k| t[*k] == s[*k]);
                }
                if let Some(id) = assertion_id {
                    return c["assertion"]["version"]["assertionId"] == id;
                }
                if let Some(id) = mutation_id {
                    return c["receiptKey"]["actorId"] == p.principal.actor_id().as_str()
                        && c["receiptKey"]["mutationId"] == id;
                }
                false
            })
            .cloned()
            .collect();
        let selected = expand_disclosure(&rows, seeds)?;
        let bodies = selected.iter().map(|r| r.body.clone()).collect::<Vec<_>>();
        let closure = owner::disclosure_closure(&f, &bodies, &extra)?;
        let historical_closure = if mutation_id.is_none() {
            Some(owner::disclosure_closure(
                &f,
                &rows.iter().map(|r| r.body.clone()).collect::<Vec<_>>(),
                &extra,
            )?)
        } else {
            None
        };
        let advisory_mutation_closure = if selector.is_some() {
            Some(owner::source_closure(&f)?)
        } else {
            None
        };
        let optional_choice_closures = match selector {
            Some(selector) => binding.owners.optional_choice_closures(
                selector,
                &f,
                &rows.iter().map(|row| row.body.clone()).collect::<Vec<_>>(),
            )?,
            None => vec![],
        };
        let preparation = MeasurementPreparation {
            instance: self.instance.clone(),
            scope: scope.clone(),
            fingerprint: fingerprint(&f)?,
            closure,
            historical_closure,
            advisory_mutation_closure,
            optional_choice_closures,
            disclosure_keys: selected.iter().map(row_key).collect::<Result<_>>()?,
            receipt_cut: Some(receipt_cut(&rows)?),
        };
        tx.commit()?;
        Ok(preparation)
    }
    pub fn write_measurement(
        &mut self,
        p: &RequestPrincipal,
        guard: &crate::access::TransactionAuthorization<'_>,
        binding: &MeasurementBinding,
        prepared: &MeasurementPreparation,
        input: &Value,
    ) -> Result<Value> {
        require(
            self.measurement_binding_matches(binding)
                && Arc::ptr_eq(&self.instance, &prepared.instance),
        )?;
        let proposal = wire::proposal(input)
            .map_err(|_| Error::new("invalid-contract", "Invalid exact-area proposal"))?;
        require(
            proposal.scope.workspace_id == prepared.scope.workspace_id
                && proposal.scope.home_id == prepared.scope.home_id,
        )?;
        let runtime = &self.runtime;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let f = facts(&tx, &prepared.scope)?;
        let closure = owner::source_closure(&f)?;
        require(fingerprint(&f)? == prepared.fingerprint && closure == prepared.closure)?;
        binding.owners.authorize(guard, p, &f, &closure, true)?;
        let actor = p.principal.actor_id().as_str();
        // Actual actor-scoped receipt lookup is BEFORE materialization/allocation.
        if let Some(saved) = repo::lookup(&tx, &prepared.scope, actor, &proposal.mutation_id)? {
            if saved.body["committed"]["proposalSha256"]
                != online::proposal_digest(&proposal).map_err(policy)?
                || wire::canonical(&saved.body["committed"]["proposal"]).map_err(contract)?
                    != wire::canonical(input).map_err(contract)?
            {
                return Err(Error::new(
                    "idempotency-conflict",
                    "Mutation key belongs to another proposal",
                ));
            }
            binding.owners.retained(
                guard,
                p,
                MeasurementPhase::Replay,
                &f,
                std::slice::from_ref(&saved.body),
            )?;
            binding.owners.authorize(guard, p, &f, &closure, true)?;
            binding.owners.retained(
                guard,
                p,
                MeasurementPhase::Release,
                &f,
                std::slice::from_ref(&saved.body),
            )?;
            let result = response(&saved, true)?;
            tx.commit()?;
            return Ok(result);
        }
        let rows = repo::complete_home(&tx, &prepared.scope)?;
        if rows.len() >= repo::MAX_HOME_VERSIONS {
            return Err(Error::new(
                "export-too-large",
                "Measurement history requires reviewed capacity expansion",
            ));
        }
        let retained: Vec<_> = rows.iter().map(|r| r.body.clone()).collect();
        binding
            .owners
            .retained(guard, p, MeasurementPhase::Intake, &f, &retained)?;
        let prior = match &proposal.operation {
            online::OnlineOperation::Create => None,
            online::OnlineOperation::Correct {
                assertion_id,
                expected_revision,
                expected_payload_sha256,
            } => {
                let old = repo::head(&tx, &prepared.scope, assertion_id)?
                    .ok_or(Error::new("not-found", "Measurement unavailable"))?;
                let old_a = &old.body["committed"]["assertion"];
                if wire::integer(&old_a["version"]["revision"]).map_err(contract)?
                    != *expected_revision
                    || old_a["version"]["payloadSha256"] != *expected_payload_sha256
                {
                    return Err(Error::new(
                        "revision-conflict",
                        "Measurement head changed; review before retry",
                    ));
                }
                Some(old)
            }
        };
        let material = binding
            .owners
            .materialize(guard, p, &proposal, &f, &retained)?;
        verify_comparison_pins(&proposal, &f, &rows)?;
        // Only now may a NEW assertion identity be allocated by the server.
        let (id, revision, previous) = match &prior {
            None => (runtime.new_id()?, 1, json!(null)),
            Some(old) => {
                let a = &old.body["committed"]["assertion"];
                (
                    repo::text(&a["version"], "assertionId")?.to_owned(),
                    wire::integer(&a["version"]["revision"]).map_err(contract)? + 1,
                    a["version"].clone(),
                )
            }
        };
        let audit_id = runtime.new_id()?;
        let at = runtime.now()?;
        let acquisition = match &material.acquisition {
            owner::MeasurementAcquisitionPlan::Qualified(value) => value.clone(),
            owner::MeasurementAcquisitionPlan::UserReportedPersonalMeasurement { attestation } => {
                require(proposal.area.attestation.as_ref() == Some(attestation))?;
                json!({"kind":"user-reported-measurement","attestation":{"kind":"personally-measured"},"actorId":actor,"recordedAt":at})
            }
        };
        let contradicts: Vec<_> = proposal.area.contradicts.iter().map(|e| json!({"assertionId":e.assertion_id,"revision":e.expected_revision,"payloadSha256":e.expected_payload_sha256})).collect();
        let mut a = json!({"version":{"assertionId":id,"revision":revision,"payloadSha256":"0".repeat(64)},"previous":previous,
            "target":material.target,"property":"occurrence-area","value":{"decimalToken":proposal.area.decimal_token,"unit":input["area"]["unit"],"quantityKind":"area"},
            "enteredAgainst":material.model,"targetFeatureSha256":proposal.target.target_feature_sha256,"method":input["area"]["method"],
            "support":material.support,"inputs":material.inputs,"operation":input["area"]["operation"],"evidence":material.evidence,
            "supersedes":[],"contradicts":contradicts,"resolutions":[],"review":material.review,"changeReason":proposal.reason,"nativeAuditId":audit_id});
        a["version"]["payloadSha256"] =
            json!(wire::assertion_payload_digest(&a).map_err(contract)?);
        let new_a = wire::assertion(&a).map_err(contract)?;
        let mut all = assertions(&rows)?;
        all.push(new_a.clone());
        m::validate_history(&all).map_err(policy)?;
        let conflicts = online::conflict_projection(
            &new_a.version,
            online::ReadPoint {
                marker: audit_id.clone(),
            },
            &all,
        )
        .map_err(policy)?;
        let pending: Vec<_> = conflicts
            .conflicts
            .iter()
            .map(|c| wire::conflict_value(&c.contradiction).map_err(contract))
            .collect::<Result<_>>()?;
        let before = prior
            .as_ref()
            .map(|old| {
                wire::full_assertion_digest(&old.body["committed"]["assertion"]).map_err(contract)
            })
            .transpose()?;
        let previous_revision = prior
            .as_ref()
            .map(|old| {
                wire::integer(&old.body["committed"]["assertion"]["version"]["revision"])
                    .map_err(contract)
            })
            .transpose()?;
        let audit = json!({"schemaVersion":1,"auditId":audit_id,"scope":proposal.scope,"assertionId":id,"operation":if prior.is_none(){"create"}else{"correct"},
            "previousRevision":previous_revision,"resultRevision":revision,"actorId":actor,"at":at,"reason":proposal.reason,"mutationId":proposal.mutation_id,
            "beforeDigest":before,"afterDigest":wire::full_assertion_digest(&a).map_err(contract)?});
        let outcome = json!({"format":"houseatlas.measurement-receipt/1","committed":{"assertion":a,"proposal":input,
            "proposalSha256":online::proposal_digest(&proposal).map_err(policy)?,"receiptKey":{"scope":proposal.scope,"actorId":actor,"mutationId":proposal.mutation_id},
            "audit":{"auditId":audit_id,"actorId":actor,"mutationId":proposal.mutation_id,"serverRecordedAt":at,"previousRevision":previous_revision,"resultRevision":revision},
            "targetAdmission":material.target_admission,"acquisition":acquisition,"pending":{"assertion":a["version"],"model":a["enteredAgainst"],"targetFeatureSha256":a["targetFeatureSha256"],"unresolvedConflicts":pending}},"audit":audit});
        let parsed = wire::committed(&outcome["committed"]).map_err(contract)?;
        let mut stream: Vec<_> = rows
            .iter()
            .filter(|r| r.body["committed"]["assertion"]["version"]["assertionId"] == id)
            .map(|r| wire::committed(&r.body["committed"]).map_err(contract))
            .collect::<Result<_>>()?;
        stream.push(parsed.clone());
        online::validate_full_history(
            &online::FullHistory {
                scope: proposal.scope.clone(),
                assertion_id: id.clone(),
                expected_current_head: parsed.assertion.version.clone(),
                read_point: online::ReadPoint {
                    marker: audit_id.clone(),
                },
                versions: stream,
            },
            &all,
        )
        .map_err(policy)?;
        binding.owners.authorize(guard, p, &f, &closure, true)?;
        binding.owners.requalify(
            guard,
            p,
            MeasurementPhase::Candidate,
            &proposal,
            &f,
            &material,
        )?;
        let saved = repo::append(&tx, &prepared.scope, actor, &outcome)?;
        binding.owners.authorize(guard, p, &f, &closure, true)?;
        binding.owners.requalify(
            guard,
            p,
            MeasurementPhase::Precommit,
            &proposal,
            &f,
            &material,
        )?;
        binding.owners.requalify(
            guard,
            p,
            MeasurementPhase::Release,
            &proposal,
            &f,
            &material,
        )?;
        let result = response(&saved, false)?;
        tx.commit()?;
        Ok(result)
    }
    pub fn read_measurement(
        &mut self,
        p: &RequestPrincipal,
        guard: &crate::access::TransactionAuthorization<'_>,
        binding: &MeasurementBinding,
        prepared: &MeasurementPreparation,
        historical: Option<&RequestPrincipal>,
        action: MeasurementRead,
    ) -> Result<Value> {
        require(
            self.measurement_binding_matches(binding)
                && Arc::ptr_eq(&self.instance, &prepared.instance),
        )?;
        let point = online::ReadPoint {
            marker: self.runtime.new_id()?,
        };
        let tx = self.db.transaction()?;
        let f = facts(&tx, &prepared.scope)?;
        let rows = repo::complete_home(&tx, &prepared.scope)?;
        require(
            fingerprint(&f)? == prepared.fingerprint
                && prepared.receipt_cut.as_ref() == Some(&receipt_cut(&rows)?),
        )?;
        binding
            .owners
            .authorize(guard, p, &f, &prepared.closure, false)?;
        let selected = rows
            .iter()
            .filter(|r| row_key(r).is_ok_and(|k| prepared.disclosure_keys.contains(&k)))
            .cloned()
            .collect::<Vec<_>>();
        binding.owners.disclose(
            guard,
            p,
            &f,
            &selected.iter().map(|r| r.body.clone()).collect::<Vec<_>>(),
        )?;
        let complete = match (historical, &prepared.historical_closure) {
            (Some(h), Some(c)) => {
                require(std::ptr::eq(
                    h.principal.principal(),
                    p.principal.principal(),
                ))?;
                h.release_guard(guard, c).is_ok()
            }
            _ => false,
        };
        let disclosure = if complete {
            historical.ok_or_else(invalid)?
        } else {
            p
        };
        if complete {
            binding.owners.disclose(
                guard,
                disclosure,
                &f,
                &rows.iter().map(|r| r.body.clone()).collect::<Vec<_>>(),
            )?;
        }
        let current = matches!(&action, MeasurementRead::Current { .. });
        let result = match action {
            MeasurementRead::MutationOutcome { mutation_id } => match repo::lookup(
                &tx,
                &prepared.scope,
                p.principal.actor_id().as_str(),
                &mutation_id,
            )? {
                None => {
                    json!({"status":"not-recorded-at-read-point","scope":prepared.scope,"mutationId":mutation_id,"readPoint":{"marker":point.marker}})
                }
                Some(saved) => {
                    require(selected.iter().any(|r| r.sha256 == saved.sha256))?;
                    json!({"status":"committed","result":response(&saved,true)?})
                }
            },
            MeasurementRead::Current { assertion_id }
            | MeasurementRead::FullHistory { assertion_id } => {
                let head = repo::head(&tx, &prepared.scope, &assertion_id)?
                    .ok_or(Error::new("not-found", "Measurement unavailable"))?;
                require(selected.iter().any(|r| r.sha256 == head.sha256))?;
                if current {
                    let all_heads = heads(&tx, &prepared.scope, &rows)?;
                    let (conflicts, values) = projections(MeasurementProjectionInput {
                        guard,
                        p: disclosure,
                        owners: &binding.owners,
                        f: &f,
                        selected: &head,
                        rows: &rows,
                        all_heads: &all_heads,
                        point: &point,
                        complete,
                    })?;
                    json!({"profile":"houseatlas.measurement-current.v1","head":head.body,"receiptDigest":digest_metadata(&head),"readPoint":{"marker":point.marker},"currentConflicts":conflicts,"currentValueReview":values})
                } else {
                    history_value(&prepared.scope, &assertion_id, &head, &rows, &point)?
                }
            }
        };
        let shape = if result.get("status").is_some() {
            "mutationOutcome"
        } else if result["profile"] == "houseatlas.measurement-current.v1" {
            "currentResponse"
        } else {
            "fullHistory"
        };
        wire::validate_value(shape, &result).map_err(contract)?;
        if result.get("profile").is_some() {
            wire::validate_external_receipts(&result).map_err(contract)?;
        }
        if serde_json::to_vec(&result)?.len() > repo::MAX_HOME_BYTES {
            return Err(Error::new(
                "export-too-large",
                "Complete measurement response exceeds bound",
            ));
        }
        if complete {
            disclosure
                .release_guard(
                    guard,
                    prepared.historical_closure.as_ref().ok_or_else(invalid)?,
                )
                .map_err(access_error)?;
        }
        binding
            .owners
            .authorize(guard, p, &f, &prepared.closure, false)?;
        tx.commit()?;
        Ok(result)
    }
}

impl crate::app::Store {
    /// Trusted library-only retention of an independently audited root export.
    /// Root holds Store then Access and supplies the actual original owners.
    /// This operates on an existing full native Store, before measurement
    /// selection, and introduces no mapping HTTP write or native record.
    pub fn retain_measurement_occurrence_review(
        &self,
        input: MeasurementOccurrenceReviewInput<'_, '_>,
    ) -> Result<Arc<owner::occurrence_authority::OccurrenceAuthority>> {
        let MeasurementOccurrenceReviewInput {
            p,
            guard,
            scope,
            access,
            vault,
            scene,
            overview,
            bytes,
            sha256,
        } = input;
        require(
            Arc::ptr_eq(&self.authorization.0, access)
                && self.full_geodata_belongs_to(access, vault),
        )?;
        let closure = crate::contracts::semantics::ReferenceClosure {
            record_refs: vec![],
            missing_record_refs: vec![],
            source_refs: vec![],
            source_partitions: vec![],
        };
        p.release_guard(guard, &closure).map_err(access_error)?;
        let selected = crate::app::access_scope(&crate::domain::Scope {
            workspace_id: scope.workspace_id.clone(),
            home_id: scope.home_id.clone(),
        })
        .map_err(access_error)?;
        guard
            .authorize(&selected, crate::access::Capability::ReadHistory)
            .map_err(access_error)?;
        let tx = self.db.unchecked_transaction()?;
        let f = facts(&tx, scope)?;
        let actual_closure = owner::source_closure(&f)?;
        p.release_guard(guard, &actual_closure)
            .map_err(access_error)?;
        let authority = owner::occurrence_authority::OccurrenceAuthority::retain_review(
            guard, p, &f, scene, overview, bytes, sha256,
        )?;
        tx.commit()?;
        Ok(Arc::new(authority))
    }
}

fn verify_comparison_pins(
    p: &online::OnlineProposal,
    facts: &MeasurementNativeFacts,
    rows: &[repo::Retained],
) -> Result<()> {
    let check = |e: &online::NativeExpectation| -> Result<()> {
        let id = &e.record.record_id;
        let expected_type = serde_json::to_value(e.record.record_type)?;
        let body =
            if e.record.record_type == crate::contracts::v2::RecordRefRecordType::GeodataDocument {
                facts
                    .documents
                    .iter()
                    .find(|v| v["recordId"] == *id && v["recordType"] == "geodata-document")
                    .cloned()
                    .ok_or_else(invalid)?
            } else if let Some(r) = facts.native.records.iter().find(|r| {
                r.record_id == *id
                    && r.record_type.as_str()
                        == serde_json::to_value(e.record.record_type)
                            .ok()
                            .and_then(|v| v.as_str().map(str::to_owned))
                            .unwrap_or_default()
            }) {
                serde_json::to_value(r)?
            } else {
                facts
                    .documents
                    .iter()
                    .find(|v| v["recordId"] == *id && v["recordType"] == "asset")
                    .cloned()
                    .ok_or_else(invalid)?
            };
        if body["recordType"] != expected_type
            || body["workspaceId"] != facts.scope.workspace_id
            || body["homeId"] != facts.scope.home_id
            || wire::integer(&body["revision"]).map_err(contract)? != e.expected_revision
            || wire::digest(&body["payload"]).map_err(contract)? != e.expected_payload_sha256
        {
            return Err(Error::new(
                "guard-conflict",
                "Measurement reference changed",
            ));
        }
        Ok(())
    };
    for e in &p.area.evidence {
        check(&e.reference)?;
    }
    for e in &p.area.inputs {
        match e {
            online::InputExpectation::Native(e) => check(e)?,
            online::InputExpectation::Assertion(e) => {
                require(rows.iter().any(|r| {
                    r.body["committed"]["assertion"]["version"]["assertionId"] == e.assertion_id
                        && wire::integer(&r.body["committed"]["assertion"]["version"]["revision"])
                            .ok()
                            == Some(e.expected_revision)
                        && r.body["committed"]["assertion"]["version"]["payloadSha256"]
                            == e.expected_payload_sha256
                }))?;
            }
            online::InputExpectation::SelectedModel => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod integration_tests {
    //! FROZEN/UNREGISTERED/UNEXECUTED. Genuine in-process native HTTP, persistent
    //! Store, original Access, real native review receipts and strict recovery.
    //! All configuration, IDs, publication bytes and native records are generated
    //! inside a newly owned tempdir; no listener/provider/household fixture.
    use super::*;
    use crate::{
        access as a, app,
        config::server::ServerConfig,
        http::{Host, contracts::NativeContracts, router},
        lifecycle::{backup, persistent},
        media, storage as s,
    };
    use axum::{
        Router,
        body::{Body, to_bytes},
        extract::ConnectInfo,
        http::{Request, StatusCode},
    };
    use std::{
        collections::BTreeMap,
        fs,
        os::unix::fs::PermissionsExt,
        path::{Path, PathBuf},
        sync::Mutex,
    };
    use tower::ServiceExt;
    type Failure = Box<dyn std::error::Error + Send + Sync>;
    const ORIGIN: &str = "https://127.0.0.1:48743";
    fn id(n: u64) -> String {
        format!("00000000-0000-4000-8000-{n:012x}")
    }
    fn private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
        fs::write(path, bytes)?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
    }
    fn request(
        method: &str,
        path: &str,
        body: Value,
        cookie: Option<&str>,
        csrf: Option<&str>,
    ) -> Request<Body> {
        let mut r = Request::builder()
            .method(method)
            .uri(path)
            .header("host", "127.0.0.1:48743")
            .header("origin", ORIGIN)
            .header("sec-fetch-site", "same-origin")
            .header("content-type", "application/json")
            .header("accept", "application/json");
        if let Some(c) = cookie {
            r = r.header("cookie", c);
        }
        if let Some(c) = csrf {
            r = r.header("x-atlas-csrf", c);
        }
        let mut r = r
            .body(if method == "GET" {
                Body::empty()
            } else {
                Body::from(serde_json::to_vec(&body).unwrap())
            })
            .unwrap();
        r.extensions_mut().insert(ConnectInfo(
            "127.0.0.1:50123".parse::<std::net::SocketAddr>().unwrap(),
        ));
        r
    }
    async fn exchange(
        app: &Router,
        method: &str,
        path: &str,
        body: Value,
        cookie: &str,
        csrf: &str,
    ) -> std::result::Result<(StatusCode, Value), Failure> {
        let response = app
            .clone()
            .oneshot(request(
                method,
                path,
                body,
                Some(cookie),
                (method == "POST").then_some(csrf),
            ))
            .await?;
        let status = response.status();
        let bytes = to_bytes(response.into_body(), repo::MAX_HOME_BYTES).await?;
        Ok((status, serde_json::from_slice(&bytes)?))
    }
    fn evidence_payload() -> Value {
        json!({"statement":"Reviewed generated occurrence mapping; no physical geometry qualification",
        "provenance":{"source":null,"sourceRevision":null,"sourceConfidence":null,"evidenceBasis":"owner-report","factAt":null,"retrievedAt":"2026-10-24T00:00:00Z","vantage":null,
            "uncertainty":{"status":"supported","explanation":"Generated semantic mapping review only"}},"supersedesEvidenceIds":[],"references":[]})
    }
    fn native_pin(kind: &str, n: u64, payload: &Value) -> Value {
        json!({"record":{"recordType":kind,"recordId":id(n)},"revision":1,"payloadSha256":wire::digest(payload).unwrap()})
    }
    // Exact synthetic startup approval, separate from all record/read grants.
    struct FixtureSourceAuthorization<'a> {
        guard: &'a a::TransactionAuthorization<'a>,
        principal: &'a a::Principal,
        grant: &'a a::LifecycleGrant,
        registration: &'a a::SourceRegistration,
        source: Value,
        scope: Scope,
    }
    impl s::Authorization for FixtureSourceAuthorization<'_> {
        type Principal = a::Principal;
        fn authorize(
            &self,
            principal: &a::Principal,
            request: s::AuthorizationRequest<'_>,
        ) -> s::Result<s::VerifiedActor> {
            if !std::ptr::eq(principal, self.principal)
                || !std::ptr::eq(self.guard.principal(), principal)
                || request.capability != s::Capability::ConfigureSource
                || request.scope != &self.scope
                || request.source != Some(&self.source)
                || request.source_partition.is_some()
                || !request.targets.is_empty()
                || request.mutation.is_some()
            {
                return Err(s::Error::new("forbidden", "Fixture configuration denied"));
            }
            self.guard
                .revalidate_lifecycle(
                    self.grant,
                    self.registration,
                    a::LifecycleCapability::ConfigureSource,
                )
                .map_err(|_| s::Error::new("forbidden", "Fixture configuration changed"))?;
            Ok(s::VerifiedActor {
                workspace_id: self.scope.workspace_id.clone(),
                home_id: self.scope.home_id.clone(),
                actor_id: principal.actor_id().as_str().into(),
            })
        }
    }
    fn configure_fixture_source(
        core: &Arc<Mutex<app::Core>>,
        registration: &a::SourceRegistration,
        cookie: &str,
        csrf: &str,
    ) -> std::result::Result<(), Failure> {
        let core = core.lock().map_err(|_| "Core poisoned")?;
        let mut store = core.store.lock().map_err(|_| "Store poisoned")?;
        let mut access = core.access.lock().map_err(|_| "Access poisoned")?;
        let scope = Scope {
            workspace_id: id(2),
            home_id: id(3),
        };
        let observed = a::RequestEvidence {
            method: a::Method::Post,
            url: "https://127.0.0.1:48743/generated-source-configuration",
            origin: Some(ORIGIN),
            sec_fetch_site: Some("same-origin"),
            referer: None,
            cookie: Some(cookie),
            authorization: None,
            csrf: Some(csrf),
        };
        let principal = access.authorize(
            &observed,
            &app::access_scope(&crate::domain::Scope {
                workspace_id: id(2),
                home_id: id(3),
            })?,
            a::Action::Mutate,
        )?;
        let grant = access.capture_lifecycle(
            &principal,
            registration,
            a::LifecycleCapability::ConfigureSource,
        )?;
        let source = serde_json::to_value(registration)?;
        access.with_lifecycle_authorization::<Failure>(
            &principal,
            &grant,
            registration,
            a::LifecycleCapability::ConfigureSource,
            |guard| {
                let authorization = FixtureSourceAuthorization {
                    guard,
                    principal: &principal,
                    grant: &grant,
                    registration,
                    source: source.clone(),
                    scope: scope.clone(),
                };
                let written = store.register_source_with_authorization(
                    &authorization,
                    &principal,
                    &serde_json::from_value(source.clone())?,
                )?;
                assert_eq!(serde_json::to_value(written)?, source);
                Ok(())
            },
        )?;
        access.install_source_authorized(&principal, &grant, registration)?;
        Ok(())
    }
    struct Fixture {
        _temp: tempfile::TempDir,
        _lease: persistent::ServerLease,
        access: app::Access,
        vault: Arc<media::AssetVault>,
        documents: s::geodata::GeodataOwners,
        authority: Arc<owner::occurrence_authority::OccurrenceAuthority>,
        scene: Arc<crate::config::atlas_scene::ServerAtlasSceneSelection>,
        overview: Arc<crate::config::model_overview::ServerModelOverviewSelection>,
        path: PathBuf,
        scope: Scope,
        cookie: String,
        csrf: String,
        password_account: bool,
        initial_evidence: Value,
        selector: Value,
    }
    impl Fixture {
        async fn generate() -> std::result::Result<Self, Failure> {
            Self::generate_configured(false, None, None).await
        }
        async fn generate_with_password_account(
            password_account: bool,
        ) -> std::result::Result<Self, Failure> {
            Self::generate_configured(password_account, None, None).await
        }
        async fn generate_configured(
            password_account: bool,
            registration: Option<a::SourceRegistration>,
            mapping_source: Option<Value>,
        ) -> std::result::Result<Self, Failure> {
            Self::generate_configured_choices(password_account, registration, mapping_source, None)
                .await
        }
        async fn generate_configured_choices(
            password_account: bool,
            registration: Option<a::SourceRegistration>,
            mapping_source: Option<Value>,
            choice_source: Option<Value>,
        ) -> std::result::Result<Self, Failure> {
            let temp = tempfile::Builder::new()
                .permissions(fs::Permissions::from_mode(0o700))
                .tempdir()?;
            let root = fs::canonicalize(temp.path())?;
            let authentication = if password_account {
                json!({"mode":"password"})
            } else {
                json!({"mode":"loopback-local","identity":{"userId":id(4),"actorId":id(5),"username":"synthetic-local","scope":{"workspaceId":id(2),"homeId":id(3)}}})
            };
            let config: ServerConfig = serde_json::from_value(
                json!({"schemaVersion":1,"deploymentId":id(1),"dataDirectory":root.join("data"),"logDirectory":root.join("data/logs"),
                "frontendDirectory":root.join("frontend"),"tlsCertificate":root.join("unused-cert.pem"),"tlsPrivateKey":root.join("unused-key.pem"),"listen":"127.0.0.1:48743","origin":ORIGIN,
                "homes":[{"workspaceId":id(2),"homeId":id(3),"label":"Generated measurement home"}],"mcpCommands":"read-only",
                "authentication":authentication}),
            )?;
            let password = "generated-measurement-viewer-password";
            if password_account {
                let provisioning = root.join("provisioning.json");
                private(
                    &provisioning,
                    &serde_json::to_vec(
                        &json!({"schemaVersion":1,"users":[{"userId":id(4),"actorId":id(5),
                        "username":"synthetic-local","password":password,
                        "memberships":[{"workspaceId":id(2),"homeId":id(3),"role":"editor"}]}]}),
                    )?,
                )?;
                persistent::initialize(&config, &provisioning)?;
            } else {
                persistent::initialize_without_password(&config)?;
            }
            let (core, lease) = persistent::reopen(&config)?;
            if let Some(registration) = &registration {
                let rule = a::LifecycleRule::new(
                    serde_json::from_value(json!(id(4)))?,
                    serde_json::from_value(json!(id(5)))?,
                    registration.clone(),
                    a::LifecycleCapability::ConfigureSource,
                    a::Action::Mutate,
                )?;
                let policy = a::LifecyclePolicy::from_trusted_configuration(vec![rule]);
                // Before any session or retained principal exists, install the
                // finite startup rule in the SAME Core Access Arc/Store adapter.
                *core.access.lock().map_err(|_| "Access poisoned")? =
                    a::AccessBoundary::open_existing(
                        config.data_directory.join("access.sqlite"),
                        config.access_config()?.with_lifecycle_policy(policy),
                    )?;
            }
            let host = Host::new(core, ORIGIN.into(), Arc::new(BTreeMap::new()), vec![])?;
            let host = if password_account {
                host
            } else {
                host.with_loopback_local()?
            };
            let core = host.core.clone();
            let app = router(host);
            let (login_path, login_body) = if password_account {
                (
                    "/api/atlas/auth/login",
                    json!({"username":"synthetic-local","password":password}),
                )
            } else {
                ("/api/atlas/auth/local", json!({}))
            };
            let login = app
                .clone()
                .oneshot(request("POST", login_path, login_body, None, None))
                .await?;
            assert_eq!(login.status(), StatusCode::OK);
            let cookie = login.headers()["set-cookie"]
                .to_str()?
                .split(';')
                .next()
                .ok_or("cookie")?
                .to_owned();
            let login: Value = serde_json::from_slice(&to_bytes(login.into_body(), 4096).await?)?;
            let csrf = login["csrfToken"].as_str().ok_or("csrf")?.to_owned();
            if let Some(registration) = &registration {
                configure_fixture_source(&core, registration, &cookie, &csrf)?;
            }
            let scope = Scope {
                workspace_id: id(2),
                home_id: id(3),
            };
            let directory = root.join("publication");
            fs::create_dir(&directory)?;
            fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
            let (glb, manifest, companion) =
                owner::occurrence_authority::generated_publication::generate(
                    serde_json::to_value(&scope)?,
                    id(6),
                );
            for (name, bytes) in [
                ("overview.glb", glb),
                ("publication.json", manifest.clone()),
                ("atlas-scene.json", companion.clone()),
            ] {
                private(&directory.join(name), &bytes)?;
            }
            let overview = Arc::new(
                crate::config::model_overview::ServerModelOverviewSelection::read_pinned(
                    &directory.join("publication.json"),
                    &media::types::sha256(&manifest),
                )?,
            );
            let scene = Arc::new(
                crate::config::atlas_scene::ServerAtlasSceneSelection::read_pinned(
                    &directory.join("atlas-scene.json"),
                    &media::types::sha256(&companion),
                    &overview,
                )?,
            );
            let occurrence = &scene.value["occurrences"][0];
            let feature = json!({"domain":"houseatlas.measurement-occurrence-feature/1","scope":scope,"publicationId":id(6),"sourceSha256":scene.value["sourceSha256"],
                "artifactSha256":overview.manifest.original.sha256,"occurrence":occurrence,"sourceObjectIds":["owner:generated-semantic-room"]});
            let target = json!({"buildingId":occurrence["buildingId"],"roomId":occurrence["roomId"],"levelId":occurrence["levelId"],"occurrenceId":occurrence["spaceOccurrenceId"],
                "publicationId":id(6),"sourceRevisionId":scene.value["sourceRevisionId"],"sourceSha256":scene.value["sourceSha256"],"semanticsSha256":scene.semantics_sha256,
                "overviewManifestSha256":overview.manifest_sha256,"artifactId":"model","artifactSha256":overview.manifest.original.sha256,"artifactBytes":overview.manifest.original.bytes,
                "targetFeatureSha256":wire::digest(&feature)?,"sourceObjectIds":["owner:generated-semantic-room"]});
            let mut evidence = evidence_payload();
            if let Some(source) = mapping_source {
                evidence["provenance"]["source"] = source;
            }
            let identity = json!({"kind":"location","evidenceIds":[id(100)]});
            let semantics = json!({"atlasId":id(101),"semanticKind":"room","reviewStatus":"accepted","evidenceIds":[id(100)]});
            let mut methods=["guessed","estimated","directly-measured","photo-fitted","derived","imported"].iter().map(|method|{
                if *method=="estimated"{json!({"method":method,"status":"available","reason":null,"acquisition":{"kind":"unqualified"},
                    "support":{"corroboration":"not-established","uncertainties":[{"status":"inferred","explanation":"Generated estimate; no physical verification"}],"limitations":["estimated"]},"inputs":[],"operations":[]})}
                else{json!({"method":method,"status":"unavailable","reason":"Generated fixture has no native method qualification","acquisition":null,"support":null,"inputs":[],"operations":[]})}
            }).collect::<Vec<_>>();
            let mut extra_evidence = None;
            let mut choices = Vec::new();
            if let Some(source) = choice_source {
                let mut payload = evidence_payload();
                payload["provenance"]["source"] = source;
                let pin = native_pin("evidence", 104, &payload);
                let reference = json!({"record":pin["record"],"expectedRevision":pin["revision"],
                    "expectedPayloadSha256":pin["payloadSha256"]});
                choices.push(json!({"role":"supports","reference":reference}));
                let estimated = methods
                    .iter_mut()
                    .find(|method| method["method"] == "estimated")
                    .ok_or("estimated method")?;
                estimated["inputs"] = json!([{"expectation":{"kind":"native","reference":reference},
                    "provenance":{"pin":{"kind":"native","native":pin},"methods":["estimated"],"support":estimated["support"]}}]);
                extra_evidence = Some(payload);
            }
            let export = serde_json::to_vec(
                &json!({"profile":"houseatlas.private-measurement-semantic-export.v1","scope":scope,"target":target,
                "roomIdentity":native_pin("identity",101,&identity),"roomSemantics":native_pin("location-semantics",102,&semantics),"mappingReview":native_pin("evidence",100,&evidence),
                "reviewReceipt":{"actorId":id(5),"mutationId":id(1100)},"methods":methods,"evidence":choices}),
            )?;
            let export_sha = media::types::sha256(&export);
            let initial_evidence = evidence.clone();
            let mut commands=[("evidence",100,evidence,id(1100),format!("Reviewed measurement occurrence export sha256:{export_sha}")),
                ("identity",101,identity,id(1101),"Generated native room".into()),("location-semantics",102,semantics,id(1102),"Generated accepted room semantics".into())]
                .into_iter().enumerate().map(|(i,(kind,n,payload,mutation,reason))|json!({"schemaVersion":3,"commandId":format!("atlas.{kind}.create"),"requestId":id(1200+i as u64),"context":scope,
                    "target":{"authority":"atlas","recordType":kind,"recordId":id(n)},"payload":payload,"idempotencyKey":mutation,"reason":reason,"approvalReceiptId":null,"preconditions":{"target":null,"guards":[]}})).collect::<Vec<_>>();
            if let Some(payload) = extra_evidence {
                // The optional record belongs to no target-admission pin. Its
                // exact payload is bound by the reviewed export before CREATE.
                commands.push(json!({"schemaVersion":3,"commandId":"atlas.evidence.create","requestId":id(1203),"context":scope,
                    "target":{"authority":"atlas","recordType":"evidence","recordId":id(104)},"payload":payload,
                    "idempotencyKey":id(1103),"reason":"Generated optional source evidence","approvalReceiptId":null,
                    "preconditions":{"target":null,"guards":[]}}));
            }
            let native = json!({"schemaVersion":3,"commandId":"atlas.batch.execute","requestId":id(1300),"context":scope,"target":{"authority":"atlas","kind":"batch","batchId":id(1301)},
                "payload":{"commands":commands},"idempotencyKey":id(1302),"reason":"Generated native mapping source","approvalReceiptId":null,"preconditions":{"target":null,"guards":[]}});
            let (status, result) = exchange(
                &app,
                "POST",
                &format!(
                    "/api/atlas/stock/v3/workspaces/{}/homes/{}/commands",
                    id(2),
                    id(3)
                ),
                native,
                &cookie,
                &csrf,
            )
            .await?;
            assert_eq!(status, StatusCode::OK, "{result}");
            drop(app);
            let core = Arc::try_unwrap(core)
                .map_err(|_| "fixture Core still borrowed")?
                .into_inner()
                .map_err(|_| "fixture Core poisoned")?;
            let access = core.access.clone();
            let original_vault = core.vault.clone();
            Arc::try_unwrap(core.store)
                .map_err(|_| "fixture Store still borrowed")?
                .into_inner()
                .map_err(|_| "fixture Store poisoned")?
                .close()?;
            let predecessor = root.join("data/atlas.sqlite");
            let closed = Connection::open(&predecessor)?;
            closed.pragma_update(None, "journal_mode", "DELETE")?;
            closed.close().map_err(|(_, e)| e)?;
            // The ONLY conversion here is the existing explicit synthetic v5
            // COPY owner, with real ancestry. No startup migration or fabricated
            // conversion receipt, record, audit or native authority is inserted.
            let policy = Arc::new(
                s::geodata_policy::PinnedGeodataSourcePolicy::decode_reviewed(
                    &serde_json::to_vec(
                        &json!({"profile":"houseatlas.reviewed-document-source-policy.v1","scope":scope,
                "sourceManifestSha256":"ab".repeat(32),"documents":[{"documentId":id(1400),"original":{"assetId":id(1401),"revision":1,"sha256":"cd".repeat(32),"bytes":2},"contentType":"application/json",
                    "provenance":{"agency":"Generated unused source policy","url":"https://source.invalid/generated","license":{"status":"permitted","reference":"CC0-1.0"},"retrievedAt":"2026-10-24T00:00:00Z","published":null,"observed":null,"frame":{"crs":null,"axes":[],"linearUnit":null,"extent":null}}}]}),
                    )?,
                )?,
            );
            let source_documents =
                s::geodata::GeodataOwners::new(access.clone(), original_vault, policy.clone());
            let queues = backup::QueueFreeNativeOwners::for_queue_free_profile()?;
            let stock = crate::domain::stock::NativeStockContract::new()?;
            let peers = s::RecoveryValidationPeers {
                stock: &stock,
                queues: &[],
                discovery: &queues,
                evidence: &queues,
            };
            let converted = root.join("measurement-image");
            s::geodata_full::copy_v5_to_full(
                &predecessor,
                &converted,
                &media::types::sha256(&fs::read(&predecessor)?),
                &NativeContracts,
                &peers,
                &source_documents,
                &mut || Ok(()),
            )?;
            let vault = Arc::new(media::AssetVault::open_existing(&converted.join("media"))?);
            let documents = s::geodata::GeodataOwners::new(access.clone(), vault.clone(), policy);
            let full = app::Store::open_existing_geodata_full(
                &converted.join("atlas.sqlite"),
                NativeContracts,
                app::ReadAuthority(access.clone()),
                media::native::NativeMediaRuntime {
                    vault: vault.clone(),
                    server: app::ServerRuntime,
                },
                s::StoreOptions::default(),
                documents.clone(),
                &peers,
                &mut || Ok(()),
            )?;
            let observed = a::RequestEvidence {
                method: a::Method::Get,
                url: "https://127.0.0.1:48743/generated-review",
                origin: Some(ORIGIN),
                sec_fetch_site: Some("same-origin"),
                referer: None,
                cookie: Some(&cookie),
                authorization: None,
                csrf: None,
            };
            let native_scope = app::access_scope(&crate::domain::Scope {
                workspace_id: id(2),
                home_id: id(3),
            })?;
            let mut boundary = access.lock().map_err(|_| "fixture Access poisoned")?;
            let p = app::RequestPrincipal::new(boundary.authorize(
                &observed,
                &native_scope,
                a::Action::Read,
            )?);
            p.capture_sources(
                &boundary,
                &owner::source_closure(&facts(&full.db, &scope)?)?,
            )?;
            p.seal_source_capture();
            let mut authority = None;
            boundary.with_read_authorization::<s::Error>(p.principal.principal(), |guard| {
                authority = Some(full.retain_measurement_occurrence_review(
                    MeasurementOccurrenceReviewInput {
                        p: &p,
                        guard,
                        scope: &scope,
                        access: &access,
                        vault: &vault,
                        scene: scene.clone(),
                        overview: overview.clone(),
                        bytes: &export,
                        sha256: &export_sha,
                    },
                )?);
                Ok(())
            })?;
            drop(boundary);
            let authority = authority.ok_or("missing retained original review")?;
            full.close()?;
            let path = converted.join("atlas.sqlite");
            // Fresh synthetic target ONLY. Install the exact new facet after an
            // actual predecessor COPY; production has no installer/upgrade path.
            let db = Connection::open_with_flags(
                &path,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE
                    | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW,
            )?;
            let tx = db.unchecked_transaction()?;
            tx.execute_batch(profile::INPUTS[6].1)?;
            tx.execute(
                "INSERT INTO atlas_measurement_migrations VALUES(1,?1)",
                params![media::types::sha256(profile::INPUTS[6].1.as_bytes())],
            )?;
            tx.execute(
                "INSERT INTO atlas_measurement_metadata VALUES('catalogSha256',?1)",
                params![profile::measurement_catalog_pin()?],
            )?;
            tx.commit()?;
            db.pragma_update(None, "journal_mode", "WAL")?;
            db.close().map_err(|(_, e)| e)?;
            let mut selector = json!({});
            let mut t = target.clone();
            t["selectionRevision"] = json!(scene.revision);
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
            Ok(Self {
                _temp: temp,
                _lease: lease,
                access,
                vault,
                documents,
                authority,
                scene,
                overview,
                path,
                scope,
                cookie,
                csrf,
                password_account,
                initial_evidence,
                selector,
            })
        }
        fn open(&self) -> std::result::Result<(app::Store, MeasurementBinding), Failure> {
            let queues = backup::QueueFreeNativeOwners::for_queue_free_profile()?;
            let stock = crate::domain::stock::NativeStockContract::new()?;
            let peers = s::RecoveryValidationPeers {
                stock: &stock,
                queues: &[],
                discovery: &queues,
                evidence: &queues,
            };
            Ok(app::Store::open_existing_measurements(
                s::MeasurementOpenInput {
                    path: &self.path,
                    selection: profile::MeasurementProfileSelection::MeasurementsV1,
                    contract: NativeContracts,
                    authorization: app::ReadAuthority(self.access.clone()),
                    runtime: media::native::NativeMediaRuntime {
                        vault: self.vault.clone(),
                        server: app::ServerRuntime,
                    },
                    options: s::StoreOptions::default(),
                    documents: self.documents.clone(),
                    owners: owner::MeasurementOwners::new(
                        self.access.clone(),
                        self.vault.clone(),
                        self.authority.clone(),
                    ),
                    peers: &peers,
                    evidence: self.authority.as_ref(),
                    check: &mut || Ok(()),
                },
            )?)
        }
        fn host(
            &self,
            store: app::Store,
            binding: MeasurementBinding,
        ) -> std::result::Result<Host, Failure> {
            let home = crate::domain::HomeSummary {
                scope: crate::domain::Scope {
                    workspace_id: id(2),
                    home_id: id(3),
                },
                label: "Generated measurement home".into(),
            };
            let core = app::Core {
                access: self.access.clone(),
                store: Arc::new(Mutex::new(store)),
                atlas_list_pages: Default::default(),
                media_policy_evidence: Mutex::default(),
                vault: self.vault.clone(),
                home: home.clone(),
                homes: vec![home],
            };
            let host = Host::new(core, ORIGIN.into(), Arc::new(BTreeMap::new()), vec![])?;
            let host = if self.password_account {
                host
            } else {
                host.with_loopback_local()?
            };
            Ok(host.with_measurements(binding)?)
        }
        fn prefix(&self) -> String {
            format!(
                "/api/atlas/measurements/v1/workspaces/{}/homes/{}",
                id(2),
                id(3)
            )
        }
        fn context(&self) -> Value {
            json!({"profile":"houseatlas.measurement-occurrence-context-request.v1","scope":self.scope,"selector":self.selector})
        }
    }

    impl app::Store {
        /// Genuine generator bridge, no production issuer or native policy bypass.
        pub(crate) async fn generated_measurement_startup_fixture() -> std::result::Result<
            crate::lifecycle::persistent::measurements::test_support::GeneratedImage,
            Failure,
        > {
            Self::generated_measurement_startup_fixture_case(
                crate::lifecycle::persistent::measurements::test_support::GeneratedCase::Single,
            )
            .await
        }
        pub(crate) async fn generated_measurement_startup_fixture_case(
            case: crate::lifecycle::persistent::measurements::test_support::GeneratedCase,
        ) -> std::result::Result<
            crate::lifecycle::persistent::measurements::test_support::GeneratedImage,
            Failure,
        > {
            use crate::lifecycle::persistent::measurements::test_support::{
                GeneratedCase, GeneratedImage, GeneratedInput, generated_document_policy,
            };
            let two_parts = matches!(&case, GeneratedCase::TwoParts);
            let withhold = matches!(&case, GeneratedCase::TwoPublications { withhold_old: true });
            let f = match &case {
                GeneratedCase::TwoPublications { .. } => historical_fixture(false).await?.0,
                _ => Fixture::generate().await?,
            };
            let extra = if two_parts {
                let (store, binding) = f.open()?;
                let host = f.host(store, binding)?;
                let core = host.core.clone();
                let app = router(host);
                let exports = retain_two_part_exports(&f, &app).await?;
                drop(app);
                close_fixture_core(core)?;
                exports
            } else {
                vec![f.authority.configured_fixture_export()?]
            };
            let mut inputs = extra
                .into_iter()
                .map(|export| GeneratedInput {
                    export,
                    retained: false,
                    overview_path: PathBuf::new(),
                    overview_sha256: String::new(),
                    scene_path: PathBuf::new(),
                    scene_sha256: String::new(),
                })
                .collect::<Vec<_>>();
            for export in f.authority.configured_fixture_retained_exports()? {
                let doc: Value = serde_json::from_slice(&export)?;
                inputs.push(GeneratedInput {
                    export,
                    retained: true,
                    overview_path: f._temp.path().join("publication/publication.json"),
                    overview_sha256: repo::text(&doc["target"], "overviewManifestSha256")?.into(),
                    scene_path: f._temp.path().join("publication/atlas-scene.json"),
                    scene_sha256: repo::text(&doc["target"], "semanticsSha256")?.into(),
                });
            }
            if withhold {
                fs::rename(
                    f._temp.path().join("publication"),
                    f._temp.path().join("withheld-configured-publication"),
                )?;
            }
            let Fixture {
                _temp,
                _lease,
                access,
                vault,
                documents,
                authority,
                scene,
                overview,
                path: _,
                scope,
                cookie,
                csrf,
                password_account: _,
                initial_evidence: _,
                selector,
            } = f;
            let policy = generated_document_policy(&scope)?;
            drop(documents);
            drop(authority);
            drop(vault);
            drop(
                Arc::try_unwrap(access)
                    .map_err(|_| "Generated Access still borrowed")?
                    .into_inner()
                    .map_err(|_| "Generated Access poisoned")?,
            );
            drop(_lease);
            GeneratedImage::from_closed_generated_parts(
                _temp, scene, overview, inputs, selector, cookie, csrf, policy,
            )
        }
    }
    #[tokio::test]
    async fn authenticated_exact_entry_context_history_wal_reopen_and_fresh_recovery()
    -> std::result::Result<(), Failure> {
        let f = Fixture::generate().await?;
        let (store, binding) = f.open()?;
        let host = f.host(store, binding.clone())?;
        let core = host.core.clone();
        let app = router(host);
        let (status, context) = exchange(
            &app,
            "POST",
            &format!("{}/occurrence-context", f.prefix()),
            f.context(),
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK, "{context}");
        assert_eq!(context["claims"], json!([]));
        assert_eq!(context["coverage"]["retainedHomeVersions"], 0);
        let proposal = json!({"domain":"houseatlas.measurement-assertions.online-proposal/1","scope":f.scope,"mutationId":id(1500),"operation":{"kind":"create"},"target":context["target"],"property":"occurrence-area",
            "area":{"decimalToken":"0012.5000","unit":"m2","quantityKind":"area","method":"estimated","evidence":[],"inputs":[],"operation":null,"contradicts":[]},"reason":"Generated explicitly entered area"});
        let (status, created) = exchange(
            &app,
            "POST",
            &format!("{}/occurrence-area", f.prefix()),
            proposal.clone(),
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK, "{created}");
        let first = created["receipt"].clone();
        let pin = &first["committed"]["assertion"]["version"];
        let id = pin["assertionId"].as_str().ok_or("assertion ID")?;
        assert_eq!(
            first["committed"]["assertion"]["value"]["decimalToken"],
            "0012.5000"
        );
        assert_eq!(first["committed"]["pending"]["assertion"], *pin);
        let mut corrected = proposal.clone();
        corrected["mutationId"] = json!(super::integration_tests::id(1501));
        corrected["operation"] = json!({"kind":"correct","assertionId":id,"expectedRevision":pin["revision"],"expectedPayloadSha256":pin["payloadSha256"]});
        corrected["area"]["decimalToken"] = json!("13.2500");
        let (status, changed) = exchange(
            &app,
            "POST",
            &format!("{}/occurrence-area/{id}/corrections", f.prefix()),
            corrected,
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK, "{changed}");
        let (status, current) = exchange(
            &app,
            "GET",
            &format!("{}/occurrence-area/{id}", f.prefix()),
            Value::Null,
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(current["head"], changed["receipt"]);
        let (status, history) = exchange(
            &app,
            "GET",
            &format!("{}/occurrence-area/{id}/history", f.prefix()),
            Value::Null,
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(history["versions"][0], first);
        assert_eq!(history["versions"][1], changed["receipt"]);
        let (status, outcome) = exchange(
            &app,
            "GET",
            &format!(
                "{}/mutation-outcomes/{}",
                f.prefix(),
                super::integration_tests::id(1500)
            ),
            Value::Null,
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(outcome["result"]["receipt"], first);
        assert_eq!(outcome["result"]["receiptSha256"], created["receiptSha256"]);
        let (status, context) = exchange(
            &app,
            "POST",
            &format!("{}/occurrence-context", f.prefix()),
            f.context(),
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            context["committedMutations"]
                .as_array()
                .ok_or("mutation identities")?
                .len(),
            2
        );
        // Read markers are cut-specific; compare exact head + projected facts,
        // not the marker of a separately executed earlier current GET.
        assert_eq!(context["claims"][0]["head"], current["head"]);
        assert_eq!(
            context["claims"][0]["currentValueReview"]["readPoint"],
            context["readPoint"]
        );
        assert_eq!(
            context["claims"][0]["currentConflicts"]["readPoint"],
            context["readPoint"]
        );
        drop(app);
        let core = Arc::try_unwrap(core)
            .map_err(|_| "Core retained")?
            .into_inner()
            .map_err(|_| "Core poisoned")?;
        Arc::try_unwrap(core.store)
            .map_err(|_| "Store retained")?
            .into_inner()
            .map_err(|_| "Store poisoned")?
            .close()?;
        let (reopened, binding) = f.open()?;
        assert!(reopened.measurement_binding_matches(&binding));
        let queues = backup::QueueFreeNativeOwners::for_queue_free_profile()?;
        let stock = crate::domain::stock::NativeStockContract::new()?;
        let peers = s::RecoveryValidationPeers {
            stock: &stock,
            queues: &[],
            discovery: &queues,
            evidence: &queues,
        };
        let bundle = f.path.parent().ok_or("parent")?.join("capture");
        let report = reopened.capture_measurements(
            &bundle,
            &binding,
            &peers,
            f.authority.as_ref(),
            &mut || Ok(()),
        )?;
        let destination = f.path.parent().ok_or("parent")?.join("fresh-restore");
        let access = f.access.clone();
        let authority = f.authority.clone();
        let (restored, _binding, _report) =
            app::Store::restore_measurements(s::MeasurementRestoreInput {
                bundle: &bundle,
                destination: &destination,
                trusted_manifest_sha256: &report.manifest_sha256,
                selection: profile::MeasurementProfileSelection::MeasurementsV1,
                contract: NativeContracts,
                authorization: app::ReadAuthority(f.access.clone()),
                options: s::StoreOptions::default(),
                documents: f.documents.clone(),
                owners_factory: move |vault: Arc<crate::media::AssetVault>| {
                    Ok((
                        media::native::NativeMediaRuntime {
                            vault: vault.clone(),
                            server: app::ServerRuntime,
                        },
                        owner::MeasurementOwners::new(access, vault, authority),
                    ))
                },
                peers: &peers,
                evidence: f.authority.as_ref(),
                check: &mut || Ok(()),
            })?;
        let rows = repo::complete_home(&restored.db, &f.scope)?;
        assert_eq!(rows[0].body, first);
        assert_eq!(rows[1].body, changed["receipt"]);
        assert_eq!(
            rows[0].body["committed"]["pending"],
            first["committed"]["pending"]
        );
        restored.close()?;
        reopened.close()?;
        Ok(())
    }
    #[tokio::test]
    async fn context_stale_selection_is_closed_refusal_without_measurement_writes()
    -> std::result::Result<(), Failure> {
        let f = Fixture::generate().await?;
        let (store, binding) = f.open()?;
        let host = f.host(store, binding)?;
        let core = host.core.clone();
        let app = router(host);
        let mut request = f.context();
        request["selector"]["selectionRevision"] = json!("ef".repeat(32));
        let (status, result) = exchange(
            &app,
            "POST",
            &format!("{}/occurrence-context", f.prefix()),
            request,
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(result["code"], "stale-selection");
        assert!(result.get("claims").is_none());
        let core = core.lock().map_err(|_| "Core poisoned")?;
        let store = core.store.lock().map_err(|_| "Store poisoned")?;
        for table in [
            "measurement_heads",
            "measurement_mutation_receipts",
            "measurement_audits",
        ] {
            assert_eq!(
                store
                    .db
                    .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r
                        .get::<_, i64>(0))?,
                0
            );
        }
        Ok(())
    }
    #[tokio::test]
    async fn context_post_accepts_viewer_read_without_mutation_authority()
    -> std::result::Result<(), Failure> {
        // Loopback-local deliberately requires its sole account to be Editor.
        // Password authentication permits the real current Viewer membership.
        let f = Fixture::generate_with_password_account(true).await?;
        let (store, binding) = f.open()?;
        let host = f.host(store, binding)?;
        let app = router(host);
        let scope = app::access_scope(&crate::domain::Scope {
            workspace_id: id(2),
            home_id: id(3),
        })?;
        f.access
            .lock()
            .map_err(|_| "Access poisoned")?
            .set_membership(
                &a::CanonicalId::parse(id(4))?,
                &scope,
                a::Role::Viewer,
                true,
            )?;
        let (status, context) = exchange(
            &app,
            "POST",
            &format!("{}/occurrence-context", f.prefix()),
            f.context(),
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK, "{context}");
        assert_eq!(
            context["profile"],
            "houseatlas.measurement-occurrence-context.v1"
        );
        let p = json!({"domain":"houseatlas.measurement-assertions.online-proposal/1","scope":f.scope,"mutationId":id(1502),"operation":{"kind":"create"},"target":context["target"],"property":"occurrence-area",
            "area":{"decimalToken":"12.5","unit":"m2","quantityKind":"area","method":"estimated","evidence":[],"inputs":[],"operation":null,"contradicts":[]},"reason":"Generated viewer cannot mutate"});
        let (status, _) = exchange(
            &app,
            "POST",
            &format!("{}/occurrence-area", f.prefix()),
            p,
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::FORBIDDEN);
        Ok(())
    }
    #[tokio::test]
    async fn context_post_requires_current_csrf_and_preserves_native_error()
    -> std::result::Result<(), Failure> {
        let f = Fixture::generate().await?;
        let (store, binding) = f.open()?;
        let app = router(f.host(store, binding)?);
        let response = app
            .oneshot(request(
                "POST",
                &format!("{}/occurrence-context", f.prefix()),
                f.context(),
                Some(&f.cookie),
                None,
            ))
            .await?;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let body: Value = serde_json::from_slice(&to_bytes(response.into_body(), 4096).await?)?;
        assert_eq!(body["code"], "forbidden");
        assert!(body.get("claims").is_none());
        Ok(())
    }
    #[tokio::test]
    async fn unavailable_method_never_becomes_direct_measurement_or_allocates_claim()
    -> std::result::Result<(), Failure> {
        let f = Fixture::generate().await?;
        let (store, binding) = f.open()?;
        let host = f.host(store, binding)?;
        let core = host.core.clone();
        let app = router(host);
        let (_, context) = exchange(
            &app,
            "POST",
            &format!("{}/occurrence-context", f.prefix()),
            f.context(),
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(context["methods"][2]["status"], "unavailable");
        let p = json!({"domain":"houseatlas.measurement-assertions.online-proposal/1","scope":f.scope,"mutationId":id(1503),"operation":{"kind":"create"},"target":context["target"],"property":"occurrence-area",
            "area":{"decimalToken":"12.5","unit":"m2","quantityKind":"area","method":"directly-measured","evidence":[],"inputs":[],"operation":null,"contradicts":[]},"reason":"Generated unsupported method refusal"});
        let (status, _) = exchange(
            &app,
            "POST",
            &format!("{}/occurrence-area", f.prefix()),
            p,
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        let core = core.lock().map_err(|_| "Core poisoned")?;
        let store = core.store.lock().map_err(|_| "Store poisoned")?;
        assert!(repo::complete_home(&store.db, &f.scope)?.is_empty());
        Ok(())
    }

    // FROZEN / UNREGISTERED / UNEXECUTED.
    // Additive frozen source in storage/measurement_assertions.rs integration_tests.
    // Uses the EXISTING genuine Fixture::generate, actual native auth/Store/HTTP,
    // six-method private export and real target mapping receipts, with no native
    // personal-measurement Evidence/certificate and no fake authority adapter.
    #[tokio::test]
    async fn personal_measurement_authenticated_attribution_and_pending_without_evidence()
    -> std::result::Result<(), Failure> {
        let f = Fixture::generate().await?;
        let (store, binding) = f.open()?;
        let host = f.host(store, binding)?;
        let core = host.core.clone();
        let app = router(host);
        let before = {
            let c = core.lock().map_err(|_| "Core poisoned")?;
            let s = c.store.lock().map_err(|_| "Store poisoned")?;
            s.db.query_row(
                "SELECT COUNT(*) FROM records WHERE record_type='evidence'",
                [],
                |r| r.get::<_, i64>(0),
            )?
        };
        let (status, context) = exchange(
            &app,
            "POST",
            &format!("{}/occurrence-context", f.prefix()),
            f.context(),
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(context["writeEligibility"]["advisory"], true);
        assert_eq!(context["writeEligibility"]["status"], "eligible");
        assert!(
            context["methods"]
                .as_array()
                .ok_or("methods")?
                .iter()
                .any(|m| m["method"] == "user-reported-measured" && m["status"] == "available")
        );
        let proposal = json!({"domain":"houseatlas.measurement-assertions.online-proposal/1","scope":f.scope,"mutationId":id(1600),"operation":{"kind":"create"},"target":context["target"],"property":"occurrence-area",
        "area":{"decimalToken":"0012.5000","unit":"m2","quantityKind":"area","method":"user-reported-measured","attestation":{"kind":"personally-measured"},"evidence":[],"inputs":[],"operation":null,"contradicts":[]},
        "reason":"Record user-reported measurement"});
        let (status, saved) = exchange(
            &app,
            "POST",
            &format!("{}/occurrence-area", f.prefix()),
            proposal.clone(),
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK, "{saved}");
        let first = saved["receipt"].clone();
        let c = &first["committed"];
        assert_eq!(
            c["proposal"]["area"]["attestation"]["kind"],
            "personally-measured"
        );
        assert_eq!(c["acquisition"]["kind"], "user-reported-measurement");
        assert_eq!(c["acquisition"]["actorId"], c["receiptKey"]["actorId"]);
        assert_eq!(c["acquisition"]["actorId"], id(5));
        assert_eq!(
            c["acquisition"]["recordedAt"],
            c["audit"]["serverRecordedAt"]
        );
        assert_eq!(c["acquisition"]["recordedAt"], first["audit"]["at"]);
        assert!(
            c["acquisition"].get("measuredAt").is_none()
                && c["acquisition"].get("review").is_none()
        );
        assert_eq!(c["assertion"]["evidence"], json!([]));
        assert_eq!(
            c["assertion"]["support"],
            json!({"corroboration":"not-established","uncertainties":[{"status":"unknown","explanation":null}],"limitations":["user-reported-measurement"]})
        );
        assert_eq!(c["pending"]["assertion"], c["assertion"]["version"]);
        assert_eq!(c["pending"]["model"], c["assertion"]["enteredAgainst"]);
        assert_eq!(
            c["pending"]["targetFeatureSha256"],
            c["assertion"]["targetFeatureSha256"]
        );
        assert_eq!(c["assertion"]["value"]["decimalToken"], "0012.5000");
        let pin = &c["assertion"]["version"];
        let assertion_id = pin["assertionId"].as_str().ok_or("assertion")?;
        let mut correction = proposal;
        correction["mutationId"] = json!(id(1601));
        correction["operation"] = json!({"kind":"correct","assertionId":assertion_id,"expectedRevision":pin["revision"],"expectedPayloadSha256":pin["payloadSha256"]});
        correction["area"]["decimalToken"] = json!("13.2500");
        correction["reason"] = json!("Correct user-reported measurement");
        // Explicit NEW attestation in this test action; never a loaded-row UI default.
        let (status, changed) = exchange(
            &app,
            "POST",
            &format!("{}/occurrence-area/{assertion_id}/corrections", f.prefix()),
            correction,
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK, "{changed}");
        let (status, history) = exchange(
            &app,
            "GET",
            &format!("{}/occurrence-area/{assertion_id}/history", f.prefix()),
            Value::Null,
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(history["versions"][0], first);
        assert_eq!(
            history["receiptDigests"][0]["receiptSha256"],
            saved["receiptSha256"]
        );
        assert_eq!(
            history["versions"][1]["committed"]["pending"]["assertion"],
            changed["receipt"]["committed"]["assertion"]["version"]
        );
        let after = {
            let c = core.lock().map_err(|_| "Core poisoned")?;
            let s = c.store.lock().map_err(|_| "Store poisoned")?;
            s.db.query_row(
                "SELECT COUNT(*) FROM records WHERE record_type='evidence'",
                [],
                |r| r.get::<_, i64>(0),
            )?
        };
        assert_eq!(before, after); // target review existed; personal entry minted NO Evidence.
        Ok(())
    }

    // Additive FROZEN/UNREGISTERED/UNEXECUTED fixture source. These helpers retain
    // original owner handles, real native review audits, actual authenticated HTTP
    // commits and complete same-Store bytes. They create no documentary authority.
    fn close_fixture_core(core: Arc<Mutex<app::Core>>) -> std::result::Result<(), Failure> {
        let c = Arc::try_unwrap(core)
            .map_err(|_| "Core retained")?
            .into_inner()
            .map_err(|_| "Core poisoned")?;
        Arc::try_unwrap(c.store)
            .map_err(|_| "Store retained")?
            .into_inner()
            .map_err(|_| "Store poisoned")?
            .close()?;
        Ok(())
    }
    fn personal_intent(f: &Fixture, target: &Value, mutation: u64, token: &str) -> Value {
        json!({"domain":"houseatlas.measurement-assertions.online-proposal/1","scope":f.scope,"mutationId":id(mutation),"operation":{"kind":"create"},"target":target,"property":"occurrence-area",
        "area":{"decimalToken":token,"unit":"m2","quantityKind":"area","method":"user-reported-measured","attestation":{"kind":"personally-measured"},"evidence":[],"inputs":[],"operation":null,"contradicts":[]},"reason":"Record user-reported measurement"})
    }
    async fn create_personal(
        f: &Fixture,
        app: &Router,
        mutation: u64,
        token: &str,
    ) -> std::result::Result<Value, Failure> {
        let (status, context) = exchange(
            app,
            "POST",
            &format!("{}/occurrence-context", f.prefix()),
            f.context(),
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK, "{context}");
        let (status, result) = exchange(
            app,
            "POST",
            &format!("{}/occurrence-area", f.prefix()),
            personal_intent(f, &context["target"], mutation, token),
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK, "{result}");
        Ok(result)
    }
    async fn retain_successor_publication(
        f: &mut Fixture,
        core: &Arc<Mutex<app::Core>>,
        app: &Router,
    ) -> std::result::Result<Arc<owner::occurrence_authority::OccurrenceAuthority>, Failure> {
        let directory = f._temp.path().join("publication-successor");
        fs::create_dir(&directory)?;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
        let (glb, manifest, companion) =
            owner::occurrence_authority::generated_publication::generate(
                serde_json::to_value(&f.scope)?,
                id(7),
            );
        for (name, bytes) in [
            ("overview.glb", glb),
            ("publication.json", manifest.clone()),
            ("atlas-scene.json", companion.clone()),
        ] {
            private(&directory.join(name), &bytes)?;
        }
        let overview = Arc::new(
            crate::config::model_overview::ServerModelOverviewSelection::read_pinned(
                &directory.join("publication.json"),
                &media::types::sha256(&manifest),
            )?,
        );
        let scene = Arc::new(
            crate::config::atlas_scene::ServerAtlasSceneSelection::read_pinned(
                &directory.join("atlas-scene.json"),
                &media::types::sha256(&companion),
                &overview,
            )?,
        );
        let occurrence = &scene.value["occurrences"][0];
        let feature = json!({"domain":"houseatlas.measurement-occurrence-feature/1","scope":f.scope,"publicationId":id(7),"sourceSha256":scene.value["sourceSha256"],
        "artifactSha256":overview.manifest.original.sha256,"occurrence":occurrence,"sourceObjectIds":["owner:generated-semantic-room"]});
        let target = json!({"buildingId":occurrence["buildingId"],"roomId":occurrence["roomId"],"levelId":occurrence["levelId"],"occurrenceId":occurrence["spaceOccurrenceId"],"publicationId":id(7),
        "sourceRevisionId":scene.value["sourceRevisionId"],"sourceSha256":scene.value["sourceSha256"],"semanticsSha256":scene.semantics_sha256,"overviewManifestSha256":overview.manifest_sha256,
        "artifactId":"model","artifactSha256":overview.manifest.original.sha256,"artifactBytes":overview.manifest.original.bytes,"targetFeatureSha256":wire::digest(&feature)?,"sourceObjectIds":["owner:generated-semantic-room"]});
        // Read the genuine current native prestate through this fixture's EXISTING
        // authenticated session. Both old and candidate references need CHILD
        // guards; the new same-batch Evidence103 alone is exempt from those guards.
        let expected_identity = json!({"kind":"location","evidenceIds":[id(100)]});
        let expected_semantics = json!({"atlasId":id(101),"semanticKind":"room","reviewStatus":"accepted","evidenceIds":[id(100)]});
        let mut native = Vec::<s::Record>::new();
        for (kind, n, payload) in [
            ("identity", 101, expected_identity),
            ("evidence", 100, f.initial_evidence.clone()),
            ("location-semantics", 102, expected_semantics),
        ] {
            let (status, body) = exchange(
                app,
                "GET",
                &format!(
                    "/api/atlas/v1/workspaces/{}/homes/{}/records/{kind}/{}",
                    f.scope.workspace_id,
                    f.scope.home_id,
                    id(n)
                ),
                Value::Null,
                &f.cookie,
                &f.csrf,
            )
            .await?;
            assert_eq!(status, StatusCode::OK, "{body}");
            let row: s::Record = serde_json::from_value(body)?;
            assert_eq!(row.scope(), f.scope);
            assert_eq!(row.record_type.as_str(), kind);
            assert_eq!(row.record_id, id(n));
            assert_eq!(row.lifecycle, s::Lifecycle::Active);
            assert_eq!(row.payload, payload);
            assert!((1..=s::MAX_REVISION).contains(&row.revision));
            native.push(row);
        }
        let identity = &native[0];
        let prior_evidence = &native[1];
        let prior_semantics = &native[2];
        let successor_revision = prior_semantics
            .revision
            .checked_add(1)
            .filter(|r| *r <= s::MAX_REVISION)
            .ok_or("Successor revision exceeds native bound")?;
        // Same genuine native room is deliberately ONLY an association candidate.
        // A new independent review must not inherit the old publication's
        // optional source provenance. The old immutable Evidence remains pinned.
        let evidence = evidence_payload();
        let mut semantics = prior_semantics.payload.clone();
        semantics["evidenceIds"]
            .as_array_mut()
            .ok_or("Native semantics evidenceIds missing")?
            .push(json!(id(103)));
        let identity_pin = json!({"record":identity.reference(),"revision":identity.revision,"payloadSha256":wire::digest(&identity.payload)?});
        let semantics_pin = json!({"record":prior_semantics.reference(),"revision":successor_revision,"payloadSha256":wire::digest(&semantics)?});
        let child_guards = json!([
            {"target":{"authority":"atlas","recordType":identity.record_type,"recordId":identity.record_id},"revision":{"kind":"atlas","value":identity.revision}},
            {"target":{"authority":"atlas","recordType":prior_evidence.record_type,"recordId":prior_evidence.record_id},"revision":{"kind":"atlas","value":prior_evidence.revision}}
        ]);
        let methods=["guessed","estimated","directly-measured","photo-fitted","derived","imported"].iter().map(|m|json!({"method":m,"status":"unavailable",
        "reason":"Generated successor has no external method qualification","acquisition":null,"support":null,"inputs":[],"operations":[]})).collect::<Vec<_>>();
        let export = serde_json::to_vec(
            &json!({"profile":"houseatlas.private-measurement-semantic-export.v1","scope":f.scope,"target":target,"roomIdentity":identity_pin,
        "roomSemantics":semantics_pin,"mappingReview":native_pin("evidence",103,&evidence),"reviewReceipt":{"actorId":id(5),"mutationId":id(2100)},"methods":methods,"evidence":[]}),
        )?;
        let sha = media::types::sha256(&export);
        // Evidence103 is a NEW Create (native initial revision1), not an existing
        // reference with a guessed revision. Keep its child entirely unguarded.
        let commands=[("evidence",103,evidence,"create",None,json!([]),id(2100),format!("Reviewed measurement occurrence export sha256:{sha}")),
        ("location-semantics",102,semantics,"replace",Some(prior_semantics.revision),child_guards,id(2101),"Generated separately reviewed successor semantics".into())].into_iter().enumerate().map(|(i,(kind,n,payload,verb,revision,guards,mutation,reason))|
        json!({"schemaVersion":3,"commandId":format!("atlas.{kind}.{verb}"),"requestId":id(2200+i as u64),"context":f.scope,"target":{"authority":"atlas","recordType":kind,"recordId":id(n)},"payload":payload,
            "idempotencyKey":mutation,"reason":reason,"approvalReceiptId":null,"preconditions":{"target":revision.map(|r|json!({"kind":"atlas","value":r})),"guards":guards}})).collect::<Vec<_>>();
        let command = json!({"schemaVersion":3,"commandId":"atlas.batch.execute","requestId":id(2300),"context":f.scope,"target":{"authority":"atlas","kind":"batch","batchId":id(2301)},
        "payload":{"commands":commands},"idempotencyKey":id(2302),"reason":"Generated native successor review","approvalReceiptId":null,"preconditions":{"target":null,"guards":[]}});
        let (status, result) = exchange(
            app,
            "POST",
            &format!(
                "/api/atlas/stock/v3/workspaces/{}/homes/{}/commands",
                id(2),
                id(3)
            ),
            command,
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK, "{result}");
        let core = core.lock().map_err(|_| "Core poisoned")?;
        let store = core.store.lock().map_err(|_| "Store poisoned")?;
        let mut access = f.access.lock().map_err(|_| "Access poisoned")?;
        let observed = a::RequestEvidence {
            method: a::Method::Get,
            url: "https://127.0.0.1:48743/generated-successor-review",
            origin: Some(ORIGIN),
            sec_fetch_site: Some("same-origin"),
            referer: None,
            cookie: Some(&f.cookie),
            authorization: None,
            csrf: None,
        };
        let scope = app::access_scope(&crate::domain::Scope {
            workspace_id: id(2),
            home_id: id(3),
        })?;
        let p = app::RequestPrincipal::new(access.authorize(&observed, &scope, a::Action::Read)?);
        p.capture_sources(
            &access,
            &owner::source_closure(&facts(&store.db, &f.scope)?)?,
        )?;
        p.seal_source_capture();
        let mut admitted = None;
        access.with_read_authorization::<s::Error>(p.principal.principal(), |guard| {
            admitted = Some(store.retain_measurement_occurrence_review(
                MeasurementOccurrenceReviewInput {
                    p: &p,
                    guard,
                    scope: &f.scope,
                    access: &f.access,
                    vault: &f.vault,
                    scene: scene.clone(),
                    overview: overview.clone(),
                    bytes: &export,
                    sha256: &sha,
                },
            )?);
            Ok(())
        })?;
        let authority = admitted.ok_or("review not retained")?;
        f.scene = scene;
        f.overview = overview;
        let mut selector = json!({});
        let mut t = target;
        t["selectionRevision"] = json!(f.scene.revision);
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
            selector[k] = t[k].clone();
        }
        f.selector = selector;
        Ok(authority)
    }
    // Genuine same-publication TWO PARTS of one native room. New real Evidence
    // reviews and one exact guarded LocationSemantics update share an atomic batch.
    async fn retain_two_part_exports(
        f: &Fixture,
        app: &Router,
    ) -> std::result::Result<Vec<Vec<u8>>, Failure> {
        let mut native = Vec::<s::Record>::new();
        for (kind, n) in [
            ("identity", 101),
            ("evidence", 100),
            ("location-semantics", 102),
        ] {
            let (status, body) = exchange(
                app,
                "GET",
                &format!(
                    "/api/atlas/v1/workspaces/{}/homes/{}/records/{kind}/{}",
                    f.scope.workspace_id,
                    f.scope.home_id,
                    id(n)
                ),
                Value::Null,
                &f.cookie,
                &f.csrf,
            )
            .await?;
            assert_eq!(status, StatusCode::OK, "{body}");
            let row: s::Record = serde_json::from_value(body)?;
            assert_eq!(row.scope(), f.scope);
            assert_eq!(row.record_type.as_str(), kind);
            assert_eq!(row.record_id, id(n));
            assert_eq!(row.lifecycle, s::Lifecycle::Active);
            native.push(row);
        }
        let identity = &native[0];
        let prior = &native[2];
        assert_eq!(
            identity.payload,
            json!({"kind":"location","evidenceIds":[id(100)]})
        );
        assert_eq!(native[1].payload, evidence_payload());
        assert_eq!(
            prior.payload,
            json!({"atlasId":id(101),"semanticKind":"room","reviewStatus":"accepted","evidenceIds":[id(100)]})
        );
        let next = prior
            .revision
            .checked_add(1)
            .filter(|v| *v <= s::MAX_REVISION)
            .ok_or("Native revision bound")?;
        let mut semantics = prior.payload.clone();
        semantics["evidenceIds"] = json!([id(100), id(104), id(105)]);
        let semantics_pin = json!({"record":prior.reference(),"revision":next,"payloadSha256":wire::digest(&semantics)?});
        let methods = [
            "guessed",
            "estimated",
            "directly-measured",
            "photo-fitted",
            "derived",
            "imported",
        ]
        .iter()
        .map(|m| {
            json!({"method":m,"status":"unavailable","reason":"Generated personal-only input",
        "acquisition":null,"support":null,"inputs":[],"operations":[]})
        })
        .collect::<Vec<_>>();
        let occurrences = f.scene.value["occurrences"]
            .as_array()
            .ok_or("occurrences")?
            .iter()
            .filter(|o| o["roomId"] == "hall")
            .collect::<Vec<_>>();
        assert_eq!(occurrences.len(), 2);
        let mut exports = Vec::new();
        let mut commands = Vec::new();
        for (index, o) in occurrences.into_iter().enumerate() {
            let evidence_n = 104 + index as u64;
            let mutation = 3400 + index as u64;
            let evidence = evidence_payload();
            let feature = json!({"domain":"houseatlas.measurement-occurrence-feature/1","scope":f.scope,"publicationId":f.scene.value["publicationId"],"sourceSha256":f.scene.value["sourceSha256"],
            "artifactSha256":f.overview.manifest.original.sha256,"occurrence":o,"sourceObjectIds":["owner:generated-semantic-room"]});
            let target = json!({"buildingId":o["buildingId"],"roomId":o["roomId"],"levelId":o["levelId"],"occurrenceId":o["spaceOccurrenceId"],"publicationId":f.scene.value["publicationId"],
            "sourceRevisionId":f.scene.value["sourceRevisionId"],"sourceSha256":f.scene.value["sourceSha256"],"semanticsSha256":f.scene.semantics_sha256,"overviewManifestSha256":f.overview.manifest_sha256,
            "artifactId":"model","artifactSha256":f.overview.manifest.original.sha256,"artifactBytes":f.overview.manifest.original.bytes,"targetFeatureSha256":wire::digest(&feature)?,"sourceObjectIds":["owner:generated-semantic-room"]});
            let export = serde_json::to_vec(
                &json!({"profile":"houseatlas.private-measurement-semantic-export.v1","scope":f.scope,"target":target,"roomIdentity":{"record":identity.reference(),"revision":identity.revision,"payloadSha256":wire::digest(&identity.payload)?},
            "roomSemantics":semantics_pin,"mappingReview":native_pin("evidence",evidence_n,&evidence),"reviewReceipt":{"actorId":id(5),"mutationId":id(mutation)},"methods":methods,"evidence":[]}),
            )?;
            commands.push(json!({"schemaVersion":3,"commandId":"atlas.evidence.create","requestId":id(3500+index as u64),"context":f.scope,"target":{"authority":"atlas","recordType":"evidence","recordId":id(evidence_n)},
            "payload":evidence,"idempotencyKey":id(mutation),"reason":format!("Reviewed measurement occurrence export sha256:{}",media::types::sha256(&export)),"approvalReceiptId":null,"preconditions":{"target":null,"guards":[]}}));
            exports.push(export);
        }
        let guards=native[..2].iter().map(|r|json!({"target":{"authority":"atlas","recordType":r.record_type,"recordId":r.record_id},"revision":{"kind":"atlas","value":r.revision}})).collect::<Vec<_>>();
        commands.push(json!({"schemaVersion":3,"commandId":"atlas.location-semantics.replace","requestId":id(3502),"context":f.scope,"target":{"authority":"atlas","recordType":"location-semantics","recordId":prior.record_id},
        "payload":semantics,"idempotencyKey":id(3402),"reason":"Generated reviewed two-part mapping; no pairwise physical correspondence","approvalReceiptId":null,
        "preconditions":{"target":{"kind":"atlas","value":prior.revision},"guards":guards}}));
        let batch = json!({"schemaVersion":3,"commandId":"atlas.batch.execute","requestId":id(3503),"context":f.scope,"target":{"authority":"atlas","kind":"batch","batchId":id(3504)},"payload":{"commands":commands},
        "idempotencyKey":id(3403),"reason":"Generated two-part native mapping review","approvalReceiptId":null,"preconditions":{"target":null,"guards":[]}});
        let (status, result) = exchange(
            app,
            "POST",
            &format!(
                "/api/atlas/stock/v3/workspaces/{}/homes/{}/commands",
                id(2),
                id(3)
            ),
            batch,
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK, "{result}");
        Ok(exports)
    }
    async fn historical_fixture(
        withhold_old_owner: bool,
    ) -> std::result::Result<(Fixture, Value, Value), Failure> {
        historical_fixture_from(Fixture::generate().await?, withhold_old_owner).await
    }
    async fn historical_fixture_from(
        mut f: Fixture,
        withhold_old_owner: bool,
    ) -> std::result::Result<(Fixture, Value, Value), Failure> {
        let (store, binding) = f.open()?;
        let host = f.host(store, binding)?;
        let core = host.core.clone();
        let app = router(host);
        let first = create_personal(&f, &app, 2400, "12.5000").await?;
        let old = f.authority.clone();
        let successor = retain_successor_publication(&mut f, &core, &app).await?;
        drop(app);
        close_fixture_core(core)?;
        // Cloning an admitted owner retains its SAME native source handles/review;
        // no decoded mapping is promoted. Keep old real owners for this NEW write.
        f.authority = Arc::new((*successor).clone().with_retained_reviews(vec![old])?);
        let (store, binding) = f.open()?;
        let host = f.host(store, binding)?;
        let core = host.core.clone();
        let app = router(host);
        let current = create_personal(&f, &app, 2401, "13.2500").await?;
        drop(app);
        close_fixture_core(core)?;
        if withhold_old_owner {
            f.authority = successor;
            // Preserve owned synthetic bytes but remove their original path AND
            // original owner. Inventory must NEVER probe either old file location.
            fs::rename(
                f._temp.path().join("publication"),
                f._temp.path().join("withheld-old-publication"),
            )?;
        }
        Ok((f, first, current))
    }
    fn assert_recorded_context(
        report: &crate::app::measurement_assertions::MeasurementInventoryReport,
        model: &Value,
    ) {
        assert!(report.producer_contexts.iter().any(|p|matches!(p,owner::ProducerInventoryContext::RecordedContextUnverified{original_model}if original_model==model)));
    }
    #[tokio::test]
    async fn historical_unknown_producer_values_survive_normal_wal_reopen_without_old_owner()
    -> std::result::Result<(), Failure> {
        let (f, first, current) = historical_fixture(true).await?;
        let (store, binding) = f.open()?;
        let host = f.host(store, binding)?;
        let core = host.core.clone();
        let app = router(host);
        let (status, context) = exchange(
            &app,
            "POST",
            &format!("{}/occurrence-context", f.prefix()),
            f.context(),
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK, "{context}");
        assert_eq!(context["claims"].as_array().ok_or("claims")?.len(), 1);
        assert_eq!(context["claims"][0]["head"], current["receipt"]);
        let historical = &context["historical"]["streams"][0];
        assert_eq!(historical["history"]["versions"][0], first["receipt"]);
        assert_eq!(
            historical["history"]["versions"][0]["committed"]["assertion"]["value"]["decimalToken"],
            "12.5000"
        );
        assert_eq!(
            historical["producerContext"]["state"],
            "recorded-context-unverified"
        );
        assert_eq!(
            historical["producerContext"]["originalModel"],
            first["receipt"]["committed"]["assertion"]["enteredAgainst"]
        );
        assert_eq!(
            historical["association"],
            json!({"status":"unavailable","reason":"historical-mapping-owner-unavailable"})
        );
        assert_eq!(
            context["claims"][0]["currentValueReview"]["status"],
            "unavailable"
        );
        assert_eq!(
            context["claims"][0]["currentConflicts"]["status"],
            "unavailable"
        );
        assert_eq!(context["writeEligibility"]["status"], "ineligible");
        let id = first["receipt"]["committed"]["assertion"]["version"]["assertionId"]
            .as_str()
            .ok_or("old assertion")?;
        let (status, history) = exchange(
            &app,
            "GET",
            &format!("{}/occurrence-area/{id}/history", f.prefix()),
            Value::Null,
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK, "{history}");
        assert_eq!(history["versions"][0], first["receipt"]);
        drop(app);
        close_fixture_core(core)?;
        let (reopened, _) = f.open()?;
        reopened.close()?;
        Ok(())
    }
    #[tokio::test]
    async fn historical_unknown_producer_capture_verify_and_fresh_restore_report_recorded_context_unverified()
    -> std::result::Result<(), Failure> {
        let (f, first, current) = historical_fixture(true).await?;
        let (store, binding) = f.open()?;
        let queues = backup::QueueFreeNativeOwners::for_queue_free_profile()?;
        let stock = crate::domain::stock::NativeStockContract::new()?;
        let peers = s::RecoveryValidationPeers {
            stock: &stock,
            queues: &[],
            discovery: &queues,
            evidence: &queues,
        };
        let bundle = f.path.parent().ok_or("parent")?.join("historical-capture");
        let report = store.capture_measurements(
            &bundle,
            &binding,
            &peers,
            f.authority.as_ref(),
            &mut || Ok(()),
        )?;
        let old_model = &first["receipt"]["committed"]["assertion"]["enteredAgainst"];
        assert_recorded_context(report.inventory.first().ok_or("inventory")?, old_model);
        let destination = f
            .path
            .parent()
            .ok_or("parent")?
            .join("historical-fresh-restore");
        let access = f.access.clone();
        let authority = f.authority.clone();
        let (restored, _, restored_report) =
            app::Store::restore_measurements(s::MeasurementRestoreInput {
                bundle: &bundle,
                destination: &destination,
                trusted_manifest_sha256: &report.manifest_sha256,
                selection: profile::MeasurementProfileSelection::MeasurementsV1,
                contract: NativeContracts,
                authorization: app::ReadAuthority(f.access.clone()),
                options: s::StoreOptions::default(),
                documents: f.documents.clone(),
                owners_factory: move |vault: Arc<crate::media::AssetVault>| {
                    Ok((
                        media::native::NativeMediaRuntime {
                            vault: vault.clone(),
                            server: app::ServerRuntime,
                        },
                        owner::MeasurementOwners::new(access, vault, authority),
                    ))
                },
                peers: &peers,
                evidence: f.authority.as_ref(),
                check: &mut || Ok(()),
            })?;
        assert_recorded_context(
            restored_report
                .inventory
                .first()
                .ok_or("restored inventory")?,
            old_model,
        );
        assert_eq!(report.manifest_sha256, restored_report.manifest_sha256);
        let rows = repo::complete_home(&restored.db, &f.scope)?;
        assert_eq!(rows.len(), 2);
        assert!(
            rows.iter()
                .any(|r| r.body == first["receipt"] && r.sha256 == first["receiptSha256"])
        );
        assert!(
            rows.iter()
                .any(|r| r.body == current["receipt"] && r.sha256 == current["receiptSha256"])
        );
        restored.close()?;
        store.close()?;
        Ok(())
    }
    #[tokio::test]
    async fn required_native_media_failure_still_refuses_measurement_inventory_open()
    -> std::result::Result<(), Failure> {
        let (f, _, _) = historical_fixture(true).await?;
        let (store, binding) = f.open()?;
        let host = f.host(store, binding)?;
        let core = host.core.clone();
        let app = router(host);
        // Actual authenticated original intake, real asset row/upload consumption
        // history and retained bytes. No fake SQL media manifest/receipt is inserted.
        let metadata = json!({"schemaVersion":1,"requestId":id(2500),"idempotencyKey":id(2501),"context":f.scope,"reason":"Retain generated required media",
        "filename":"generated-required.json","contentType":"application/json","sourceLicense":{"status":"unknown","reference":null}});
        let bytes = b"{\"generated\":true}";
        let mut body=format!("--required-media\r\nContent-Disposition: form-data; name=\"metadata\"\r\n\r\n{metadata}\r\n--required-media\r\nContent-Disposition: form-data; name=\"file\"; filename=\"generated-required.json\"\r\nContent-Type: application/json\r\n\r\n").into_bytes();
        body.extend_from_slice(bytes);
        body.extend_from_slice(b"\r\n--required-media--\r\n");
        let mut request = request(
            "POST",
            &format!(
                "/api/atlas/documents/v1/workspaces/{}/homes/{}/originals",
                id(2),
                id(3)
            ),
            Value::Null,
            Some(&f.cookie),
            Some(&f.csrf),
        );
        request.headers_mut().insert(
            "content-type",
            "multipart/form-data; boundary=required-media".parse()?,
        );
        *request.body_mut() = Body::from(body);
        let response = app.clone().oneshot(request).await?;
        let status = response.status();
        let output = to_bytes(response.into_body(), 128 * 1024).await?;
        assert_eq!(
            status,
            StatusCode::OK,
            "{}",
            String::from_utf8_lossy(&output)
        );
        drop(app);
        close_fixture_core(core)?;
        let (qualified, _) = f.open()?;
        qualified.close()?;
        let scope = media::types::Scope {
            workspace_id: id(2),
            home_id: id(3),
        };
        let member = f
            .path
            .parent()
            .ok_or("parent")?
            .join("media/blobs")
            .join(scope.storage_partition()?)
            .join(format!("{}.blob", media::types::sha256(bytes)));
        assert!(member.is_file());
        fs::rename(
            &member,
            f.path
                .parent()
                .ok_or("parent")?
                .join("withheld-required-native-media.blob"),
        )?;
        assert!(f.open().is_err()); // optional producer quarantine NEVER hides this
        Ok(())
    }
    #[tokio::test]
    async fn unauthorized_historical_disclosure_returns_no_values_and_no_complete_comparison()
    -> std::result::Result<(), Failure> {
        let registration: a::SourceRegistration = serde_json::from_value(
            json!({"workspaceId":id(2),"homeId":id(3),"sourceInstanceId":id(2600),"collectionId":"generated-historical-evidence",
        "owner":"homebox","partitionMode":"exclusive-home","allowedExternalIds":[]}),
        )?;
        let source = json!({"workspaceId":id(2),"homeId":id(3),"key":{"sourceInstanceId":id(2600),"collectionId":"generated-historical-evidence","sourceKind":"homebox-entity","externalId":id(2603)}});
        // Evidence is append-only. Preserve source provenance from its original
        // native CREATE and hash the review export against that exact payload.
        let initial =
            Fixture::generate_configured(false, Some(registration.clone()), Some(source)).await?;
        let (f, first, _) = historical_fixture_from(initial, false).await?;
        let (store, binding) = f.open()?;
        let host = f.host(store, binding)?;
        let core = host.core.clone();
        let app = router(host);
        f.access
            .lock()
            .map_err(|_| "Access poisoned")?
            .set_source_enabled(&registration.partition(), false)?;
        let (status, context) = exchange(
            &app,
            "POST",
            &format!("{}/occurrence-context", f.prefix()),
            f.context(),
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK, "{context}");
        assert_eq!(context["historical"]["streams"], json!([]));
        assert_eq!(
            context["historical"]["coverage"]["reasons"],
            json!(["disclosure-not-authorized"])
        );
        assert!(context["coverage"].get("retainedHomeVersions").is_none());
        assert_eq!(context["committedMutations"], json!([]));
        assert_eq!(context["coverage"]["mutationCoverage"], "unavailable");
        let text = serde_json::to_string(&context)?;
        assert!(
            !text.contains(
                first["receipt"]["committed"]["assertion"]["version"]["assertionId"]
                    .as_str()
                    .ok_or("old id")?
            )
        );
        let claim = &context["claims"][0];
        assert_eq!(claim["currentConflicts"]["status"], "unavailable");
        assert!(claim["currentConflicts"].get("unresolved").is_none());
        assert_eq!(claim["currentValueReview"]["status"], "unavailable");
        assert!(
            claim["currentValueReview"]
                .get("conflictingAssertions")
                .is_none()
        );
        assert_eq!(context["writeEligibility"]["status"], "ineligible");
        drop(app);
        close_fixture_core(core)?;
        Ok(())
    }
    #[tokio::test]
    async fn same_native_room_only_identifies_association_candidates_not_current_parts()
    -> std::result::Result<(), Failure> {
        let (f, first, current) = historical_fixture(false).await?;
        let (store, binding) = f.open()?;
        let app = router(f.host(store, binding)?);
        let (status, context) = exchange(
            &app,
            "POST",
            &format!("{}/occurrence-context", f.prefix()),
            f.context(),
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK, "{context}");
        assert_eq!(context["claims"].as_array().ok_or("claims")?.len(), 1);
        assert_eq!(context["claims"][0]["head"], current["receipt"]);
        let old = &context["historical"]["streams"][0];
        assert_eq!(old["history"]["versions"][0], first["receipt"]);
        assert_eq!(
            old["association"],
            json!({"status":"review-required","reason":"native-room-candidate-only"})
        );
        assert_eq!(
            context["historical"]["coverage"]["status"],
            "association-review-required"
        );
        assert_eq!(
            context["claims"][0]["currentValueReview"]["reason"],
            "historical-association-unreviewed"
        );
        assert_ne!(
            first["receipt"]["committed"]["assertion"]["target"]["namespace"],
            current["receipt"]["committed"]["assertion"]["target"]["namespace"]
        );
        assert_eq!(
            first["receipt"]["committed"]["targetAdmission"]["roomIdentity"]["record"],
            current["receipt"]["committed"]["targetAdmission"]["roomIdentity"]["record"]
        );
        Ok(())
    }
    #[tokio::test]
    async fn current_and_history_external_receipt_digests_match_retained_bodies()
    -> std::result::Result<(), Failure> {
        let f = Fixture::generate().await?;
        let (store, binding) = f.open()?;
        let host = f.host(store, binding)?;
        let core = host.core.clone();
        let app = router(host);
        let first = create_personal(&f, &app, 2700, "12.5000").await?;
        let pin = &first["receipt"]["committed"]["assertion"]["version"];
        let id = pin["assertionId"].as_str().ok_or("id")?;
        let mut p = first["receipt"]["committed"]["proposal"].clone();
        p["mutationId"] = json!(self::id(2701));
        p["operation"] = json!({"kind":"correct","assertionId":id,"expectedRevision":pin["revision"],"expectedPayloadSha256":pin["payloadSha256"]});
        p["area"]["decimalToken"] = json!("13.2500");
        p["reason"] = json!("Correct user-reported measurement");
        let (status, second) = exchange(
            &app,
            "POST",
            &format!("{}/occurrence-area/{id}/corrections", f.prefix()),
            p,
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK, "{second}");
        let (status, current) = exchange(
            &app,
            "GET",
            &format!("{}/occurrence-area/{id}", f.prefix()),
            Value::Null,
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK);
        let (status, history) = exchange(
            &app,
            "GET",
            &format!("{}/occurrence-area/{id}/history", f.prefix()),
            Value::Null,
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK);
        wire::validate_external_receipts(&current)?;
        wire::validate_external_receipts(&history)?;
        assert_eq!(current["head"], second["receipt"]);
        assert_eq!(
            current["receiptDigest"]["receiptSha256"],
            second["receiptSha256"]
        );
        assert_eq!(
            history["versions"],
            json!([first["receipt"], second["receipt"]])
        );
        assert_eq!(
            history["receiptDigests"][0]["receiptSha256"],
            first["receiptSha256"]
        );
        assert_eq!(history["receiptDigests"][1], current["receiptDigest"]);
        assert!(current["head"].get("receiptSha256").is_none());
        assert!(history["versions"][0].get("receiptSha256").is_none());
        let c = core.lock().map_err(|_| "Core poisoned")?;
        let s = c.store.lock().map_err(|_| "Store poisoned")?;
        let rows = repo::complete_home(&s.db, &f.scope)?;
        assert!(
            rows.iter().any(|r| r.body == first["receipt"]
                && r.sha256 == wire::receipt_digest(&r.body).unwrap())
        );
        Ok(())
    }

    #[tokio::test]
    async fn denied_optional_choice_source_hides_choices_without_hiding_retained_measurements()
    -> std::result::Result<(), Failure> {
        let registration: a::SourceRegistration = serde_json::from_value(
            json!({"workspaceId":id(2),"homeId":id(3),"sourceInstanceId":id(2900),
            "collectionId":"generated-optional-choice","owner":"homebox","partitionMode":"exclusive-home","allowedExternalIds":[]}),
        )?;
        let source = json!({"workspaceId":id(2),"homeId":id(3),"key":{"sourceInstanceId":id(2900),
            "collectionId":"generated-optional-choice","sourceKind":"homebox-entity","externalId":id(2903)}});
        let f = Fixture::generate_configured_choices(
            false,
            Some(registration.clone()),
            None,
            Some(source),
        )
        .await?;
        let (store, binding) = f.open()?;
        let host = f.host(store, binding)?;
        let core = host.core.clone();
        let app = router(host);
        let (status, before) = exchange(
            &app,
            "POST",
            &format!("{}/occurrence-context", f.prefix()),
            f.context(),
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK, "{before}");
        assert_eq!(before["evidence"].as_array().ok_or("choices")?.len(), 1);
        assert_eq!(
            before["evidence"][0]["reference"]["record"]["recordId"],
            id(104)
        );
        let estimated = before["methods"]
            .as_array()
            .ok_or("methods")?
            .iter()
            .find(|method| method["method"] == "estimated")
            .ok_or("estimated method")?;
        assert_eq!(estimated["status"], "available");
        assert_eq!(
            estimated["inputs"][0]["expectation"]["reference"],
            before["evidence"][0]["reference"]
        );
        let created = create_personal(&f, &app, 2901, "12.5000").await?;
        assert!(!serde_json::to_string(&created["receipt"])?.contains(&id(104)));
        f.access
            .lock()
            .map_err(|_| "Access poisoned")?
            .set_source_enabled(&registration.partition(), false)?;
        let (status, context) = exchange(
            &app,
            "POST",
            &format!("{}/occurrence-context", f.prefix()),
            f.context(),
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK, "{context}");
        assert_eq!(context["evidence"], json!([]));
        let estimated = context["methods"]
            .as_array()
            .ok_or("methods")?
            .iter()
            .find(|method| method["method"] == "estimated")
            .ok_or("estimated method")?;
        assert_eq!(estimated["status"], "unavailable");
        assert!(estimated["acquisition"].is_null());
        assert!(estimated["support"].is_null());
        assert_eq!(estimated["inputs"], json!([]));
        assert_eq!(context["claims"].as_array().ok_or("claims")?.len(), 1);
        assert_eq!(context["claims"][0]["head"], created["receipt"]);
        assert!(!serde_json::to_string(&context)?.contains(&id(104)));
        let assertion = created["receipt"]["committed"]["assertion"]["version"]["assertionId"]
            .as_str()
            .ok_or("assertion")?;
        let (status, history) = exchange(
            &app,
            "GET",
            &format!("{}/occurrence-area/{assertion}/history", f.prefix()),
            Value::Null,
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK, "{history}");
        assert_eq!(history["versions"], json!([created["receipt"]]));
        assert_eq!(
            history["receiptDigests"][0]["receiptSha256"],
            created["receiptSha256"]
        );
        drop(app);
        close_fixture_core(core)?;
        Ok(())
    }

    // FROZEN / UNREGISTERED / UNEXECUTED. Actual original native owners/session,
    // native Evidence mutation and disposable Access source-registration state.
    // The disabled source belongs to NO measurement receipt or target admission.
    #[tokio::test]
    async fn unrelated_disabled_source_disables_writing_without_hiding_authorized_measurements()
    -> std::result::Result<(), Failure> {
        let registration: a::SourceRegistration = serde_json::from_value(
            json!({"workspaceId":id(2),"homeId":id(3),"sourceInstanceId":id(2800),
        "collectionId":"generated-unrelated-evidence","owner":"homebox","partitionMode":"exclusive-home","allowedExternalIds":[]}),
        )?;
        let initial = Fixture::generate_configured(false, Some(registration.clone()), None).await?;
        let (f, first, current) = historical_fixture_from(initial, false).await?;
        let (store, binding) = f.open()?;
        let host = f.host(store, binding)?;
        let core = host.core.clone();
        let app = router(host);
        let mut evidence = evidence_payload();
        evidence["statement"] = json!(
            "Unrelated generated native source evidence; not an assertion input or mapping review"
        );
        evidence["provenance"]["source"] = json!({"workspaceId":id(2),"homeId":id(3),"key":{"sourceInstanceId":id(2800),"collectionId":"generated-unrelated-evidence",
        "sourceKind":"homebox-entity","externalId":id(2803)}});
        let command = json!({"schemaVersion":3,"commandId":"atlas.evidence.create","requestId":id(2801),"context":f.scope,
        "target":{"authority":"atlas","recordType":"evidence","recordId":id(104)},"payload":evidence,"idempotencyKey":id(2802),
        "reason":"Retain unrelated generated native evidence","approvalReceiptId":null,"preconditions":{"target":null,"guards":[]}});
        let (status, native) = exchange(
            &app,
            "POST",
            &format!(
                "/api/atlas/stock/v3/workspaces/{}/homes/{}/commands",
                id(2),
                id(3)
            ),
            command,
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK, "{native}");
        let (status, before) = exchange(
            &app,
            "POST",
            &format!("{}/occurrence-context", f.prefix()),
            f.context(),
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK, "{before}");
        assert_eq!(
            before["writeEligibility"],
            json!({"advisory":true,"status":"eligible"})
        );
        f.access
            .lock()
            .map_err(|_| "Access poisoned")?
            .set_source_enabled(&registration.partition(), false)?;
        let (status, context) = exchange(
            &app,
            "POST",
            &format!("{}/occurrence-context", f.prefix()),
            f.context(),
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK, "{context}");
        assert_eq!(
            context["writeEligibility"],
            json!({"advisory":true,"status":"ineligible","reason":"required-source-access-unavailable"})
        );
        let personal = context["methods"]
            .as_array()
            .ok_or("methods")?
            .iter()
            .find(|m| m["method"] == "user-reported-measured")
            .ok_or("personal choice")?;
        assert_eq!(personal["status"], "unavailable");
        assert!(personal["support"].is_null());
        assert_eq!(context["claims"].as_array().ok_or("claims")?.len(), 1);
        assert_eq!(context["claims"][0]["head"], current["receipt"]);
        assert_eq!(
            context["coverage"]["status"],
            "complete-for-exact-publication-occurrence"
        );
        assert_eq!(
            context["historical"]["coverage"]["status"],
            "association-review-required"
        );
        assert_eq!(
            context["historical"]["streams"][0]["history"]["versions"][0],
            first["receipt"]
        );
        assert_eq!(
            context["historical"]["streams"][0]["history"]["receiptDigests"][0]["receiptSha256"],
            first["receiptSha256"]
        );
        assert_eq!(
            context["committedMutations"]
                .as_array()
                .ok_or("committed identities")?
                .len(),
            2
        );
        // Association remains honestly unreviewed. Mutation-source denial must not
        // manufacture a historical disclosure failure or false empty consistency.
        assert_eq!(
            context["claims"][0]["currentValueReview"]["reason"],
            "historical-association-unreviewed"
        );
        assert_eq!(
            context["historical"]["coverage"]["status"],
            before["historical"]["coverage"]["status"]
        );
        let current_id = current["receipt"]["committed"]["assertion"]["version"]["assertionId"]
            .as_str()
            .ok_or("current id")?;
        let (status, read) = exchange(
            &app,
            "GET",
            &format!("{}/occurrence-area/{current_id}", f.prefix()),
            Value::Null,
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK, "{read}");
        assert_eq!(read["head"], current["receipt"]);
        let old_id = first["receipt"]["committed"]["assertion"]["version"]["assertionId"]
            .as_str()
            .ok_or("old id")?;
        let (status, history) = exchange(
            &app,
            "GET",
            &format!("{}/occurrence-area/{old_id}/history", f.prefix()),
            Value::Null,
            &f.cookie,
            &f.csrf,
        )
        .await?;
        assert_eq!(status, StatusCode::OK, "{history}");
        assert_eq!(history["versions"][0], first["receipt"]);
        let c = core.lock().map_err(|_| "Core poisoned")?;
        let store = c.store.lock().map_err(|_| "Store poisoned")?;
        let native_facts = facts(&store.db, &f.scope)?;
        let rows = repo::complete_home(&store.db, &f.scope)?;
        assert_eq!(rows.len(), 2);
        let bodies = rows.iter().map(|r| r.body.clone()).collect::<Vec<_>>();
        let required = owner::source_closure(&native_facts)?;
        let disclosed = owner::disclosure_closure(&native_facts, &bodies, &[])?;
        assert!(
            required
                .source_refs
                .iter()
                .any(|r| serde_json::to_value(r).unwrap()["key"]["sourceInstanceId"] == id(2800))
        );
        assert!(
            !disclosed
                .source_refs
                .iter()
                .any(|r| serde_json::to_value(r).unwrap()["key"]["sourceInstanceId"] == id(2800))
        );
        assert_eq!(rows[0].body, first["receipt"]);
        assert_eq!(rows[1].body, current["receipt"]);
        Ok(())
    }
}
