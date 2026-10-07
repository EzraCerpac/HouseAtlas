use super::{
    Authority, DisclosurePurpose, OperationId, OutputKind, OwnerResult, PreparedRequest, Route,
    StockAuthorityPort, StockContractPort, StockError, StockResult, ValidatedRequest,
    operational_time,
};
use serde_json::{Value, json};

/// Validate the declared output schema plus correlations schema cannot express.
/// The same current-authority release checks apply to retained owner receipts.
pub fn validate_result<P, C, A>(
    principal: &P,
    prepared: &PreparedRequest<A::Witness, A::Graph>,
    result: &OwnerResult,
    contracts: &C,
    authority: &A,
) -> StockResult<()>
where
    C: StockContractPort,
    A: StockAuthorityPort<P>,
{
    let request = prepared.request();
    check_wire(
        principal,
        prepared,
        request,
        &result.wire,
        contracts,
        authority,
    )?;
    if request.id() != OperationId::AtlasBatchExecute {
        require(result.children.is_empty())?;
        return Ok(());
    }
    require(result.children.len() == request.children().len())?;
    let mut records = Vec::new();
    let mut audits = Vec::new();
    for (child, wire) in request.children().iter().zip(&result.children) {
        check_wire(principal, prepared, child, wire, contracts, authority)?;
        records.extend(array(&wire["data"], "records")?.iter().cloned());
        audits.extend(array(&wire["data"], "auditIds")?.iter().cloned());
    }
    // Public stock batch output is the exact ordered flattening of durable
    // child outcomes. Child IDs/keys remain in private native owner storage.
    require(result.wire["data"]["records"] == Value::Array(records))?;
    require(result.wire["data"]["auditIds"] == Value::Array(audits))
}

