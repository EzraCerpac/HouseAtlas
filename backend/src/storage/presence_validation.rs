//! SOURCE PROPOSAL: same-snapshot read-only exhaustive historical validation.
//! Root must first validate the complete native/stock/queue/profile closure.
use super::{repository as repo, *};
use crate::{contracts::stock as wire, domain as d};
use rusqlite::Connection;
use std::collections::BTreeMap;

type Key = (String, String, u64);

/// REQUIRED original-owner archival check, with no successful default. Witness
/// metadata is a lookup/correlation input, never an authority or restored grant.
/// Owner must verify its independent retained bytes/full historic registration,
/// native review, membership/dates/digests and accepted historical authority
/// provenance/policy. Current cache or Access rows cannot substitute for this.
pub(crate) trait OriginalPresenceHistoryEvidence {
    fn validate_original_observation(
        &self,
        witness: &wire::PresenceWitness,
        final_record: &Record,
        prior: Option<&Record>,
        check: &mut dyn FnMut() -> Result<()>,
    ) -> Result<()>;
}

/// Fresh profile proposal: every Binding starts from an audited Create. No
/// unaudited Binding bootstrap or missing historic witness is repaired here.
pub(crate) fn validate_all<C: Contract, E: OriginalPresenceHistoryEvidence>(
    db: &Connection,
    contract: &C,
    evidence: &E,
    check: &mut dyn FnMut() -> Result<()>,
) -> Result<usize> {
    check()?;
    let mut witnesses: BTreeMap<Key, wire::PresenceWitness> = BTreeMap::new();
    let mut stmt = db.prepare("SELECT workspace_id,home_id,binding_record_id,binding_revision,audit_id,actor_id,mutation_id,body FROM presence_witnesses ORDER BY workspace_id,binding_record_id,binding_revision")?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        check()?;
        let body: String = row.get(7)?;
        let witness = wire::decode_presence_witness(body.as_bytes()).map_err(|_| incompatible())?;
        let revision =
            super::numeric::safe_integer(&serde_json::to_value(&witness.binding_revision)?)
                .filter(|n| *n > 0)
                .ok_or_else(incompatible)?;
        require(
            row.get::<_, String>(0)? == witness.workspace_id
                && row.get::<_, String>(1)? == witness.home_id
                && row.get::<_, String>(2)? == witness.binding_record_id
                && row.get::<_, i64>(3)? == i64::try_from(revision).map_err(|_| incompatible())?
                && row.get::<_, String>(4)? == witness.audit_id
                && row.get::<_, String>(5)? == witness.actor_id
                && row.get::<_, String>(6)? == witness.mutation_id
                && repo::json(contract, &witness)? == body
                && witness.authority.access_package_version
                    == crate::access::NATIVE_ACCESS_PACKAGE_VERSION
                && witness.observed_at == witness.cache.last_successful_fetch_at,
        )?;
        let key = (
            witness.workspace_id.clone(),
            witness.binding_record_id.clone(),
            revision,
        );
        require(witnesses.insert(key, witness).is_none())?;
    }
    drop(rows);
    drop(stmt);
    let total = witnesses.len();
    // Full native validation already proves every audit and command receipt
    // pair, batch closure, revision chain and saved latest record. This pass
    // consumes EVERY Binding revision, with canonical linkage checked again.
    let mut last: BTreeMap<(String, String), Record> = BTreeMap::new();
    let mut stmt = db.prepare("SELECT a.body,r.body FROM audits a LEFT JOIN receipts r ON r.workspace_id=a.workspace_id AND r.home_id=a.home_id AND json_extract(a.body,'$.actorId')=r.actor_id AND json_extract(a.body,'$.mutationId')=r.mutation_id ORDER BY a.seq")?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        check()?;
        let audit_body: String = row.get(0)?;
        let result_body: String = row.get::<_, Option<String>>(1)?.ok_or_else(incompatible)?;
        let result: MutationResult = serde_json::from_str(&result_body)?;
        let audit: Audit = serde_json::from_str(&audit_body)?;
        require(
            result.audit == audit
                && !result.replayed
                && repo::retained_json_matches(contract, &result, &result_body)?
                && repo::json(contract, &audit)? == audit_body,
        )?;
        contract.validate_result(&result, Prior::Unspecified)?;
        if result.record.record_type != RecordType::Binding {
            continue;
        }
        let key = (
            result.record.workspace_id.clone(),
            result.record.record_id.clone(),
        );
        let prior = last.get(&key);
        match prior {
            None => require(audit.operation == Operation::Create && result.record.revision == 1)?,
            Some(prior) => {
                require(
                    prior.scope() == result.record.scope()
                        && prior.revision.checked_add(1) == Some(result.record.revision),
                )?;
                contract.validate_result(&result, Prior::Record(prior))?;
            }
        }
        let prior_domain: Option<d::Record> = prior.map(carrier).transpose()?;
        let requirement = d::binding_presence_requirement(
            prior_domain.as_ref(),
            &carrier(&result.record)?,
            carrier(&audit.operation)?,
        )
        .map_err(|_| incompatible())?;
        let witness_key = (key.0.clone(), key.1.clone(), result.record.revision);
        match requirement {
            d::PresenceRequirement::Qualify(trigger) => {
                let witness = witnesses.remove(&witness_key).ok_or_else(incompatible)?;
                require(
                    witness.home_id == result.record.home_id
                        && witness.audit_id == audit.audit_id
                        && witness.actor_id == audit.actor_id
                        && witness.mutation_id == audit.mutation_id
                        && serde_json::to_value(witness.operation)?
                            == serde_json::to_value(audit.operation)?
                        && serde_json::to_value(witness.trigger)? == serde_json::to_value(trigger)?
                        && serde_json::to_value(&witness.source)?
                            == result.record.payload["source"]
                        && witness.admitted_at == audit.at
                        && result.record.last_audit_id == audit.audit_id
                        && result.record.updated_at == audit.at
                        && result.record.lifecycle == Lifecycle::Active,
                )?;
                evidence.validate_original_observation(&witness, &result.record, prior, check)?;
            }
            d::PresenceRequirement::NoNewObservation => {
                require(!witnesses.contains_key(&witness_key))?
            }
            d::PresenceRequirement::OutsideCurrentSemanticScope(_) => return Err(incompatible()),
        }
        last.insert(key, result.record);
    }
    drop(rows);
    drop(stmt);
    require(witnesses.is_empty())?;
    let mut stmt = db.prepare(
        "SELECT body FROM records WHERE record_type='binding' ORDER BY workspace_id,record_id",
    )?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        check()?;
        let record: Record = serde_json::from_str(&row.get::<_, String>(0)?)?;
        require(
            last.get(&(record.workspace_id.clone(), record.record_id.clone())) == Some(&record),
        )?;
    }
    check()?;
    Ok(total)
}
fn carrier<T: serde::de::DeserializeOwned>(data: &impl serde::Serialize) -> Result<T> {
    Ok(serde_json::from_value(serde_json::to_value(data)?)?)
}
fn incompatible() -> Error {
    Error::new(
        "schema-incompatible",
        "Historical presence witness closure is incompatible",
    )
}
fn require(value: bool) -> Result<()> {
    if value { Ok(()) } else { Err(incompatible()) }
}
