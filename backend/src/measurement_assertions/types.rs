use crate::contracts::v2::{RecordRef, Scope, Uncertainty};

use super::{ExactQuantity, QuantityKind};

/// These are internal Rust contracts, not additions to the frozen wire schema.
/// Native record/evidence/audit owners retain authority and original bytes.
#[derive(Debug, Clone, PartialEq)]
pub struct NativeRevision {
    pub record: RecordRef,
    pub revision: u64,
    pub payload_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct AssertionVersion {
    pub assertion_id: String,
    pub revision: u64,
    /// Integration must compute this from the immutable assertion payload
    /// excluding this self-digest, then verify it against retained native bytes.
    pub payload_sha256: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ModelPin {
    pub scope: Scope,
    pub building_id: String,
    pub publication_id: String,
    pub artifact_id: String,
    pub artifact_sha256: String,
    pub artifact_bytes: u64,
    pub lineage: ModelLineage,
    pub custody: ModelCustody,
    pub physical_registration: PhysicalRegistration,
}

/// Distinct source owners have distinct contracts. Do not manufacture native
/// source/asset/map UUIDs for the existing source-owned GLB publication.
#[derive(Debug, Clone, PartialEq)]
pub enum ModelLineage {
    UnifiedAtlasPublication {
        source_revision_id: String,
        source_sha256: String,
        semantics_sha256: String,
        overview_manifest_sha256: String,
        selection_revision: String,
    },
    NativeIfcSource(NativeIfcLineage),
}

#[derive(Debug, Clone, PartialEq)]
pub struct NativeIfcLineage {
    pub source_id: String,
    pub source_revision_id: String,
    pub source_revision_sha256: String,
    pub source_asset_id: String,
    pub source_sha256: String,
    pub publication_sha256: String,
    pub semantic_map_revision_id: String,
    pub semantic_map_sha256: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ModelCustody {
    Unknown,
    NativeRecords {
        geometry: NativeRevision,
        association: NativeRevision,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum PhysicalRegistration {
    Unknown,
    /// Documentary claim requiring independent native verification, not proof
    /// minted by this enum. Null current-publication registration maps to Unknown.
    Reviewed {
        evidence: NativeRevision,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SemanticNamespace {
    /// Current producer IDs are qualified by their exact publication, not
    /// silently promoted into stable native identities across publications.
    ProducerPublication {
        publication_id: String,
    },
    NativeSource {
        source_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SemanticFeature {
    Room,
    /// Stable source-owned semantic IDs from a reviewed export, not ordinals.
    Wall {
        wall_id: String,
        endpoint_ids: [String; 2],
    },
    Opening {
        opening_id: String,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct SemanticTarget {
    pub scope: Scope,
    pub namespace: SemanticNamespace,
    pub building_id: String,
    pub room_id: String,
    pub floor_id: String,
    /// Opaque source occurrence key; it is not a wall identity.
    pub occurrence_id: String,
    pub feature: SemanticFeature,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeasurementProperty {
    /// Horizontal projected occurrence floor area, subtracting holes.
    OccurrenceArea,
    /// Full projected boundary length, including hole boundaries.
    OccurrencePerimeter,
    /// Minimum vertical finished-floor to finished-ceiling clearance. A model
    /// without those semantic faces cannot provide a qualified observation.
    RoomClearHeight,
    /// Horizontal straight distance between the pinned semantic endpoints.
    /// Curved walls need a separate property and are not silently straightened.
    WallLength,
    /// Minimum finished clear passage width, not rough/structural opening size.
    OpeningWidth,
    /// Minimum finished vertical passage clearance.
    OpeningHeight,
}

impl MeasurementProperty {
    pub fn kind(self) -> QuantityKind {
        match self {
            Self::OccurrenceArea => QuantityKind::Area,
            _ => QuantityKind::Length,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeasurementMethod {
    Guessed,
    Estimated,
    /// An explicitly authenticated personal report, not reviewed direct evidence.
    UserReportedMeasured,
    DirectlyMeasured,
    PhotoFitted,
    Derived,
    Imported,
    /// Historical human entry with no recorded acquisition method. Never
    /// migrate this to DirectlyMeasured merely because a person entered it.
    LegacyUserReportedMethodUnspecified,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum SupportLimitation {
    Guessed,
    Estimated,
    PhotoFitted,
    InferredMesh,
    MethodUnspecified,
    ImportedUnqualified,
    UserReportedMeasurement,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MeasurementSupport {
    pub corroboration: Corroboration,
    /// Retain distinct native components verbatim. No total order is imposed
    /// on supported/inferred/unknown/disputed/withdrawn/superseded snapshots.
    /// The last two remain native evidence facts, not assertion retirement.
    pub uncertainties: Vec<Uncertainty>,
    pub limitations: Vec<SupportLimitation>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Corroboration {
    NotEstablished,
    Corroborated,
}

#[derive(Debug, Clone, PartialEq)]
pub enum InputPin {
    Assertion(AssertionVersion),
    Model(Box<ModelPin>),
    /// Imported dimensions may come from an existing native document/asset.
    Native(NativeRevision),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProvenanceInput {
    pub pin: InputPin,
    /// Includes underlying acquisition methods, not just the final operation.
    pub methods: Vec<MeasurementMethod>,
    pub support: MeasurementSupport,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvidenceRole {
    Supports,
    Contradicts,
    Context,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EvidenceLink {
    pub evidence: NativeRevision,
    pub role: EvidenceRole,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClaimReview {
    NoKnownIssue,
    Ambiguous(String),
    Inconsistent(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum ContradictionRef {
    Assertions {
        raised_by: AssertionVersion,
        against: AssertionVersion,
    },
    Evidence {
        raised_by: AssertionVersion,
        evidence: NativeRevision,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReviewedHead {
    /// Resolves to the enclosing assertion version after its digest is computed;
    /// avoids embedding an impossible recursive self-payload digest.
    ThisRevision,
    Existing(AssertionVersion),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReviewedContradictionResolution {
    pub contradiction: ContradictionRef,
    /// Exact active successor heads covered by this review. A later revision
    /// invalidates applicability; removing a link or superseding a claim does
    /// not resolve the historical dispute by itself.
    pub reviewed_heads: Vec<ReviewedHead>,
    pub reason: String,
    pub review_evidence: NativeRevision,
    pub native_audit_id: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MeasurementAssertion {
    pub version: AssertionVersion,
    pub previous: Option<AssertionVersion>,
    pub target: SemanticTarget,
    pub property: MeasurementProperty,
    pub value: ExactQuantity,
    /// Model in which this target was resolved when the assertion was entered.
    pub entered_against: ModelPin,
    pub target_feature_sha256: String,
    pub method: MeasurementMethod,
    pub support: MeasurementSupport,
    pub inputs: Vec<ProvenanceInput>,
    /// E.g. outline area, import or fitting operation; never a geometry command.
    pub operation: Option<String>,
    pub evidence: Vec<EvidenceLink>,
    pub supersedes: Vec<AssertionVersion>,
    pub contradicts: Vec<AssertionVersion>,
    pub resolutions: Vec<ReviewedContradictionResolution>,
    pub review: ClaimReview,
    pub change_reason: String,
    /// Reference to the existing native audited revision owner, not a new audit
    /// log. Syntax validation here cannot establish that this audit exists.
    pub native_audit_id: String,
}
