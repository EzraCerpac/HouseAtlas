use std::collections::BTreeSet;

use crate::contracts::v2::{self, RecordRefRecordType as RecordType};

use super::*;

const MAX_REVISION: u64 = 9_007_199_254_740_991;
const MAX_LINKS: usize = 64;
pub const MAX_HISTORY: usize = 1_024;

fn require(ok: bool, message: &'static str) -> ValidationResult<()> {
    if ok {
        Ok(())
    } else {
        Err(ValidationError(message))
    }
}

fn uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|id| id.hyphenated().to_string() == value)
}

pub(super) fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn text(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 1_024 && !value.chars().any(char::is_control)
}

fn revision(value: u64) -> bool {
    (1..=MAX_REVISION).contains(&value)
}

// Matches atlas_scene.rs's source-owned ID contract, not native UUID identity.
fn source_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.:".contains(&c))
}

// Future semantic exports may retain IFC compressed GUIDs, which can include $.
// Format alone cannot establish that a key is stable; the semantic owner must.
fn feature_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.:$".contains(&c))
}

fn validate_version(value: &AssertionVersion) -> ValidationResult<()> {
    require(
        uuid(&value.assertion_id) && revision(value.revision) && digest(&value.payload_sha256),
        "invalid assertion version",
    )
}

fn validate_native(value: &NativeRevision) -> ValidationResult<()> {
    require(
        v2::validate(&value.record).is_ok()
            && revision(value.revision)
            && digest(&value.payload_sha256),
        "invalid native revision reference",
    )
}

/// Structural inventory validation, including provisional publications with
/// unknown custody/registration. This does not qualify bytes or native authority.
pub fn validate_model_pin(value: &ModelPin) -> ValidationResult<()> {
    validate_model(value)
}

pub(super) fn validate_model(value: &ModelPin) -> ValidationResult<()> {
    require(v2::validate(&value.scope).is_ok(), "invalid model scope")?;
    require(
        source_id(&value.building_id) && uuid(&value.publication_id),
        "invalid model identity",
    )?;
    require(
        source_id(&value.artifact_id) && digest(&value.artifact_sha256) && value.artifact_bytes > 0,
        "invalid model artifact",
    )?;
    match &value.lineage {
        ModelLineage::UnifiedAtlasPublication {
            source_revision_id,
            source_sha256,
            semantics_sha256,
            overview_manifest_sha256,
            selection_revision,
        } => {
            require(
                source_id(source_revision_id)
                    && [
                        source_sha256,
                        semantics_sha256,
                        overview_manifest_sha256,
                        selection_revision,
                    ]
                    .iter()
                    .all(|sha| digest(sha)),
                "invalid source-owned publication pins",
            )?;
            require(
                value.artifact_id == "model",
                "unified Atlas model artifact ID must be model",
            )?;
        }
        ModelLineage::NativeIfcSource(lineage) => {
            require(
                [
                    &value.building_id,
                    &lineage.source_id,
                    &lineage.source_revision_id,
                    &lineage.source_asset_id,
                    &lineage.semantic_map_revision_id,
                ]
                .iter()
                .all(|id| uuid(id)),
                "invalid native IFC identity",
            )?;
            require(
                [
                    &lineage.source_revision_sha256,
                    &lineage.source_sha256,
                    &lineage.publication_sha256,
                    &lineage.semantic_map_sha256,
                ]
                .iter()
                .all(|sha| digest(sha)),
                "missing native IFC hashes",
            )?;
        }
    }
    if let ModelCustody::NativeRecords {
        geometry,
        association,
    } = &value.custody
    {
        validate_native(geometry)?;
        validate_native(association)?;
        require(
            geometry.record.record_type == RecordType::Geometry
                && association.record.record_type == RecordType::SceneAssociation,
            "custody needs native geometry and scene-association pins",
        )?;
    }
    if let PhysicalRegistration::Reviewed { evidence } = &value.physical_registration {
        validate_native(evidence)?;
        require(
            evidence.record.record_type == RecordType::Evidence,
            "physical registration review requires native evidence",
        )?;
    }
    Ok(())
}

