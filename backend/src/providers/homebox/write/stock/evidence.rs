//! Qualified native evidence is correlated here, never manufactured from intent.
//! Matching current values establishes observation, not causality or provider CAS.
use super::{entity, resources, *};
use serde_json::{Map, Number, Value};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;
type ResponseIdentity = (Option<StockTarget>, Vec<(String, Vec<Uuid>)>);

pub(super) fn dispatch_facts<C: StockContractPort>(
    contracts: &C,
    command: &StockCommand,
    plan: &NativePlan,
    permit: &InvocationPermit,
    receipt: &DispatchReceipt,
) -> DispatchFacts {
    let mut facts = DispatchFacts {
        response_success: false,
        response_digest: None,
        generated_target: None,
        generated_identity_resolved: false,
        generated_members: Vec::new(),
        remote_activity: RemoteActivity::end_unproven(),
    };
    let plan_digest = serde_json::to_value(plan)
        .ok()
        .and_then(|value| contracts.digest_native(&value).ok());
    if receipt.operation_id != permit.operation_id
        || permit.operation_id.is_nil()
        || receipt.plan_digest != permit.plan_digest
        || plan_digest.as_ref() != Some(&permit.plan_digest)
        || receipt.context != command.context
        || receipt.source_instance_id != command.target.source_instance_id
        || receipt.collection_id != command.target.collection_id
        || !plan.readback.target.same_partition(&command.target)
        || !receipt.remote_activity.invoked()
        || !receipt.remote_activity.well_formed()
        || !valid_scope(command)
    {
        return facts;
    }
    // Physical termination evidence survives a correlated error response. An
    // HTTP success or matching readback never creates termination evidence.
    facts.remote_activity = receipt.remote_activity.clone();
    let Some(response) = &receipt.response else {
        return facts;
    };
    facts.response_digest = Some(response.body_digest.clone());
    if response.status != plan.success_status {
        return facts;
    }
    let Some((candidate, members)) = response_identity(command, plan, &response.value) else {
        return facts;
    };
    facts.response_success = true;
    facts.generated_target = candidate;
    facts.generated_members = members;
    facts.generated_identity_resolved = matches!(plan.generated, GeneratedIdentity::None);
    facts
}

fn response_identity(
    command: &StockCommand,
    plan: &NativePlan,
    value: &Value,
) -> Option<ResponseIdentity> {
    match &plan.generated {
        GeneratedIdentity::DirectResponse => {
            if response_resource(plan.response)? != plan.readback.target.resource_kind {
                return None;
            }
            let id = object_id(value)?;
            if command.target.resource_kind == plan.readback.target.resource_kind
                && command.target.resource_id == Some(id)
            {
                return None;
            }
            let mut target = plan.readback.target.clone();
            target.resource_id = Some(id);
            if !valid_target(&target) || !response_owner(value, &target, false) {
                return None;
            }
            Some((Some(target), response_members(plan.response, value)?))
        }
        GeneratedIdentity::EntityMember { field, before_ids } => {
            if plan.response != ResponseKind::Entity
                || member_kind(field)? != plan.readback.target.resource_kind
                || plan.readback.target.entity_id != command.target.entity_id
                || object_id(value)? != command.target.owner().ok()?
                || !unique_nonzero(before_ids)
            {
                return None;
            }
            let rows = member_rows(value, field)?;
            let after = row_ids(rows)?;
            if before_ids.iter().any(|id| !after.contains(id)) {
                return None;
            }
            let added: Vec<_> = after
                .iter()
                .filter(|id| !before_ids.contains(id))
                .copied()
                .collect();
            if added.len() != 1 {
                return None;
            }
            let mut target = plan.readback.target.clone();
            target.resource_id = Some(added[0]);
            if !valid_target(&target) {
                return None;
            }
            Some((Some(target), vec![(field.clone(), after)]))
        }
        GeneratedIdentity::None => {
            match plan.response {
                ResponseKind::NoContent | ResponseKind::Printer if value.is_null() => {}
                ResponseKind::Bulk if value.get("completed").and_then(Value::as_u64).is_some() => {}
                ResponseKind::Entity => {
                    let target = &plan.readback.target;
                    if matches!(
                        target.resource_kind,
                        ResourceKind::Field | ResourceKind::Attachment
                    ) {
                        if object_id(value)? != target.owner().ok()? {
                            return None;
                        }
                        let field = if target.resource_kind == ResourceKind::Field {
                            "fields"
                        } else {
                            "attachments"
                        };
                        let ids = row_ids(member_rows(value, field)?)?;
                        if ids.contains(&target.id().ok()?) == plan.readback.absence {
                            return None;
                        }
                    } else if target.resource_kind != ResourceKind::Entity
                        || object_id(value)? != target.id().ok()?
                    {
                        return None;
                    }
                }
                ResponseKind::Tag
                | ResponseKind::Maintenance
                | ResponseKind::EntityType
                | ResponseKind::Template => {
                    if response_resource(plan.response)? != plan.readback.target.resource_kind
                        || object_id(value)? != plan.readback.target.id().ok()?
                        || !response_owner(value, &plan.readback.target, false)
                    {
                        return None;
                    }
                }
                _ => return None,
            }
            let members = if plan.response == ResponseKind::Template {
                response_members(plan.response, value)?
            } else {
                Vec::new()
            };
            Some((None, members))
        }
    }
}