fn check_wire<P, C, A>(
    principal: &P,
    prepared: &PreparedRequest<A::Witness, A::Graph>,
    request: &ValidatedRequest,
    wire: &Value,
    contracts: &C,
    authority: &A,
) -> StockResult<()>
where
    C: StockContractPort,
    A: StockAuthorityPort<P>,
{
    contracts.validate(request.operation().output_schema, wire)?;
    require(wire["requestId"] == request.request_id())?;
    // Some native output arms include a closed stockError before dispatch.
    if wire.get("code").is_some() && wire.get("commandId").is_none() {
        return authority.authorize_result(principal, prepared, request, wire);
    }
    require(wire["commandId"] == request.id().as_str())?;
    let context =
        serde_json::to_value(request.context()).map_err(|_| StockError::InvalidContract)?;
    require(wire["resolvedScope"] == context)?;
    let kind = request.operation().output_kind;
    if kind == OutputKind::AtlasReceipt {
        require(wire["status"] == "committed")?;
        require(wire["data"]["requestDigest"] == request.intent_digest())?;
    } else if kind == OutputKind::StockOutcome
        || kind == OutputKind::LabelVariant && request.is_mutation()
    {
        require(wire["requestDigest"] == request.intent_digest())?;
        operational_time(string(wire, "observedAt")?)?;
        let activity = string(&wire["remoteActivity"], "state")?;
        if activity == "not-dispatched" {
            require(matches!(
                wire["state"].as_str(),
                Some("prepared" | "queued" | "rejected-before-dispatch")
            ))?;
            require(array(wire, "knownEffects")?.is_empty() && wire["responseSuccess"] == false)?;
        } else {
            require(matches!(
                activity,
                "active" | "end-unproven" | "ended-proven"
            ))?;
        }
    } else {
        require(wire["status"] == "read")?;
    }
    if let Some(time) = wire.get("retrievedAt").and_then(Value::as_str) {
        operational_time(time)?;
    }
    if matches!(kind, OutputKind::FeatureRead | OutputKind::LabelVariant) && !request.is_mutation()
    {
        require(wire["sourceInstanceId"] == request.target()["sourceInstanceId"])?;
        require(wire["collectionId"] == request.target()["collectionId"])?;
        require(wire["data"]["kind"] == expected_feature_kind(request)?)?;
        if let Some(artifact) = wire["data"].get("artifact") {
            operational_time(string(artifact, "expiresAt")?)?;
            let bytes = super::super::integer::safe_integer(&artifact["byteSize"])
                .ok_or(StockError::CorrelationMismatch)?;
            if let Some(max) = request.payload().get("maxBytes") {
                let max = super::super::integer::safe_integer(max)
                    .ok_or(StockError::CorrelationMismatch)?;
                require(bytes <= max)?;
            }
        }
        if let Some(limit) = request.payload().get("limit") {
            let limit = super::super::integer::safe_integer(limit)
                .ok_or(StockError::CorrelationMismatch)?;
            if let Some(rows) = wire["data"]["rows"].as_array() {
                require(rows.len() as u64 <= limit)?;
            }
        }
    }
    authority.authorize_result(principal, prepared, request, wire)?;
    if request.id() == OperationId::AtlasBatchExecute {
        return Ok(());
    }
    let data = &wire["data"];
    if let Some(target) = data.get("target") {
        release_target(principal, prepared, request, target, data, authority)?;
    }
    for field in ["records", "resources", "rows", "entries"] {
        if let Some(rows) = data[field].as_array() {
            for row in rows {
                if let Some(target) = row.get("target") {
                    release_target(principal, prepared, request, target, row, authority)?;
                } else if field == "rows"
                    && matches!(
                        data["kind"].as_str(),
                        Some("statistics-locations" | "statistics-tags")
                    )
                {
                    let target = json!({"authority":"homebox", "sourceInstanceId":request.target()["sourceInstanceId"],
                        "collectionId":request.target()["collectionId"], "resourceKind":if data["kind"] == "statistics-tags" { "tag" } else { "entity" },
                        "resourceId":row["id"]});
                    release_target(principal, prepared, request, &target, row, authority)?;
                }
                if let Some(time) = row.get("retrievedAt").and_then(Value::as_str) {
                    operational_time(time)?;
                }
            }
        }
    }
    if kind == OutputKind::AtlasReceipt {
        let records = array(data, "records")?;
        let expected = atlas_mutation_targets(request)?;
        require(records.len() == expected.len())?;
        require(
            expected
                .iter()
                .all(|target| records.iter().any(|row| row["target"] == *target)),
        )?;
        require(array(data, "auditIds")?.len() == records.len())?;
    }
    if let Some(effects) = wire["knownEffects"].as_array() {
        for effect in effects {
            release_effect(principal, prepared, request, effect, authority)?;
        }
    }
    Ok(())
}

/// Effects can include qualified cascades and reference updates of a different
/// kind from the primary result. Every effect must instead belong to the exact
/// captured and approved impact graph; partition equality alone never admits it.
fn release_effect<P, A>(
    principal: &P,
    prepared: &PreparedRequest<A::Witness, A::Graph>,
    request: &ValidatedRequest,
    effect: &Value,
    authority: &A,
) -> StockResult<()>
where
    A: StockAuthorityPort<P>,
{
    require(request.operation().authority == Authority::Homebox && request.is_mutation())?;
    let target = &effect["target"];
    require(target["authority"] == "homebox")?;
    require(target["sourceInstanceId"] == request.target()["sourceInstanceId"])?;
    require(target["collectionId"] == request.target()["collectionId"])?;
    require(matches!(
        target["resourceKind"].as_str(),
        Some(
            "entity" | "tag" | "entity-type" | "attachment" | "field" | "maintenance" | "template"
        )
    ))?;
    authority.disclose(
        principal,
        prepared,
        request,
        target,
        effect,
        DisclosurePurpose::ImpactGraph,
    )
}

