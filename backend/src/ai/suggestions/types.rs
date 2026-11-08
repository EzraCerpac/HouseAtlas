use crate::{contracts::stock::{StockContext, StockTarget}, domain::RecordRef};
use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u8 = 1;
pub const MAX_OUTPUT_BYTES: usize = 65_536;

/// Supplied by the original read/access owner, never by generated output.
/// Version is the owner's exact revision/ETag/snapshot identity, not a date.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInput {
    pub input_ref: String,
    pub target: StockTarget,
    pub version: String,
    pub source_date: Option<String>,
    pub retrieved_at: String,
    pub availability: Availability,
    pub role: InputRole,
    pub kind: CandidateKind,
    pub evidence: Vec<AdmittedEvidence>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Availability { Available, Unavailable, Withdrawn }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum InputRole { Subject, Candidate, Source }

/// Container deliberately includes arbitrary canonical container types.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CandidateKind { InventoryItem, Container, Document, MaintenanceTask, Other }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdmittedEvidence {
    pub evidence_ref: String,
    pub record: Option<RecordRef>,
    pub location: EvidenceLocation,
    pub basis: EvidenceBasis,
    pub excerpt: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum EvidenceBasis { Content, RecordAssertion, MetadataOnly }

/// Locations originate at retrieval. Models can cite IDs, never invent pages,
/// excerpts, URLs or original-open handles. Text ranges count Unicode scalars.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum EvidenceLocation {
    Record,
    Page { page: u32, page_count: u32 },
    TextRange { start: u32, end: u32, text_length: u32 },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInput {
    pub feature: SuggestionFeature,
    pub scope: StockContext,
    pub actor_id: String,
    pub authority_epoch: String,
    pub sources: Vec<SourceInput>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SuggestionFeature { Inventory, Document, Maintenance, Answer, Contradictions }

/// All generated JSON structs reject unknown fields; there are no tool names,
/// approval tokens, arbitrary field paths or native mutation envelopes.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GeneratedProposal {
    pub schema_version: u8,
    pub context_pin: String,
    pub subject_ref: String,
    pub claims: Vec<ExtractedClaim>,
    pub missing_evidence: Vec<String>,
    pub result: ProposalResult,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtractedClaim {
    pub claim_ref: String,
    pub source_ref: String,
    pub evidence_refs: Vec<String>,
    pub text: String,
    pub uncertainty: Uncertainty,
}

/// These are qualitative labels, never calibrated probabilities or authority.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Uncertainty { Tentative, Ambiguous, Unknown }

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Support {
    pub claim_refs: Vec<String>,
    pub rationale: String,
    pub uncertainty: Uncertainty,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum ProposalResult {
    Inventory { changes: Vec<InventoryChange>, duplicates: Vec<DuplicateCandidate> },
    Document { #[serde(deserialize_with = "required_classification")] classification: Option<DocumentClassification>, links: Vec<DocumentLink> },
    Maintenance { tasks: Vec<MaintenanceSuggestion> },
    Answer { route: QuestionRoute, ranked_refs: Vec<String>, coverage: AnswerCoverage, statements: Vec<SupportedText> },
    Contradictions { findings: Vec<Contradiction> },
}

fn required_classification<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<DocumentClassification>, D::Error> {
    Option::<DocumentClassification>::deserialize(deserializer)
}

impl ProposalResult {
    pub fn feature(&self) -> SuggestionFeature {
        match self {
            Self::Inventory { .. } => SuggestionFeature::Inventory,
            Self::Document { .. } => SuggestionFeature::Document,
            Self::Maintenance { .. } => SuggestionFeature::Maintenance,
            Self::Answer { .. } => SuggestionFeature::Answer,
            Self::Contradictions { .. } => SuggestionFeature::Contradictions,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "field", rename_all = "kebab-case", deny_unknown_fields)]
pub enum InventoryChange {
    Category { value: String, support: Support },
    Tags { values: Vec<String>, support: Support },
    Container { #[serde(rename = "candidateRef")] candidate_ref: String, support: Support },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DuplicateCandidate {
    pub candidate_ref: String,
    pub relationship: DuplicateRelationship,
    pub supporting: Support,
    pub contradicting_claim_refs: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DuplicateRelationship { PossibleSameItem, SameProductDistinctItem, Ambiguous }

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentClassification { pub category: DocumentClass, pub support: Support }

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DocumentClass { Manual, Warranty, Invoice, ElectricalDrawing, Mixed, Other, Unknown }

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentLink { pub candidate_ref: String, pub support: Support }

/// First increment intentionally represents intervals only. An invented dueDate
/// or scheduling field is rejected; a native owner needs its own known baseline.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaintenanceSuggestion {
    pub candidate_ref: String,
    pub title: String,
    pub interval: MaintenanceInterval,
    pub conditions: Vec<String>,
    pub urgency: MaintenanceUrgency,
    pub support: Support,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum MaintenanceInterval {
    Periodic { every: u32, unit: IntervalUnit },
    Conditional { condition: String },
    Unknown,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum IntervalUnit { Days, Weeks, Months, Years, UsageHours }

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum MaintenanceUrgency { Unknown, Routine, ReviewSoon }

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum QuestionRoute { Inventory, Documents, Maintenance, Electrical, Network, Clarify, Unknown }

/// No exhaustive answer can be inferred from a bounded retrieval.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AnswerCoverage { Partial, NoAnswer }

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportedText { pub text: String, pub support: Support }

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Contradiction {
    pub pattern: ContradictionPattern,
    pub claim_refs: Vec<String>,
    pub rationale: String,
    pub uncertainty: Uncertainty,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ContradictionPattern { IncompatibleLocation, ConflictingAssociation, PossibleSupersession }