fn response_resource(kind: ResponseKind) -> Option<ResourceKind> {
    Some(match kind {
        ResponseKind::Entity => ResourceKind::Entity,
        ResponseKind::Tag => ResourceKind::Tag,
        ResponseKind::Maintenance => ResourceKind::Maintenance,
        ResponseKind::EntityType => ResourceKind::EntityType,
        ResponseKind::Template => ResourceKind::Template,
        _ => return None,
    })
}

fn response_members(kind: ResponseKind, value: &Value) -> Option<Vec<(String, Vec<Uuid>)>> {
    let fields: &[&str] = match kind {
        ResponseKind::Entity => &["fields", "attachments"],
        ResponseKind::Template => &["fields"],
        _ => &[],
    };
    fields
        .iter()
        .map(|field| Some(((*field).to_owned(), row_ids(member_rows(value, field)?)?)))
        .collect()
}

pub(super) fn observation_facts<C: StockContractPort>(
    contracts: &C,
    operation: &StoredOperation,
    observation: &NativeObservation,
) -> Option<ObservationFacts> {
    let command = &operation.command;
    let outcome = &operation.outcome;
    let plan = operation.plan.as_ref()?;
    if !valid_scope(command)
        || !plan.readback.target.same_partition(&command.target)
        || outcome.operation_id != operation.operation_id
        || outcome.command_id != command.command_id
        || outcome.request_id != command.request_id
        || outcome.request_digest != command.request_digest
        || outcome.resolved_scope != command.context
        || !outcome.remote_activity.invoked()
        || !outcome.remote_activity.well_formed()
        || !outcome.well_formed()
    {
        return None;
    }
    match observation {
        NativeObservation::Present {
            context,
            target,
            value,
            observed_at,
            complete,
            impact,
        } => {
            let actual = effective_target(operation, plan)?;
            if context != &command.context
                || target != &actual
                || !complete
                || contracts.validate_observed_at(observed_at).is_err()
                || matches!(
                    plan.readback.selector,
                    ReadbackSelector::CompleteImpact | ReadbackSelector::Printer
                )
            {
                return None;
            }
            let projected = project_observation(&actual, &plan.readback.selector, value)?;
            let digest = contracts.digest_native(value).ok()?;
            let identity_resolved = generated_members_agree(operation, value);
            let current_agrees = !plan.readback.absence
                && identity_resolved
                && native_values_agree(
                    actual.resource_kind,
                    &plan.readback.expected,
                    &projected,
                    &operation.generated_members,
                );
            let (mut effects, impact_digest, complete_impact) =
                qualified_impact(command, impact.as_ref())?;
            if current_agrees {
                insert_primary(
                    &mut effects,
                    primary_evidence(command, &actual, false, digest.clone())?,
                )?;
            }
            Some(ObservationFacts {
                readback_digest: digest,
                agrees: current_agrees && (!plan.requires_complete_impact || complete_impact),
                known_effects: effects,
                generated_identity_resolved: identity_resolved,
                observed_at: observed_at.clone(),
                impact_evidence_digest: impact_digest,
            })
        }
        NativeObservation::Absent {
            context,
            target,
            evidence_digest,
            observed_at,
            impact,
        } => {
            let actual = effective_target(operation, plan)?;
            if context != &command.context
                || target != &actual
                || !plan.readback.absence
                || contracts.validate_observed_at(observed_at).is_err()
                || matches!(
                    plan.readback.selector,
                    ReadbackSelector::CompleteImpact | ReadbackSelector::Printer
                )
            {
                return None;
            }
            let (mut effects, impact_digest, complete_impact) =
                qualified_impact(command, impact.as_ref())?;
            insert_primary(
                &mut effects,
                primary_evidence(command, &actual, true, evidence_digest.clone())?,
            )?;
            Some(ObservationFacts {
                readback_digest: evidence_digest.clone(),
                agrees: !plan.requires_complete_impact || complete_impact,
                known_effects: effects,
                generated_identity_resolved: true,
                observed_at: observed_at.clone(),
                impact_evidence_digest: impact_digest,
            })
        }
        NativeObservation::Effects {
            context,
            source_instance_id,
            collection_id,
            effects,
            complete,
            evidence_digest,
            observed_at,
        } => {
            if context != &command.context
                || *source_instance_id != command.target.source_instance_id
                || *collection_id != command.target.collection_id
                || !complete
                || contracts.validate_observed_at(observed_at).is_err()
                || !matches!(
                    plan.readback.selector,
                    ReadbackSelector::CompleteImpact | ReadbackSelector::Printer
                )
                || !valid_effects(command, effects)
                || !matches!(plan.generated, GeneratedIdentity::None)
            {
                return None;
            }
            let printer = matches!(plan.readback.selector, ReadbackSelector::Printer);
            if printer
                && !effects
                    .iter()
                    .any(|effect| effect.effect == Effect::PrinterRequestObserved)
                || !printer
                    && effects
                        .iter()
                        .any(|effect| effect.effect == Effect::PrinterRequestObserved)
            {
                return None;
            }
            Some(ObservationFacts {
                readback_digest: evidence_digest.clone(),
                agrees: true,
                known_effects: effects.clone(),
                generated_identity_resolved: true,
                observed_at: observed_at.clone(),
                impact_evidence_digest: Some(evidence_digest.clone()),
            })
        }
        NativeObservation::Unavailable => None,
    }
}