pub(super) fn validate_target(
    target: &SemanticTarget,
    property: MeasurementProperty,
) -> ValidationResult<()> {
    require(
        v2::validate(&target.scope).is_ok()
            && [
                &target.building_id,
                &target.room_id,
                &target.floor_id,
                &target.occurrence_id,
            ]
            .iter()
            .all(|id| source_id(id)),
        "invalid semantic target",
    )?;
    match &target.namespace {
        SemanticNamespace::ProducerPublication { publication_id } => {
            require(
                uuid(publication_id),
                "invalid producer publication namespace",
            )?;
        }
        SemanticNamespace::NativeSource { source_id } => {
            require(uuid(source_id), "invalid native source namespace")?;
        }
    }
    match (&target.feature, property) {
        (
            SemanticFeature::Room,
            MeasurementProperty::OccurrenceArea
            | MeasurementProperty::OccurrencePerimeter
            | MeasurementProperty::RoomClearHeight,
        ) => Ok(()),
        (
            SemanticFeature::Wall {
                wall_id,
                endpoint_ids,
            },
            MeasurementProperty::WallLength,
        ) => require(
            feature_id(wall_id)
                && endpoint_ids.iter().all(|id| feature_id(id))
                && endpoint_ids[0] < endpoint_ids[1],
            "wall needs stable ID and distinct canonically ordered semantic endpoint IDs",
        ),
        (
            SemanticFeature::Opening { opening_id },
            MeasurementProperty::OpeningWidth | MeasurementProperty::OpeningHeight,
        ) => require(feature_id(opening_id), "invalid opening identity"),
        _ => Err(ValidationError(
            "measurement property incompatible with semantic feature",
        )),
    }
}

pub(super) fn same_scope(target: &SemanticTarget, model: &ModelPin) -> bool {
    target.scope == model.scope && target.building_id == model.building_id
}

fn method_limitation(method: MeasurementMethod) -> Option<SupportLimitation> {
    match method {
        MeasurementMethod::Guessed => Some(SupportLimitation::Guessed),
        MeasurementMethod::Estimated => Some(SupportLimitation::Estimated),
        MeasurementMethod::UserReportedMeasured => Some(SupportLimitation::UserReportedMeasurement),
        MeasurementMethod::PhotoFitted => Some(SupportLimitation::PhotoFitted),
        MeasurementMethod::LegacyUserReportedMethodUnspecified => {
            Some(SupportLimitation::MethodUnspecified)
        }
        _ => None,
    }
}

fn validate_support(support: &MeasurementSupport) -> ValidationResult<()> {
    require(
        !support.uncertainties.is_empty() && support.uncertainties.len() <= MAX_LINKS,
        "explicit bounded uncertainty components required",
    )?;
    for (index, component) in support.uncertainties.iter().enumerate() {
        require(
            v2::validate(component).is_ok(),
            "invalid native uncertainty component",
        )?;
        require(
            !support.uncertainties[..index].contains(component),
            "duplicate uncertainty component",
        )?;
    }
    require(
        support.limitations.iter().collect::<BTreeSet<_>>().len() == support.limitations.len(),
        "duplicate support limitation",
    )?;
    Ok(())
}

fn check_method(method: MeasurementMethod, support: &MeasurementSupport) -> ValidationResult<()> {
    if let Some(limit) = method_limitation(method) {
        require(
            support.limitations.contains(&limit),
            "acquisition limitation must be retained",
        )?;
    }
    Ok(())
}

fn inherits(output: &MeasurementSupport, input: &MeasurementSupport) -> ValidationResult<()> {
    require(
        input
            .uncertainties
            .iter()
            .all(|component| output.uncertainties.contains(component))
            && input
                .limitations
                .iter()
                .all(|limit| output.limitations.contains(limit)),
        "derived/imported value lost underlying support or uncertainty",
    )
}