fn release_target<P, A>(
    principal: &P,
    prepared: &PreparedRequest<A::Witness, A::Graph>,
    request: &ValidatedRequest,
    target: &Value,
    row: &Value,
    authority: &A,
) -> StockResult<()>
where
    A: StockAuthorityPort<P>,
{
    require(target["authority"] == request.target()["authority"])?;
    let kind_field = if request.operation().authority == Authority::Atlas {
        "recordType"
    } else {
        "resourceKind"
    };
    let mut expected_kind = request.operation().result_resource_kind;
    if request.id() == OperationId::HomeboxQueryRead {
        expected_kind = match request.payload()["view"].as_str() {
            Some("maintenance") => "maintenance",
            Some("statistics-tags") => "tag",
            _ => "entity",
        };
    }
    if request.id() == OperationId::HomeboxLabelOutput {
        expected_kind = "entity";
    }
    let remap = request.id() == OperationId::AtlasBindingRemap;
    if remap {
        require(
            atlas_mutation_targets(request)?
                .iter()
                .any(|candidate| candidate == target),
        )?;
    } else if request.target()["resourceKind"] != "collection" || !request.is_mutation() {
        require(target[kind_field] == expected_kind)?;
    }
    if request.operation().authority == Authority::Homebox {
        require(target["sourceInstanceId"] == request.target()["sourceInstanceId"])?;
        require(target["collectionId"] == request.target()["collectionId"])?;
        if request.target().get("entityId").is_some() {
            require(target["entityId"] == request.target()["entityId"])?;
        }
    }
    let purpose = if remap {
        DisclosurePurpose::RemapRecord
    } else if request.target() == target {
        DisclosurePurpose::ExactTarget
    } else if new_provider_identity(request) {
        DisclosurePurpose::NewProviderIdentity
    } else if request.id() == OperationId::HomeboxEntityPath {
        DisclosurePurpose::AncestorPath
    } else if request.target()["resourceKind"] == "collection" {
        if request.is_mutation() {
            DisclosurePurpose::ImpactGraph
        } else {
            DisclosurePurpose::FeatureResource
        }
    } else if request.target().get("recordId").is_none()
        && request.target().get("resourceId").is_none()
    {
        DisclosurePurpose::ScopedPage
    } else {
        return Err(StockError::CorrelationMismatch);
    };
    authority.disclose(principal, prepared, request, target, row, purpose)
}

fn new_provider_identity(request: &ValidatedRequest) -> bool {
    matches!(
        request.id(),
        OperationId::HomeboxEntityCreate
            | OperationId::HomeboxLocationCreate
            | OperationId::HomeboxEntityDuplicate
            | OperationId::HomeboxLocationDuplicate
            | OperationId::HomeboxTagCreate
            | OperationId::HomeboxFieldCreate
            | OperationId::HomeboxFileUpload
            | OperationId::HomeboxDocumentLinkCreate
            | OperationId::HomeboxMaintenanceCreate
            | OperationId::HomeboxEntityTypeCreate
            | OperationId::HomeboxTemplateCreate
            | OperationId::HomeboxTemplateCreateItem
    )
}

fn atlas_mutation_targets(request: &ValidatedRequest) -> StockResult<Vec<Value>> {
    if request.id() != OperationId::AtlasBindingRemap {
        return Ok(vec![request.target().clone()]);
    }
    let payload = request.payload();
    require(request.target()["recordId"] == payload["oldBindingId"])?;
    Ok(vec![
        request.target().clone(),
        json!({"authority":"atlas","recordType":"binding","recordId":payload["newBindingId"]}),
        json!({"authority":"atlas","recordType":"reconciliation","recordId":payload["journalId"]}),
    ])
}

fn expected_feature_kind(request: &ValidatedRequest) -> StockResult<&str> {
    match request.route() {
        Route::HomeboxFeature { variant, .. } => Ok(match request.id() {
            OperationId::HomeboxLabelOutput => "label-image",
            OperationId::HomeboxQrcodeRender => "qrcode-image",
            _ => variant,
        }),
        _ => Err(StockError::CorrelationMismatch),
    }
}

fn string<'a>(value: &'a Value, field: &str) -> StockResult<&'a str> {
    value[field].as_str().ok_or(StockError::CorrelationMismatch)
}
fn array<'a>(value: &'a Value, field: &str) -> StockResult<&'a Vec<Value>> {
    value[field]
        .as_array()
        .ok_or(StockError::CorrelationMismatch)
}
fn require(condition: bool) -> StockResult<()> {
    if condition {
        Ok(())
    } else {
        Err(StockError::CorrelationMismatch)
    }
}