pub(super) fn effective_target(
    operation: &StoredOperation,
    plan: &NativePlan,
) -> Option<StockTarget> {
    let expected = &plan.readback.target;
    let target = match &plan.generated {
        GeneratedIdentity::None => {
            if operation
                .actual_target
                .as_ref()
                .is_some_and(|actual| actual != expected)
            {
                return None;
            }
            expected.clone()
        }
        GeneratedIdentity::DirectResponse | GeneratedIdentity::EntityMember { .. } => {
            let actual = operation.actual_target.as_ref()?;
            if !actual.same_partition(expected)
                || actual.resource_kind != expected.resource_kind
                || actual.entity_id != expected.entity_id
            {
                return None;
            }
            if matches!(plan.generated, GeneratedIdentity::DirectResponse)
                && actual.resource_kind == operation.command.target.resource_kind
                && actual.resource_id == operation.command.target.resource_id
            {
                return None;
            }
            actual.clone()
        }
    };
    valid_target(&target).then_some(target)
}

fn project_observation(
    target: &StockTarget,
    selector: &ReadbackSelector,
    value: &Value,
) -> Option<Value> {
    let selected = match selector {
        ReadbackSelector::Whole => {
            if object_id(value)? != target.id().ok()? || !response_owner(value, target, true) {
                return None;
            }
            value
        }
        ReadbackSelector::RootList => {
            let rows = value.as_array()?;
            let ids = row_ids(rows)?;
            if target.resource_kind == ResourceKind::Maintenance
                && rows.iter().any(|row| !response_owner(row, target, true))
            {
                return None;
            }
            let index = ids.iter().position(|id| Some(*id) == target.resource_id)?;
            &rows[index]
        }
        ReadbackSelector::Member { field } => {
            if member_kind(field)? != target.resource_kind
                || object_id(value)? != target.owner().ok()?
            {
                return None;
            }
            let rows = member_rows(value, field)?;
            let ids = row_ids(rows)?;
            let index = ids.iter().position(|id| Some(*id) == target.resource_id)?;
            &rows[index]
        }
        ReadbackSelector::CompleteImpact | ReadbackSelector::Printer => return None,
    };
    match target.resource_kind {
        ResourceKind::Entity => entity::writable_entity(selected, true).ok(),
        ResourceKind::Field => writable_field(selected),
        kind => resources::writable_resource(kind, selected).ok(),
    }
}

