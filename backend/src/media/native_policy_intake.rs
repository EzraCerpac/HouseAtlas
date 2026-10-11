//! Explicit administrative admission for offline historical Media validation.
//! Approval is an independent startup input, never inferred from a reference
//! file, candidate archive, restored SQL image or browser session. This owner
//! grants no mutation, restore, replay, dispatch, disclosure or queued liability.
//! Capture, revalidation and generation reads perform bounded filesystem reads
//! and must finish before entering Storage callbacks. Only the later native
//! ReadOwner's already-authenticated complete catalog supplies pure offline
//! Storage evidence; this intake authority is not a Storage callback peer.
use std::sync::Arc;

use super::{
    MediaError, MediaResult, WorkBudget,
    native_policy_archive::{
        NativeMediaArchiveBinding, NativeMediaArchiveExpectedMember, NativeMediaArchiveGeneration,
    },
    native_policy_reference::{
        NativeMediaPolicyReferenceSelection, NativeMediaPolicyReferenceStore,
    },
    recovery_policy_archive::MAX_MEDIA_POLICY_ARCHIVE_MEMBERS,
};

/// Records explicit independently approved historical configuration over the
/// actual current Store binding, candidate destination, retention scopes,
/// origin, independent reference descriptor, selected audit and complete exact
/// expected bytes. Construction only records facts and checks their mechanical
/// consistency: it does not authenticate an operator or release any gate.
///
/// Only trusted startup may call this after authentic administrative approval
/// obtained outside this component. Expected members MUST be supplied from that
/// separately approved complete preimage, in canonical ascending name order;
/// candidate scans, reference read_data, SQL rows, guessed paths/hashes or actor
/// identifiers must not manufacture that approval. No approval is configured
/// by default and no live producer qualification is reconstructed here.
pub struct NativeMediaHistoricalApproval {
    binding: Arc<NativeMediaArchiveBinding>,
    reference: Arc<NativeMediaPolicyReferenceStore>,
    selection: NativeMediaPolicyReferenceSelection,
    expected: NativeMediaArchiveGeneration,
}

impl NativeMediaHistoricalApproval {
    pub fn from_independently_approved_configuration(
        binding: Arc<NativeMediaArchiveBinding>,
        reference: Arc<NativeMediaPolicyReferenceStore>,
        selection: NativeMediaPolicyReferenceSelection,
        independently_expected_members: Vec<NativeMediaArchiveExpectedMember>,
        budget: &WorkBudget,
    ) -> MediaResult<Self> {
        budget.check()?;
        if binding.origin() != selection.origin()
            || independently_expected_members.is_empty()
            || independently_expected_members.len() > MAX_MEDIA_POLICY_ARCHIVE_MEMBERS
        {
            return Err(MediaError::InvalidInput);
        }
        // Preserve the complete independent ordering; do not accept a subset,
        // duplicates, reordered input or derive expected bytes from a file read.
        let mut previous: Option<&str> = None;
        let selected_member = format!("{}.media-policy.json", selection.audit_id());
        let mut contains_selected_audit = false;
        for member in &independently_expected_members {
            budget.check()?;
            if previous.is_some_and(|name| name >= member.name()) {
                return Err(MediaError::InvalidInput);
            }
            previous = Some(member.name());
            contains_selected_audit |= member.name() == selected_member;
        }
        if !contains_selected_audit {
            return Err(MediaError::InvalidInput);
        }
        let expected = NativeMediaArchiveGeneration::from_trusted_configuration(
            &binding,
            independently_expected_members,
            budget,
        )?;
        budget.check()?;
        Ok(Self {
            binding,
            reference,
            selection,
            expected,
        })
    }
}

// Distinct private allocation per construction. The grant retains the same
// immutable approved preimage and descriptor/binding allocations; equal labels,
// independently reopened descriptors or a new authority cannot rebind it.
struct HistoricalIssuer {
    approval: Option<NativeMediaHistoricalApproval>,
}

/// Concrete offline historical intake owner. Default is disabled. Keep this
/// issuer outside the source Core while it is used for validation; it retains
/// the actual candidate/reference descriptor owners and Store identity token,
/// not a SQL connection, vault, Access connection or browser grant. Explicit
/// administrative approval remains an authentic external startup requirement.
pub struct NativeMediaHistoricalAuthority {
    issuer: Arc<HistoricalIssuer>,
}