pub fn validate_assertion(value: &MeasurementAssertion) -> ValidationResult<()> {
    validate_version(&value.version)?;
    validate_target(&value.target, value.property)?;
    value.value.validate()?;
    require(
        value.property.kind() == value.value.kind,
        "property and quantity kind disagree",
    )?;
    validate_model(&value.entered_against)?;
    require(
        same_scope(&value.target, &value.entered_against) && digest(&value.target_feature_sha256),
        "target/model scope or feature pin missing",
    )?;
    require(
        match (&value.target.namespace, &value.entered_against.lineage) {
            (
                SemanticNamespace::ProducerPublication { publication_id },
                ModelLineage::UnifiedAtlasPublication { .. },
            ) => publication_id == &value.entered_against.publication_id,
            (
                SemanticNamespace::NativeSource { source_id },
                ModelLineage::NativeIfcSource(lineage),
            ) => source_id == &lineage.source_id,
            _ => false,
        },
        "entry target namespace must match its actual source owner",
    )?;
    require(
        uuid(&value.native_audit_id) && text(&value.change_reason),
        "audit anchor and change reason required",
    )?;
    require(
        value.inputs.len() <= MAX_LINKS
            && value.evidence.len() <= MAX_LINKS
            && value.supersedes.len() <= MAX_LINKS
            && value.contradicts.len() <= MAX_LINKS
            && value.resolutions.len() <= MAX_LINKS,
        "too many assertion links",
    )?;
    require(
        value.previous.is_some() == (value.version.revision > 1),
        "missing or unexpected predecessor",
    )?;
    if let Some(previous) = &value.previous {
        validate_version(previous)?;
        require(
            previous.assertion_id == value.version.assertion_id
                && previous.revision + 1 == value.version.revision,
            "predecessor must be the prior revision of the same assertion",
        )?;
    }
    match &value.review {
        ClaimReview::NoKnownIssue => {}
        ClaimReview::Ambiguous(reason) | ClaimReview::Inconsistent(reason) => {
            require(text(reason), "review reason required")?;
        }
    }
    validate_support(&value.support)?;
    check_method(value.method, &value.support)?;
    if matches!(
        value.method,
        MeasurementMethod::Derived | MeasurementMethod::Imported
    ) {
        require(
            !value.inputs.is_empty() && value.operation.as_ref().is_some_and(|s| text(s)),
            "derivation/import needs pinned inputs and a named operation",
        )?;
    } else {
        require(
            value.inputs.is_empty() && value.operation.is_none(),
            "acquisition with transformed inputs must declare derived/imported method",
        )?;
    }
    for (index, input) in value.inputs.iter().enumerate() {
        require(
            !value.inputs[..index]
                .iter()
                .any(|other| other.pin == input.pin),
            "duplicate input pin",
        )?;
        require(
            !input.methods.is_empty()
                && input.methods.len() <= 8
                && input
                    .methods
                    .iter()
                    .enumerate()
                    .all(|(at, method)| !input.methods[..at].contains(method)),
            "input acquisition methods required without duplicates",
        )?;
        validate_support(&input.support)?;
        for method in &input.methods {
            check_method(*method, &input.support)?;
        }
        // Derived/imported alone describes a transformation, not its support.
        require(
            input.methods.iter().any(|method| {
                !matches!(
                    method,
                    MeasurementMethod::Derived | MeasurementMethod::Imported
                )
            }) || input
                .support
                .limitations
                .contains(&SupportLimitation::ImportedUnqualified),
            "input must retain acquisition method or explicit unqualified import",
        )?;
        inherits(&value.support, &input.support)?;
        match &input.pin {
            InputPin::Assertion(pin) => validate_version(pin)?,
            InputPin::Model(pin) => {
                validate_model(pin)?;
                require(same_scope(&value.target, pin), "cross-scope model input")?;
            }
            InputPin::Native(pin) => {
                validate_native(pin)?;
                require(
                    matches!(
                        pin.record.record_type,
                        RecordType::Asset | RecordType::GeodataDocument | RecordType::Evidence
                    ),
                    "native inputs must be evidence, documents or assets; geometry needs full model pins",
                )?;
            }
        }
    }
    for (index, link) in value.evidence.iter().enumerate() {
        validate_native(&link.evidence)?;
        require(
            link.evidence.record.record_type == RecordType::Evidence,
            "evidence links must reference native evidence",
        )?;
        require(
            !value.evidence[..index]
                .iter()
                .any(|other| other.evidence == link.evidence),
            "duplicate evidence reference",
        )?;
    }
    for links in [&value.supersedes, &value.contradicts] {
        require(
            links.iter().collect::<BTreeSet<_>>().len() == links.len(),
            "duplicate assertion link",
        )?;
        for link in links {
            validate_version(link)?;
            require(
                link.assertion_id != value.version.assertion_id,
                "use predecessor for own revisions; no self supersession/contradiction",
            )?;
        }
    }
    require(
        !value
            .supersedes
            .iter()
            .any(|link| value.contradicts.contains(link)),
        "a revision cannot both supersede and contradict the same revision",
    )?;
    for (index, resolution) in value.resolutions.iter().enumerate() {
        require(
            !value.resolutions[..index]
                .iter()
                .any(|other| other.contradiction == resolution.contradiction),
            "duplicate contradiction resolution",
        )?;
        validate_version(raised_by(&resolution.contradiction))?;
        match &resolution.contradiction {
            ContradictionRef::Assertions { against, .. } => validate_version(against)?,
            ContradictionRef::Evidence { evidence, .. } => {
                validate_native(evidence)?;
                require(
                    evidence.record.record_type == RecordType::Evidence,
                    "invalid contradiction evidence",
                )?;
            }
        }
        let heads = resolution_heads(value, resolution);
        require(
            !heads.is_empty()
                && heads.len() <= MAX_HISTORY
                && heads.iter().collect::<BTreeSet<_>>().len() == heads.len()
                && resolution
                    .reviewed_heads
                    .contains(&ReviewedHead::ThisRevision),
            "resolution needs exact reviewed heads including this revision",
        )?;
        for head in &resolution.reviewed_heads {
            if let ReviewedHead::Existing(version) = head {
                validate_version(version)?;
                require(
                    version.assertion_id != value.version.assertion_id
                        || version.revision != value.version.revision,
                    "use ThisRevision to avoid a recursive self-digest",
                )?;
            }
        }
        validate_native(&resolution.review_evidence)?;
        require(
            resolution.review_evidence.record.record_type == RecordType::Evidence
                && uuid(&resolution.native_audit_id)
                && text(&resolution.reason),
            "resolution needs review evidence, audit and reason",
        )?;
    }
    Ok(())
}