fn writable_field(value: &Value) -> Option<Value> {
    let field = value.as_object()?;
    object_id(value)?;
    if !field.get("name")?.is_string()
        || !matches!(
            field.get("type")?.as_str()?,
            "text" | "number" | "boolean" | "time"
        )
        || !field.get("textValue")?.is_string()
        || field.get("numberValue")?.as_i64().is_none()
        || !field.get("booleanValue")?.is_boolean()
    {
        return None;
    }
    Some(Value::Object(
        [
            "id",
            "name",
            "type",
            "textValue",
            "numberValue",
            "booleanValue",
        ]
        .iter()
        .map(|key| Some(((*key).to_owned(), field.get(*key)?.clone())))
        .collect::<Option<Map<_, _>>>()?,
    ))
}

fn generated_members_agree(operation: &StoredOperation, native: &Value) -> bool {
    // Both member and whole readback bind exact retained response IDs against
    // the actual native envelope; no child identity is guessed from values.
    let Some(plan) = &operation.plan else {
        return false;
    };
    for (index, (field, response_ids)) in operation.generated_members.iter().enumerate() {
        if !matches!(field.as_str(), "fields" | "attachments")
            || operation.generated_members[..index]
                .iter()
                .any(|(prior, _)| prior == field)
        {
            return false;
        }
        let Some(rows) = member_rows(native, field) else {
            return false;
        };
        let Some(readback_ids) = row_ids(rows) else {
            return false;
        };
        if !same_ids(response_ids, &readback_ids) {
            return false;
        }
    }
    // New template fields need the dispatch response's exact generated ID set.
    if plan.readback.target.resource_kind == ResourceKind::Template
        && plan
            .readback
            .expected
            .get("fields")
            .and_then(Value::as_array)
            .is_some_and(|fields| fields.iter().any(|field| field.get("id").is_none()))
        && !operation
            .generated_members
            .iter()
            .any(|(field, _)| field == "fields")
    {
        return false;
    }
    true
}

fn qualified_impact(
    command: &StockCommand,
    impact: Option<&ImpactObservation>,
) -> Option<(Vec<EffectEvidence>, Option<Digest>, bool)> {
    match impact {
        None => Some((Vec::new(), None, false)),
        Some(impact) if valid_effects(command, &impact.effects) => Some((
            impact.effects.clone(),
            Some(impact.evidence_digest.clone()),
            impact.complete,
        )),
        Some(_) => None,
    }
}

fn primary_evidence(
    command: &StockCommand,
    target: &StockTarget,
    absence: bool,
    digest: Digest,
) -> Option<EffectEvidence> {
    if !valid_target(target) {
        return None;
    }
    let effect = if absence {
        Effect::Deleted
    } else if command.command_id.ends_with(".create")
        || command.command_id.ends_with(".upload")
        || command.command_id.ends_with(".duplicate")
        || command.command_id.ends_with(".create-item")
    {
        Effect::Created
    } else {
        Effect::Updated
    };
    Some(EffectEvidence {
        target: WireTarget::try_from(target).ok()?,
        effect,
        digest,
    })
}

fn insert_primary(effects: &mut Vec<EffectEvidence>, primary: EffectEvidence) -> Option<()> {
    if let Some(existing) = effects
        .iter()
        .find(|effect| effect.target == primary.target)
    {
        if existing.effect != primary.effect {
            return None;
        }
    } else {
        if effects.len() >= 1000 {
            return None;
        }
        effects.insert(0, primary);
    }
    Some(())
}