impl Default for NativeMediaHistoricalAuthority {
    fn default() -> Self {
        Self {
            issuer: Arc::new(HistoricalIssuer { approval: None }),
        }
    }
}

/// Opaque non-Clone, nonserializable historical validation grant. Only its
/// enabled original issuer can mint it after the independent descriptor matches
/// the complete explicit approved preimage. It grants no live producer lineage,
/// Store completion, Access grant, output disclosure or recovery execution.
pub struct NativeMediaHistoricalGrant {
    issuer: Arc<HistoricalIssuer>,
}

impl NativeMediaHistoricalAuthority {
    pub fn from_trusted_administrative_approval(approval: NativeMediaHistoricalApproval) -> Self {
        Self {
            issuer: Arc::new(HistoricalIssuer {
                approval: Some(approval),
            }),
        }
    }

    /// Capture only after exact allocation/selection checks and a full stable
    /// independent descriptor match against the complete approved expected bytes.
    /// Performs bounded filesystem I/O; run before entering a Storage callback.
    pub fn capture_expected(
        &self,
        binding: &Arc<NativeMediaArchiveBinding>,
        reference: &Arc<NativeMediaPolicyReferenceStore>,
        selection: &NativeMediaPolicyReferenceSelection,
        budget: &WorkBudget,
    ) -> MediaResult<NativeMediaHistoricalGrant> {
        let approval = self.checked_approval(binding, reference, selection, budget)?;
        reference.match_expected_generation(selection, &approval.expected, budget)?;
        budget.check()?;
        Ok(NativeMediaHistoricalGrant {
            issuer: Arc::clone(&self.issuer),
        })
    }

    /// Revalidate original issuer and approved allocations, complete selection
    /// and all independently expected member bytes through actual stable custody.
    /// New allocations with equal configuration are not the original approved
    /// owners. No provider/SQL/Access reentry or automatic origin adoption occurs.
    /// Performs bounded filesystem I/O; run before entering a Storage callback.
    pub fn revalidate(
        &self,
        grant: &NativeMediaHistoricalGrant,
        binding: &Arc<NativeMediaArchiveBinding>,
        reference: &Arc<NativeMediaPolicyReferenceStore>,
        selection: &NativeMediaPolicyReferenceSelection,
        budget: &WorkBudget,
    ) -> MediaResult<()> {
        budget.check()?;
        if !Arc::ptr_eq(&self.issuer, &grant.issuer) {
            return Err(MediaError::Forbidden);
        }
        let approval = self.checked_approval(binding, reference, selection, budget)?;
        reference.match_expected_generation(selection, &approval.expected, budget)?;
        budget.check()
    }

    /// Emit only the complete independent configuration preimage after original
    /// grant/descriptor revalidation. Decoded reference DATA never becomes this
    /// generation. The existing native ReadOwner must still authenticate the
    /// actual complete candidate catalog before any offline frame validation.
    /// This generation has no fresh producer lineage and cannot mint a capture.
    /// Performs bounded filesystem I/O; run before entering a Storage callback.
    pub fn read_generation(
        &self,
        grant: &NativeMediaHistoricalGrant,
        binding: &Arc<NativeMediaArchiveBinding>,
        reference: &Arc<NativeMediaPolicyReferenceStore>,
        selection: &NativeMediaPolicyReferenceSelection,
        budget: &WorkBudget,
    ) -> MediaResult<NativeMediaArchiveGeneration> {
        self.revalidate(grant, binding, reference, selection, budget)?;
        let approval = self.checked_approval(binding, reference, selection, budget)?;
        let generation = approval.expected.clone();
        budget.check()?;
        Ok(generation)
    }

    fn checked_approval<'a>(
        &'a self,
        binding: &Arc<NativeMediaArchiveBinding>,
        reference: &Arc<NativeMediaPolicyReferenceStore>,
        selection: &NativeMediaPolicyReferenceSelection,
        budget: &WorkBudget,
    ) -> MediaResult<&'a NativeMediaHistoricalApproval> {
        budget.check()?;
        let approval = self
            .issuer
            .approval
            .as_ref()
            .ok_or(MediaError::Unavailable)?;
        if !Arc::ptr_eq(binding, &approval.binding)
            || !Arc::ptr_eq(reference, &approval.reference)
            || selection.member_name() != approval.selection.member_name()
            || selection.origin() != approval.selection.origin()
            || binding.origin() != approval.selection.origin()
        {
            return Err(MediaError::Forbidden);
        }
        Ok(approval)
    }
}