pub(super) fn same_measurement(a: &MeasurementAssertion, b: &MeasurementAssertion) -> bool {
    a.target == b.target && a.property == b.property
}

/// Complete, append-ordered history for this evaluation scope. Every referenced
/// assertion must occur earlier, preventing cycles and missing predecessors.
/// Native ownership must establish completeness and digest/audit authenticity.
pub fn validate_history(rows: &[MeasurementAssertion]) -> ValidationResult<()> {
    require(
        rows.len() <= MAX_HISTORY,
        "history bound exceeded; do not truncate for closure",
    )?;
    let mut retired = BTreeSet::new();
    for (index, row) in rows.iter().enumerate() {
        validate_assertion(row)?;
        let before = &rows[..index];
        require(
            !before.iter().any(|old| {
                old.version.assertion_id == row.version.assertion_id
                    && old.version.revision == row.version.revision
            }),
            "duplicate or mutated immutable revision",
        )?;
        if let Some(previous) = &row.previous {
            let old = before
                .iter()
                .find(|old| &old.version == previous)
                .ok_or(ValidationError("missing exact predecessor"))?;
            require(
                !retired.contains(previous) && same_measurement(row, old),
                "stale predecessor or silent semantic retarget",
            )?;
            retired.insert(previous.clone());
        }
        for link in row.supersedes.iter().chain(&row.contradicts) {
            let old = before
                .iter()
                .find(|old| &old.version == link)
                .ok_or(ValidationError("missing exact historical assertion link"))?;
            require(
                same_measurement(row, old),
                "correction/contradiction must concern the same semantic measurement",
            )?;
            if row.supersedes.contains(link) {
                require(
                    !retired.contains(link),
                    "cannot silently supersede a stale revision",
                )?;
            }
        }
        for input in &row.inputs {
            if let InputPin::Assertion(pin) = &input.pin {
                let source = before
                    .iter()
                    .find(|source| &source.version == pin)
                    .ok_or(ValidationError("missing pinned derivation assertion"))?;
                require(
                    source.target.scope == row.target.scope
                        && source.target.building_id == row.target.building_id,
                    "cross-scope assertion input",
                )?;
                inherits(&input.support, &source.support)?;
                require(
                    input.support.corroboration == source.support.corroboration,
                    "pinned input corroboration must retain its source assessment",
                )?;
                require(
                    input.methods.contains(&source.method)
                        && source
                            .inputs
                            .iter()
                            .flat_map(|parent| &parent.methods)
                            .all(|method| input.methods.contains(method)),
                    "derivation must retain transitive acquisition methods",
                )?;
            }
        }
        for resolution in &row.resolutions {
            require(
                historical_contradictions(before).contains(&resolution.contradiction),
                "resolution must identify an existing exact historical contradiction",
            )?;
            let origin = before
                .iter()
                .find(|old| old.version == *raised_by(&resolution.contradiction))
                .ok_or(ValidationError("missing contradiction origin"))?;
            require(
                same_measurement(row, origin),
                "resolution belongs to another measurement",
            )?;
            let affected = affected_heads(&rows[..=index], &resolution.contradiction);
            require(
                same_versions(&resolution_heads(row, resolution), &affected),
                "resolution must identify all exact active successor heads under review",
            )?;
        }
        retired.extend(row.supersedes.iter().cloned());
    }
    Ok(())
}