fn valid_effects(command: &StockCommand, effects: &[EffectEvidence]) -> bool {
    effects.len() <= 1000
        && effects.iter().enumerate().all(|(index, effect)| {
            let target = &effect.target;
            target.source_instance_id == command.target.source_instance_id
                && target.collection_id == command.target.collection_id
                && target.authority == HomeBoxAuthority::HomeBox
                && valid_target(&StockTarget {
                    source_instance_id: target.source_instance_id,
                    collection_id: target.collection_id,
                    resource_kind: target.resource_kind,
                    resource_id: Some(target.resource_id),
                    entity_id: target.entity_id,
                })
                && !effects[..index].iter().any(|prior| prior.target == *target)
        })
}

fn valid_scope(command: &StockCommand) -> bool {
    !command.context.workspace_id.is_nil()
        && !command.context.home_id.is_nil()
        && !command.target.source_instance_id.is_nil()
        && !command.target.collection_id.is_nil()
}

fn valid_target(target: &StockTarget) -> bool {
    let nested = matches!(
        target.resource_kind,
        ResourceKind::Field | ResourceKind::Attachment | ResourceKind::Maintenance
    );
    target.resource_kind != ResourceKind::Collection
        && !target.source_instance_id.is_nil()
        && !target.collection_id.is_nil()
        && target.resource_id.is_some_and(|id| !id.is_nil())
        && nested == target.entity_id.is_some()
        && target.entity_id.is_none_or(|id| !id.is_nil())
}

fn response_owner(value: &Value, target: &StockTarget, required: bool) -> bool {
    if target.resource_kind != ResourceKind::Maintenance {
        return true;
    }
    match value.get("itemID") {
        Some(owner) => nonzero_id(owner) == target.entity_id,
        None => !required,
    }
}

fn member_kind(field: &str) -> Option<ResourceKind> {
    match field {
        "fields" => Some(ResourceKind::Field),
        "attachments" => Some(ResourceKind::Attachment),
        _ => None,
    }
}

fn member_rows<'a>(value: &'a Value, field: &str) -> Option<&'a [Value]> {
    match value.get(field)? {
        Value::Null => Some(&[]),
        Value::Array(rows) => Some(rows),
        _ => None,
    }
}

fn nonzero_id(value: &Value) -> Option<Uuid> {
    let id = Uuid::parse_str(value.as_str()?).ok()?;
    (!id.is_nil()).then_some(id)
}

fn object_id(value: &Value) -> Option<Uuid> {
    nonzero_id(value.get("id")?)
}

fn row_ids(rows: &[Value]) -> Option<Vec<Uuid>> {
    let ids = rows.iter().map(object_id).collect::<Option<Vec<_>>>()?;
    unique_nonzero(&ids).then_some(ids)
}

fn unique_nonzero(ids: &[Uuid]) -> bool {
    let mut seen = BTreeSet::new();
    ids.iter().all(|id| !id.is_nil() && seen.insert(*id))
}

fn same_ids(left: &[Uuid], right: &[Uuid]) -> bool {
    unique_nonzero(left)
        && unique_nonzero(right)
        && left.len() == right.len()
        && left.iter().copied().collect::<BTreeSet<_>>()
            == right.iter().copied().collect::<BTreeSet<_>>()
}

/// These representation rules are qualified native scalar fields, not
/// general JSON equality. In particular, a nil UUID never becomes a concrete
/// identity or an entity root-parent clear through this comparison.
fn native_values_agree(
    kind: ResourceKind,
    expected: &Value,
    actual: &Value,
    members: &[(String, Vec<Uuid>)],
) -> bool {
    let (Some(expected_fields), Some(actual_fields)) = (expected.as_object(), actual.as_object())
    else {
        return semantic_subset(expected, actual, None, members);
    };
    // Omission preserves an absent native type relation, so it is still an
    // expectation. Generic subset comparison must not ignore a newly present
    // template. A qualified clear's null readback can match pointer omission.
    if kind == ResourceKind::EntityType
        && !optional_template_relation_equal(
            expected_fields.get("defaultTemplateId"),
            actual_fields.get("defaultTemplateId"),
        )
    {
        return false;
    }
    expected_fields.iter().all(|(key, expected)| {
        if kind == ResourceKind::EntityType && key == "defaultTemplateId" {
            return true;
        }
        actual_fields
            .get(key)
            .is_some_and(|actual| match (kind, key.as_str()) {
                (ResourceKind::Tag, "parentId")
                    if tag_root_parent(expected) && tag_root_parent(actual) =>
                {
                    true
                }
                (ResourceKind::Maintenance, "cost") => decimal_cost_equal(expected, actual),
                (ResourceKind::Entity, "assetId") => {
                    match (
                        entity::native_asset_id(expected),
                        entity::native_asset_id(actual),
                    ) {
                        (Some(expected), Some(actual)) => expected == actual,
                        _ => false,
                    }
                }
                _ => semantic_subset(expected, actual, Some(key), members),
            })
    })
}

