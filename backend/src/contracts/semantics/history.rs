//! Committed record/audit correlation from the published result contract.

use serde_json::Value;

use super::canonical::digest;
use super::common::{date_less, number, same_scope, text};
use super::{PriorValue, SemanticError};

// The public boundary validates mutationResult before entering this semantic
// check. A supplied prior record is shape-checked after result correlation,
// preserving both the published error order and undefined/null distinction.
pub(super) fn validate_result(result: &Value, prior: PriorValue<'_>) -> Result<(), SemanticError> {
    let record = &result["record"];
    let audit = &result["audit"];
    let previous_revision = &audit["previousRevision"];
    let result_revision = number(&audit["resultRevision"])?;
    let next_revision = if previous_revision.is_null() {
        1.0
    } else {
        number(previous_revision)? + 1.0
    };
    if !same_scope(record, audit)?
        || text(&audit["record"]["recordId"])? != text(&record["recordId"])?
        || text(&audit["record"]["recordType"])? != text(&record["recordType"])?
        || result_revision != number(&record["revision"])?
        || text(&audit["auditId"])? != text(&record["lastAuditId"])?
        || text(&audit["at"])? != text(&record["updatedAt"])?
        || result_revision != next_revision
    {
        return Err(SemanticError::invalid(
            "Audit and record revision must commit together",
        ));
    }

    let operation = text(&audit["operation"])?;
    let is_create = operation == "create";
    if is_create != previous_revision.is_null() || is_create != audit["beforeDigest"].is_null() {
        return Err(SemanticError::invalid(
            "Audit create/prior-revision/before-digest mismatch",
        ));
    }
    if (operation == "tombstone") != (text(&record["lifecycle"])? == "tombstoned") {
        return Err(SemanticError::invalid("Audit operation/lifecycle mismatch"));
    }
    if is_create && text(&record["createdAt"])? != text(&record["updatedAt"])? {
        return Err(SemanticError::invalid("Create timestamps must match"));
    }
    if digest(record)? != text(&audit["afterDigest"])? {
        return Err(SemanticError::invalid(
            "Audit digest must match canonical committed record",
        ));
    }

    match prior {
        PriorValue::Unspecified => {}
        PriorValue::Absent => {
            if !is_create {
                return Err(SemanticError::invalid(
                    "Noncreate audit requires the supplied prior record",
                ));
            }
        }
        PriorValue::Record(prior) => {
            super::super::validate_value::<super::super::AtlasRecord>(prior)?;
            if !same_scope(record, prior)?
                || text(&prior["recordId"])? != text(&record["recordId"])?
                || text(&prior["recordType"])? != text(&record["recordType"])?
                || previous_revision.is_null()
                || number(&prior["revision"])? != number(previous_revision)?
                || digest(prior)? != text(&audit["beforeDigest"])?
                || text(&record["createdAt"])? != text(&prior["createdAt"])?
                || date_less(text(&record["updatedAt"])?, text(&prior["updatedAt"])?)
            {
                return Err(SemanticError::invalid(
                    "Audit does not match supplied prior record",
                ));
            }
            if (operation == "restore") != (text(&prior["lifecycle"])? == "tombstoned") {
                return Err(SemanticError::invalid("Audit prior lifecycle mismatch"));
            }
        }
    }
    Ok(())
}
