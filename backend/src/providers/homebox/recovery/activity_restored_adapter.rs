//! Qualification from independently authenticated original archive bytes only.
use super::{
    NativeWriterContracts, activity_archive::*, activity_validation, incompatible, unavailable,
};
use crate::{providers::homebox::write::stock as n, storage as s};

pub struct HomeboxRestoredStockActivityEvidence<'a, 'o, A, E> {
    contracts: &'a NativeWriterContracts,
    archive: &'a RestoredNativeActivityArchive<'o, A>,
    original_evidence: &'a E,
}
impl<'a, 'o, A: NativeActivityArchiveReadAuthorization, E: s::StockActivityRecoveryEvidence>
    HomeboxRestoredStockActivityEvidence<'a, 'o, A, E>
{
    pub fn new(
        contracts: &'a NativeWriterContracts,
        archive: &'a RestoredNativeActivityArchive<'o, A>,
        original_evidence: &'a E,
    ) -> Self {
        Self {
            contracts,
            archive,
            original_evidence,
        }
    }
    pub fn codec(&self) -> &'static str {
        ACTIVITY_NATIVE_ARCHIVE_CODEC_V4
    }
}
impl<A: NativeActivityArchiveReadAuthorization, E: s::StockActivityRecoveryEvidence>
    s::StockActivityRecoveryEvidence for HomeboxRestoredStockActivityEvidence<'_, '_, A, E>
{
    fn validate_record(&self, record: &s::RetainedStockActivity) -> s::Result<()> {
        let archived = self.archive.retained(record.operation().operation_id)?;
        archived.revalidate(self.contracts)?;
        if !archived.cut().matches_record(record) {
            return Err(incompatible());
        }
        activity_validation::validate_prefix(
            self.contracts,
            record,
            record.events(),
            &archived.cut().native,
        )?;
        self.original_evidence.validate_record(record)
    }
    fn validate_event(&self, frame: s::StockActivityRecoveryEvent<'_>) -> s::Result<()> {
        let archived = self
            .archive
            .retained(frame.event.operation().operation_id)?;
        archived.revalidate(self.contracts)?;
        let cut = archived.cut();
        let index = cut
            .events()
            .iter()
            .position(|e| e.sequence() == frame.event.sequence())
            .ok_or_else(unavailable)?;
        let count = index.checked_add(1).ok_or_else(incompatible)?;
        let prefix = cut.events().get(..count).ok_or_else(incompatible)?;
        let permit = prefix.iter().find_map(|e| match e.facts() {
            s::StockActivityEventFacts::Admit(c) => Some(&c.permit),
            _ => None,
        });
        let hold = matches!(
            frame.event.operation().outcome.remote_activity,
            n::RemoteActivity::Active { .. } | n::RemoteActivity::EndUnproven { .. }
        );
        if frame.registration != cut.registration()
            || frame.original != cut.original()
            || !cut.matches_event(index, frame.event)
            || frame.prefix.len() != count
            || !frame
                .prefix
                .iter()
                .enumerate()
                .all(|(i, e)| cut.matches_event(i, e))
            || match (frame.previous, index.checked_sub(1)) {
                (None, None) => false,
                (Some(e), Some(i)) => !cut.matches_event(i, e),
                _ => true,
            }
            || frame.permit != permit
            || frame.body_accepted != permit.is_some()
            || frame.physical_hold != hold
        {
            return Err(incompatible());
        }
        activity_validation::validate_event_prefix(
            self.contracts,
            cut.registration(),
            prefix,
            &cut.native,
        )?;
        // Original effect/media qualification sees only its own historical cut.
        self.original_evidence.validate_event(frame)
    }
}