fn optional_template_relation_equal(expected: Option<&Value>, actual: Option<&Value>) -> bool {
    match (
        expected.filter(|value| !value.is_null()),
        actual.filter(|value| !value.is_null()),
    ) {
        (None, None) => true,
        (Some(expected), Some(actual)) => match (nonzero_id(expected), nonzero_id(actual)) {
            (Some(expected), Some(actual)) => expected == actual,
            _ => false,
        },
        _ => false,
    }
}

fn tag_root_parent(value: &Value) -> bool {
    value.is_null()
        || value
            .as_str()
            .and_then(|value| Uuid::parse_str(value).ok())
            .is_some_and(|id| id.is_nil())
}

fn decimal_cost_equal(expected: &Value, actual: &Value) -> bool {
    match (
        expected.as_str().and_then(decimal_parts),
        actual.as_str().and_then(decimal_parts),
    ) {
        (Some(expected), Some(actual)) => expected == actual,
        _ => false,
    }
}

/// Compare finite decimal notation exactly using borrowed digit slices. This
/// mirrors the native decimal value without parsing floats, rounding, changing
/// intent, or extending the rule to unrelated strings or JSON numbers.
fn decimal_parts(value: &str) -> Option<(bool, &str, &str)> {
    let negative = value.starts_with('-');
    let unsigned = if negative { &value[1..] } else { value };
    let (whole, fraction) = match unsigned.split_once('.') {
        Some((whole, fraction)) if !fraction.is_empty() => (whole, fraction),
        Some(_) => return None,
        None => (unsigned, ""),
    };
    if whole.is_empty()
        || !whole.bytes().all(|byte| byte.is_ascii_digit())
        || !fraction.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    let whole = whole.trim_start_matches('0');
    let fraction = fraction.trim_end_matches('0');
    Some((
        negative && (!whole.is_empty() || !fraction.is_empty()),
        whole,
        fraction,
    ))
}

/// Subset comparison uses native value semantics while retaining the original
/// wire array order for hashing/storage. Only known native set-valued relations
/// and exact-ID field memberships receive unordered comparison.
fn semantic_subset(
    expected: &Value,
    actual: &Value,
    key: Option<&str>,
    members: &[(String, Vec<Uuid>)],
) -> bool {
    match (expected, actual) {
        (Value::Number(left), Value::Number(right)) => numeric_equal(left, right),
        (Value::Object(left), Value::Object(right)) => left.iter().all(|(key, value)| {
            right
                .get(key)
                .is_some_and(|actual| semantic_subset(value, actual, Some(key), members))
        }),
        (Value::Array(left), Value::Array(right))
            if matches!(key, Some("tagIds" | "defaultTagIds")) =>
        {
            let ids = |values: &[Value]| values.iter().map(nonzero_id).collect::<Option<Vec<_>>>();
            match (ids(left), ids(right)) {
                (Some(left), Some(right)) => same_ids(&left, &right),
                _ => false,
            }
        }
        (Value::Array(left), Value::Array(right)) if key == Some("fields") => {
            fields_agree(left, right, members)
        }
        (Value::Array(left), Value::Array(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right)
                    .all(|(left, right)| semantic_subset(left, right, None, members))
        }
        _ => expected == actual,
    }
}

