//! PRIVATE SQL only. The caller owns the actual Store transaction and original
//! native authority fence; this module opens no connection or transaction.
use super::super::{Error, Result, Scope};
use crate::contracts::measurement_assertions as wire;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::Value;

pub(super) const MAX_RECEIPT_BYTES: usize = 1_048_576;
pub(super) const MAX_HOME_BYTES: usize = 16 * 1024 * 1024;
pub(super) const MAX_HOME_VERSIONS: usize = 1024;
fn invalid() -> Error {
    Error::new(
        "schema-incompatible",
        "Measurement receipt correlation unavailable",
    )
}
fn map(_: crate::contracts::ContractError) -> Error {
    invalid()
}
pub(super) fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v[key].as_str().ok_or_else(invalid)
}
fn number(v: &Value) -> Result<u64> {
    wire::integer(v).map_err(map)
}
fn require(ok: bool) -> Result<()> {
    if ok { Ok(()) } else { Err(invalid()) }
}

/// Reusable immutable outcome validation; native admission/guard authenticity is
/// a separate obligation of the transaction owner, not inferred from this body.
pub(super) fn validate_body(body: &Value) -> Result<()> {
    wire::validate_value("receiptBody", body).map_err(map)?;
    wire::committed(&body["committed"]).map_err(map)?;
    let c = &body["committed"];
    let a = &c["assertion"];
    let p = &c["proposal"];
    let audit = &body["audit"];
    let key = &c["receiptKey"];
    let anchor = &c["audit"];
    let parsed = wire::proposal(p).map_err(map)?;
    let proposal_sha = crate::measurement_assertions::online_contract::proposal_digest(&parsed)
        .map_err(|_| invalid())?;
    let after = wire::full_assertion_digest(a).map_err(map)?;
    require(
        c["proposalSha256"] == proposal_sha
            && key["scope"] == p["scope"]
            && a["target"]["scope"] == p["scope"]
            && audit["scope"] == p["scope"]
            && key["mutationId"] == p["mutationId"]
            && audit["mutationId"] == p["mutationId"]
            && anchor["mutationId"] == p["mutationId"]
            && audit["actorId"] == key["actorId"]
            && anchor["actorId"] == key["actorId"]
            && audit["auditId"] == a["nativeAuditId"]
            && anchor["auditId"] == a["nativeAuditId"]
            && anchor["serverRecordedAt"] == audit["at"]
            && audit["assertionId"] == a["version"]["assertionId"]
            && audit["resultRevision"] == a["version"]["revision"]
            && anchor["resultRevision"] == a["version"]["revision"]
            && audit["previousRevision"] == anchor["previousRevision"]
            && audit["reason"] == p["reason"]
            && a["changeReason"] == p["reason"]
            && audit["afterDigest"] == after
            && c["pending"]["assertion"] == a["version"]
            && c["pending"]["model"] == a["enteredAgainst"]
            && c["pending"]["targetFeatureSha256"] == a["targetFeatureSha256"],
    )?;
    require(
        a["value"]["decimalToken"] == p["area"]["decimalToken"]
            && a["value"]["unit"] == p["area"]["unit"]
            && a["value"]["quantityKind"] == p["area"]["quantityKind"]
            && a["method"] == p["area"]["method"],
    )?;
    match p["operation"]["kind"].as_str() {
        Some("create") => require(
            number(&a["version"]["revision"])? == 1
                && a["previous"].is_null()
                && audit["operation"] == "create"
                && audit["previousRevision"].is_null()
                && audit["beforeDigest"].is_null(),
        )?,
        Some("correct") => require(
            a["version"]["assertionId"] == p["operation"]["assertionId"]
                && a["previous"]["assertionId"] == p["operation"]["assertionId"]
                && a["previous"]["revision"] == p["operation"]["expectedRevision"]
                && a["previous"]["payloadSha256"] == p["operation"]["expectedPayloadSha256"]
                && number(&a["version"]["revision"])?
                    == number(&p["operation"]["expectedRevision"])? + 1
                && audit["previousRevision"] == p["operation"]["expectedRevision"]
                && audit["operation"] == "correct",
        )?,
        _ => return Err(invalid()),
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub(super) struct Retained {
    pub body: Value,
    pub sha256: String,
}
fn retained(body: String, sha: String) -> Result<Retained> {
    if body.len() > MAX_RECEIPT_BYTES {
        return Err(Error::new(
            "export-too-large",
            "Measurement outcome exceeds bound",
        ));
    }
    let v = wire::parse(body.as_bytes()).map_err(map)?;
    validate_body(&v)?;
    require(
        wire::canonical(&v).map_err(map)? == body && wire::receipt_digest(&v).map_err(map)? == sha,
    )?;
    Ok(Retained {
        body: v,
        sha256: sha,
    })
}
/// Authorize BEFORE calling this actor-scoped lookup. None is only absence in
/// this native read cut, not proof of nonexecution or permission to allocate.
pub(super) fn lookup(
    db: &Connection,
    scope: &Scope,
    actor: &str,
    mutation: &str,
) -> Result<Option<Retained>> {
    let row: Option<(String, String, String, i64, String, String)> = db.query_row(
        "SELECT body,body_sha256,assertion_id,revision,audit_id,proposal_sha256 FROM measurement_mutation_receipts WHERE workspace_id=?1 AND home_id=?2 AND actor_id=?3 AND mutation_id=?4",
        params![scope.workspace_id,scope.home_id,actor,mutation], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).optional()?;
    row.map(|(body, sha, id, rev, audit, proposal)| {
        let r = retained(body, sha)?;
        let c = &r.body["committed"];
        require(
            c["receiptKey"]["scope"]["workspaceId"] == scope.workspace_id
                && c["receiptKey"]["scope"]["homeId"] == scope.home_id
                && c["receiptKey"]["actorId"] == actor
                && c["receiptKey"]["mutationId"] == mutation
                && c["assertion"]["version"]["assertionId"] == id
                && number(&c["assertion"]["version"]["revision"])?
                    == u64::try_from(rev).map_err(|_| invalid())?
                && c["audit"]["auditId"] == audit
                && c["proposalSha256"] == proposal,
        )?;
        Ok(r)
    })
    .transpose()
}
pub(super) fn head(db: &Connection, scope: &Scope, id: &str) -> Result<Option<Retained>> {
    let pointer: Option<(String,String,i64)> = db.query_row("SELECT actor_id,mutation_id,revision FROM measurement_heads WHERE workspace_id=?1 AND home_id=?2 AND assertion_id=?3",
        params![scope.workspace_id,scope.home_id,id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
    pointer
        .map(|(actor, mutation, revision)| {
            let r = lookup(db, scope, &actor, &mutation)?.ok_or_else(invalid)?;
            require(
                r.body["committed"]["assertion"]["version"]["assertionId"] == id
                    && number(&r.body["committed"]["assertion"]["version"]["revision"])?
                        == u64::try_from(revision).map_err(|_| invalid())?,
            )?;
            Ok(r)
        })
        .transpose()
}
/// Complete home receipt enumeration, bounded with one lookahead row. Overflow
/// refuses rather than producing a truncated closure or false no-conflict read.
pub(super) fn complete_home(db: &Connection, scope: &Scope) -> Result<Vec<Retained>> {
    let mut bytes = 0usize;
    let mut result = Vec::new();
    let mut stmt = db.prepare("SELECT r.body,r.body_sha256,r.actor_id,r.mutation_id,a.body FROM measurement_audits a JOIN measurement_mutation_receipts r USING(workspace_id,home_id,actor_id,mutation_id) WHERE a.workspace_id=?1 AND a.home_id=?2 ORDER BY a.seq LIMIT 1025")?;
    let mut rows = stmt.query(params![scope.workspace_id, scope.home_id])?;
    while let Some(row) = rows.next()? {
        let body: String = row.get(0)?;
        bytes = bytes.saturating_add(body.len());
        if result.len() >= MAX_HOME_VERSIONS || bytes > MAX_HOME_BYTES {
            return Err(Error::new(
                "export-too-large",
                "Complete measurement closure exceeds bound",
            ));
        }
        let r = lookup(
            db,
            scope,
            &row.get::<_, String>(2)?,
            &row.get::<_, String>(3)?,
        )?
        .ok_or_else(invalid)?;
        let audit: String = row.get(4)?;
        require(
            wire::canonical(&r.body["audit"]).map_err(map)? == audit
                && wire::canonical(&r.body).map_err(map)? == body
                && r.sha256 == row.get::<_, String>(1)?,
        )?;
        result.push(r);
    }
    // Both directions matter: a missing audit must not hide a receipt.
    let count: i64 = db.query_row(
        "SELECT COUNT(*) FROM measurement_mutation_receipts WHERE workspace_id=?1 AND home_id=?2",
        params![scope.workspace_id, scope.home_id],
        |r| r.get(0),
    )?;
    require(usize::try_from(count).ok() == Some(result.len()))?;
    Ok(result)
}

/// The ONLY write primitive. It requires the caller's original IMMEDIATE Store
/// transaction; outcome/audit/head CAS either commit together or all roll back.
/// It never authorizes from the documentary body and never commits the caller.
pub(super) fn append(
    tx: &Transaction<'_>,
    scope: &Scope,
    verified_actor: &str,
    outcome: &Value,
) -> Result<Retained> {
    validate_body(outcome)?;
    let c = &outcome["committed"];
    let a = &c["assertion"];
    let p = &c["proposal"];
    let id = text(&a["version"], "assertionId")?;
    let rev = number(&a["version"]["revision"])?;
    let mutation = text(p, "mutationId")?;
    let audit_id = text(&outcome["audit"], "auditId")?;
    require(
        c["receiptKey"]["scope"]["workspaceId"] == scope.workspace_id
            && c["receiptKey"]["scope"]["homeId"] == scope.home_id
            && c["receiptKey"]["actorId"] == verified_actor,
    )?;
    if lookup(tx, scope, verified_actor, mutation)?.is_some() {
        return Err(Error::new(
            "idempotency-conflict",
            "Measurement receipt key is already retained",
        ));
    }
    let prior = head(tx, scope, id)?;
    match p["operation"]["kind"].as_str() {
        Some("create") if prior.is_none() => {}
        Some("correct") => {
            let old = prior.as_ref().ok_or(Error::new(
                "not-found",
                "Measurement unavailable in authorized home",
            ))?;
            let old_a = &old.body["committed"]["assertion"];
            if number(&old_a["version"]["revision"])?
                != number(&p["operation"]["expectedRevision"])?
                || old_a["version"]["payloadSha256"] != p["operation"]["expectedPayloadSha256"]
            {
                return Err(Error::new("revision-conflict", "Measurement head changed"));
            }
            require(
                outcome["audit"]["beforeDigest"]
                    == wire::full_assertion_digest(old_a).map_err(map)?
                    && old_a["target"] == a["target"]
                    && old_a["enteredAgainst"] == a["enteredAgainst"]
                    && old.body["committed"]["proposal"]["target"] == p["target"],
            )?;
        }
        _ => {
            return Err(Error::new(
                "identity-conflict",
                "Measurement identity is already reserved",
            ));
        }
    }
    let body = wire::canonical(outcome).map_err(map)?;
    let sha = wire::receipt_digest(outcome).map_err(map)?;
    if body.len() > MAX_RECEIPT_BYTES {
        return Err(Error::new(
            "export-too-large",
            "Measurement outcome exceeds bound",
        ));
    }
    tx.execute("INSERT INTO measurement_audits(workspace_id,home_id,assertion_id,audit_id,actor_id,mutation_id,body) VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![scope.workspace_id,scope.home_id,id,audit_id,verified_actor,mutation,wire::canonical(&outcome["audit"]).map_err(map)?])?;
    tx.execute(
        "INSERT INTO measurement_mutation_receipts VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            scope.workspace_id,
            scope.home_id,
            verified_actor,
            mutation,
            id,
            i64::try_from(rev).map_err(|_| invalid())?,
            audit_id,
            text(c, "proposalSha256")?,
            sha,
            body
        ],
    )?;
    if prior.is_none() {
        tx.execute(
            "INSERT INTO measurement_heads VALUES(?1,?2,?3,?4,?5,?6)",
            params![
                scope.workspace_id,
                scope.home_id,
                id,
                i64::try_from(rev).map_err(|_| invalid())?,
                verified_actor,
                mutation
            ],
        )?;
    } else {
        let changed = tx.execute("UPDATE measurement_heads SET revision=?1,actor_id=?2,mutation_id=?3 WHERE workspace_id=?4 AND home_id=?5 AND assertion_id=?6 AND revision=?7",
            params![i64::try_from(rev).map_err(|_| invalid())?,verified_actor,mutation,scope.workspace_id,scope.home_id,id,i64::try_from(rev-1).map_err(|_| invalid())?])?;
        if changed != 1 {
            return Err(Error::new(
                "revision-conflict",
                "Measurement head changed during transaction",
            ));
        }
    }
    retained(body, sha)
}

#[cfg(test)]
mod tests {
    //! FROZEN/UNREGISTERED/UNEXECUTED. Actual private SQL primitive, generated
    //! in-memory rows only. These do NOT exercise native authority, strict
    //! profile opening, HTTP, recovery, or the public Store transaction service.
    use super::*;
    use serde_json::json;
    fn id(n: u64) -> String {
        format!("00000000-0000-4000-8000-{n:012x}")
    }
    fn scope() -> Scope {
        Scope {
            workspace_id: id(9001),
            home_id: id(9002),
        }
    }
    fn database() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.pragma_update(None, "foreign_keys", true).unwrap();
        for (_, sql) in super::super::measurement_profile::INPUTS {
            db.execute_batch(sql).unwrap();
        }
        db
    }
    fn receipt(
        assertion: u64,
        actor: u64,
        mutation: u64,
        token: &str,
        old: Option<&Value>,
    ) -> Value {
        let scope = scope();
        let hash = "ab".repeat(32);
        let audit = id(mutation + 1000);
        let previous = old.map(|v| v["committed"]["assertion"]["version"].clone());
        let revision = previous
            .as_ref()
            .map_or(1, |v| wire::integer(&v["revision"]).unwrap() + 1);
        let operation = match &previous {
            None => json!({"kind":"create"}),
            Some(v) => {
                json!({"kind":"correct","assertionId":id(assertion),"expectedRevision":v["revision"],"expectedPayloadSha256":v["payloadSha256"]})
            }
        };
        let target = json!({"buildingId":"generated-building","roomId":id(9003),"levelId":"generated-level","occurrenceId":"generated-occurrence",
            "publicationId":id(9004),"artifactId":"model","sourceRevisionId":"generated-revision","sourceSha256":hash,"semanticsSha256":hash,"overviewManifestSha256":hash,
            "selectionRevision":hash,"artifactSha256":hash,"artifactBytes":128,"targetFeatureSha256":hash,"sourceObjectIds":["owner:generated-object"]});
        let proposal = json!({"domain":"houseatlas.measurement-assertions.online-proposal/1","scope":scope,"mutationId":id(mutation),"operation":operation,"target":target,"property":"occurrence-area",
            "area":{"decimalToken":token,"unit":"m2","quantityKind":"area","method":"estimated","evidence":[],"inputs":[],"operation":null,"contradicts":[]},"reason":"Generated SQL receipt case"});
        let model = json!({"scope":scope,"buildingId":"generated-building","publicationId":id(9004),"artifactId":"model","artifactSha256":hash,"artifactBytes":128,
            "lineage":{"kind":"unified-atlas-publication","sourceRevisionId":"generated-revision","sourceSha256":hash,"semanticsSha256":hash,"overviewManifestSha256":hash,"selectionRevision":hash},
            "custody":{"kind":"unknown"},"physicalRegistration":{"kind":"unknown"}});
        let mut a = json!({"version":{"assertionId":id(assertion),"revision":revision,"payloadSha256":hash},"previous":previous,
            "target":{"scope":scope,"namespace":{"kind":"producer-publication","publicationId":id(9004)},"buildingId":"generated-building","roomId":id(9003),"floorId":"generated-level","occurrenceId":"generated-occurrence","feature":{"kind":"room"}},
            "property":"occurrence-area","value":{"decimalToken":token,"unit":"m2","quantityKind":"area"},"enteredAgainst":model,"targetFeatureSha256":hash,"method":"estimated",
            "support":{"corroboration":"not-established","uncertainties":[{"status":"inferred","explanation":"Generated estimate only"}],"limitations":["estimated"]},
            "inputs":[],"operation":null,"evidence":[],"supersedes":[],"contradicts":[],"resolutions":[],"review":{"kind":"no-known-issue"},"changeReason":"Generated SQL receipt case","nativeAuditId":audit});
        a["version"]["payloadSha256"] = json!(wire::assertion_payload_digest(&a).unwrap());
        let pin = |n, kind| json!({"record":{"recordType":kind,"recordId":id(n)},"revision":1,"payloadSha256":hash});
        let before =
            old.map(|v| wire::full_assertion_digest(&v["committed"]["assertion"]).unwrap());
        let previous_revision = previous.as_ref().map(|v| v["revision"].clone());
        let at = "2026-01-02T03:04:05Z";
        json!({"format":"houseatlas.measurement-receipt/1","committed":{"assertion":a,"proposal":proposal,
            "proposalSha256":crate::measurement_assertions::online_contract::proposal_digest(&wire::proposal(&proposal).unwrap()).unwrap(),
            "receiptKey":{"scope":scope,"actorId":id(actor),"mutationId":id(mutation)},
            "audit":{"auditId":audit,"actorId":id(actor),"mutationId":id(mutation),"serverRecordedAt":at,"previousRevision":previous_revision,"resultRevision":revision},
            "targetAdmission":{"kind":"resolved","roomIdentity":pin(9020,"identity"),"roomSemantics":pin(9021,"location-semantics"),"mappingReview":pin(9022,"evidence"),"sourceObjectIds":["owner:generated-object"]},
            "acquisition":{"kind":"image-informed-estimate"},"pending":{"assertion":a["version"],"model":model,"targetFeatureSha256":hash,"unresolvedConflicts":[]}},
            "audit":{"schemaVersion":1,"auditId":audit,"scope":scope,"assertionId":id(assertion),"operation":if old.is_none(){"create"}else{"correct"},"previousRevision":previous_revision,"resultRevision":revision,
                "actorId":id(actor),"at":at,"reason":"Generated SQL receipt case","mutationId":id(mutation),"beforeDigest":before,"afterDigest":wire::full_assertion_digest(&a).unwrap()}})
    }
    #[test]
    fn immutable_complete_receipts_preserve_exact_corrections() {
        let mut db = database();
        let original = receipt(9010, 9011, 9012, "0012.5000", None);
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .unwrap();
        let first = append(&tx, &scope(), &id(9011), &original).unwrap();
        tx.commit().unwrap();
        let corrected = receipt(9010, 9011, 9013, "13.2500", Some(&original));
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .unwrap();
        append(&tx, &scope(), &id(9011), &corrected).unwrap();
        tx.commit().unwrap();
        let old = lookup(&db, &scope(), &id(9011), &id(9012))
            .unwrap()
            .unwrap();
        assert_eq!(old.body, original);
        assert_eq!(old.sha256, first.sha256);
        assert_eq!(
            old.body["committed"]["assertion"]["value"]["decimalToken"],
            "0012.5000"
        );
        assert_eq!(
            head(&db, &scope(), &id(9010)).unwrap().unwrap().body,
            corrected
        );
        assert_eq!(complete_home(&db, &scope()).unwrap().len(), 2);
    }
    #[test]
    fn receipt_key_includes_actor_and_replay_is_retained() {
        let mut db = database();
        let a = receipt(9010, 9011, 9012, "12.50", None);
        // Distinct audit identity is server-owned, even for another actor's UUID.
        let mut b = receipt(9014, 9015, 9012, "14.00", None);
        b["committed"]["assertion"]["nativeAuditId"] = json!(id(9990));
        let new_sha = wire::assertion_payload_digest(&b["committed"]["assertion"]).unwrap();
        b["committed"]["assertion"]["version"]["payloadSha256"] = json!(new_sha);
        b["committed"]["audit"]["auditId"] = json!(id(9990));
        b["audit"]["auditId"] = json!(id(9990));
        b["committed"]["pending"]["assertion"] = b["committed"]["assertion"]["version"].clone();
        b["audit"]["afterDigest"] =
            json!(wire::full_assertion_digest(&b["committed"]["assertion"]).unwrap());
        let tx = db.transaction().unwrap();
        append(&tx, &scope(), &id(9011), &a).unwrap();
        append(&tx, &scope(), &id(9015), &b).unwrap();
        tx.commit().unwrap();
        assert_eq!(
            lookup(&db, &scope(), &id(9011), &id(9012))
                .unwrap()
                .unwrap()
                .body,
            a
        );
        assert_eq!(
            lookup(&db, &scope(), &id(9015), &id(9012))
                .unwrap()
                .unwrap()
                .body,
            b
        );
    }
    #[test]
    fn duplicate_complete_key_is_refused() {
        let mut db = database();
        let value = receipt(9010, 9011, 9012, "12.5", None);
        let tx = db.transaction().unwrap();
        append(&tx, &scope(), &id(9011), &value).unwrap();
        tx.commit().unwrap();
        let tx = db.transaction().unwrap();
        assert_eq!(
            append(&tx, &scope(), &id(9011), &value).unwrap_err().code,
            "idempotency-conflict"
        );
    }
    #[test]
    fn dropped_transaction_does_not_leave_audit_receipt_or_head() {
        let mut db = database();
        let value = receipt(9010, 9011, 9012, "12.5", None);
        {
            let tx = db.transaction().unwrap();
            append(&tx, &scope(), &id(9011), &value).unwrap();
        }
        for table in [
            "measurement_mutation_receipts",
            "measurement_heads",
            "measurement_audits",
        ] {
            assert_eq!(
                db.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
    }
    #[test]
    fn immutable_receipt_and_audit_updates_are_refused() {
        let mut db = database();
        let value = receipt(9010, 9011, 9012, "12.5", None);
        let tx = db.transaction().unwrap();
        append(&tx, &scope(), &id(9011), &value).unwrap();
        tx.commit().unwrap();
        for sql in [
            "UPDATE measurement_mutation_receipts SET body='{}'",
            "DELETE FROM measurement_mutation_receipts",
            "UPDATE measurement_audits SET body='{}'",
            "DELETE FROM measurement_audits",
            "DELETE FROM measurement_heads",
        ] {
            assert!(db.execute(sql, []).is_err());
        }
        assert_eq!(head(&db, &scope(), &id(9010)).unwrap().unwrap().body, value);
    }
}