/// Retains all historical objects; returns borrowed active heads only.
pub fn active_assertions(
    rows: &[MeasurementAssertion],
) -> ValidationResult<Vec<&MeasurementAssertion>> {
    validate_history(rows)?;
    Ok(active_unchecked(rows))
}

fn active_unchecked(rows: &[MeasurementAssertion]) -> Vec<&MeasurementAssertion> {
    let retired: BTreeSet<_> = rows
        .iter()
        .flat_map(|row| row.previous.iter().chain(&row.supersedes))
        .cloned()
        .collect();
    rows.iter()
        .filter(|row| !retired.contains(&row.version))
        .collect()
}

pub(super) fn raised_by(contradiction: &ContradictionRef) -> &AssertionVersion {
    match contradiction {
        ContradictionRef::Assertions { raised_by, .. }
        | ContradictionRef::Evidence { raised_by, .. } => raised_by,
    }
}

/// Original dispute references survive retirement of either endpoint. Each
/// revision that raises a dispute remains independently identifiable.
pub(super) fn historical_contradictions(rows: &[MeasurementAssertion]) -> Vec<ContradictionRef> {
    rows.iter()
        .flat_map(|row| {
            row.contradicts
                .iter()
                .map(move |against| ContradictionRef::Assertions {
                    raised_by: row.version.clone(),
                    against: against.clone(),
                })
                .chain(
                    row.evidence
                        .iter()
                        .filter(|link| link.role == EvidenceRole::Contradicts)
                        .map(move |link| ContradictionRef::Evidence {
                            raised_by: row.version.clone(),
                            evidence: link.evidence.clone(),
                        }),
                )
        })
        .collect()
}

fn descends_from(
    rows: &[MeasurementAssertion],
    head: &AssertionVersion,
    root: &AssertionVersion,
) -> bool {
    let mut pending = vec![head.clone()];
    let mut visited = BTreeSet::new();
    while let Some(version) = pending.pop() {
        if &version == root {
            return true;
        }
        if !visited.insert(version.clone()) {
            continue;
        }
        if let Some(row) = rows.iter().find(|row| row.version == version) {
            pending.extend(row.previous.iter().chain(&row.supersedes).cloned());
        }
    }
    false
}

pub(super) fn affected_heads(
    rows: &[MeasurementAssertion],
    contradiction: &ContradictionRef,
) -> Vec<AssertionVersion> {
    active_unchecked(rows)
        .into_iter()
        .filter(|row| {
            descends_from(rows, &row.version, raised_by(contradiction))
                || match contradiction {
                    ContradictionRef::Assertions { against, .. } => {
                        descends_from(rows, &row.version, against)
                    }
                    ContradictionRef::Evidence { .. } => false,
                }
        })
        .map(|row| row.version.clone())
        .collect()
}

pub(super) fn same_versions(a: &[AssertionVersion], b: &[AssertionVersion]) -> bool {
    a.iter().collect::<BTreeSet<_>>() == b.iter().collect::<BTreeSet<_>>()
}

pub(super) fn resolution_heads(
    owner: &MeasurementAssertion,
    resolution: &ReviewedContradictionResolution,
) -> Vec<AssertionVersion> {
    resolution
        .reviewed_heads
        .iter()
        .map(|head| match head {
            ReviewedHead::ThisRevision => owner.version.clone(),
            ReviewedHead::Existing(version) => version.clone(),
        })
        .collect()
}