fn fields_agree(expected: &[Value], actual: &[Value], members: &[(String, Vec<Uuid>)]) -> bool {
    if expected.len() != actual.len() {
        return false;
    }
    let Some(actual_ids) = row_ids(actual) else {
        return false;
    };
    let mut used = vec![false; actual.len()];
    let mut anonymous = Vec::new();
    // Existing native observations are already bounded by the qualified peer.
    // Indexed identity matching does not reuse the wire's 100-row create cap.
    let actual_by_id: BTreeMap<_, _> = actual_ids
        .iter()
        .enumerate()
        .map(|(index, id)| (*id, index))
        .collect();
    let mut known_ids = BTreeSet::new();
    for field in expected {
        if let Some(value) = field.get("id") {
            let Some(id) = nonzero_id(value) else {
                return false;
            };
            if !known_ids.insert(id) {
                return false;
            }
            let Some(&index) = actual_by_id.get(&id) else {
                return false;
            };
            if !semantic_subset(field, &actual[index], None, members) {
                return false;
            }
            used[index] = true;
        } else {
            anonymous.push(field);
        }
    }
    if anonymous.is_empty() {
        return true;
    }
    // Anonymous generated template rows still use the bounded aggregate match.
    if expected.len() > 100 {
        return false;
    }
    let mut retained = members.iter().filter(|(field, _)| field == "fields");
    let Some((_, response_ids)) = retained.next() else {
        return false;
    };
    if retained.next().is_some() || !same_ids(response_ids, &actual_ids) {
        return false;
    }
    let remaining: Vec<_> = actual
        .iter()
        .enumerate()
        .filter(|(index, _)| !used[*index])
        .map(|(_, field)| field)
        .collect();
    // This proves an aggregate of values over exact response-generated IDs.
    // It does not associate an intended row/name/position with a new child ID.
    let edges: Vec<Vec<usize>> = anonymous
        .iter()
        .map(|expected| {
            remaining
                .iter()
                .enumerate()
                .filter(|(_, actual)| semantic_subset(expected, actual, None, members))
                .map(|(index, _)| index)
                .collect()
        })
        .collect();
    let mut assigned = vec![None; remaining.len()];
    for row in 0..edges.len() {
        if !augment(
            row,
            &edges,
            &mut assigned,
            &mut vec![false; remaining.len()],
        ) {
            return false;
        }
    }
    true
}

fn augment(
    row: usize,
    edges: &[Vec<usize>],
    assigned: &mut [Option<usize>],
    visited: &mut [bool],
) -> bool {
    for &column in &edges[row] {
        if visited[column] {
            continue;
        }
        visited[column] = true;
        if assigned[column].is_none_or(|prior| augment(prior, edges, assigned, visited)) {
            assigned[column] = Some(row);
            return true;
        }
    }
    false
}

fn numeric_equal(left: &Number, right: &Number) -> bool {
    if let (Some(left), Some(right)) = (left.as_i64(), right.as_i64()) {
        return left == right;
    }
    if let (Some(left), Some(right)) = (left.as_u64(), right.as_u64()) {
        return left == right;
    }
    if let Some(integer) = left.as_i64() {
        return exact_signed(integer, right);
    }
    if let Some(integer) = right.as_i64() {
        return exact_signed(integer, left);
    }
    if let Some(integer) = left.as_u64() {
        return exact_unsigned(integer, right);
    }
    if let Some(integer) = right.as_u64() {
        return exact_unsigned(integer, left);
    }
    match (left.as_f64(), right.as_f64()) {
        (Some(left), Some(right)) => left.is_finite() && right.is_finite() && left == right,
        _ => false,
    }
}

fn exact_signed(integer: i64, number: &Number) -> bool {
    number.as_f64().is_some_and(|value| {
        value.is_finite()
            && value.fract() == 0.0
            && value >= i64::MIN as f64
            && value < 9_223_372_036_854_775_808.0
            && value as i64 == integer
            && integer as f64 == value
    })
}

fn exact_unsigned(integer: u64, number: &Number) -> bool {
    number.as_f64().is_some_and(|value| {
        value.is_finite()
            && value.fract() == 0.0
            && (0.0..18_446_744_073_709_551_616.0).contains(&value)
            && value as u64 == integer
            && integer as f64 == value
    })
}
