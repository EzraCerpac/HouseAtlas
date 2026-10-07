//! Exact profile6 evidence composition with mandatory original provenance/media.
use super::{
    NativeWriterContracts, activity_capture::*, activity_validation, incompatible, unavailable,
};
use crate::storage as s;
use std::collections::BTreeSet;
use uuid::Uuid;

pub struct RetainedNativeStockActivityArchive<P: s::StockActivityPrincipal> {
    records: Vec<ArchivedNativeStockActivity<P>>,
}
impl<P: s::StockActivityPrincipal> RetainedNativeStockActivityArchive<P> {
    pub fn new(records: Vec<ArchivedNativeStockActivity<P>>) -> s::Result<Self> {
        let mut operations = BTreeSet::new();
        let mut events = BTreeSet::new();
        for retained in &records {
            if !operations.insert(retained.producer.record().operation().operation_id)
                || retained
                    .producer
                    .record()
                    .events()
                    .iter()
                    .any(|e| !events.insert(e.sequence()))
            {
                return Err(incompatible());
            }
        }
        Ok(Self { records })
    }
    pub fn retained(&self, operation_id: Uuid) -> s::Result<&ArchivedNativeStockActivity<P>> {
        self.records
            .iter()
            .find(|r| r.producer.record().operation().operation_id == operation_id)
            .ok_or_else(unavailable)
    }
}
/// The mandatory original evidence peer is the accepted Storage71 interface.
/// It qualifies original authentication, preflight/approval/media reservation
/// and each liability cut independently. Native equivalence is additionally
/// checked here against actual producer-port capture. No default success peer.
pub struct HomeboxStockActivityEvidence<'a, P: s::StockActivityPrincipal, E> {
    contracts: &'a NativeWriterContracts,
    archive: &'a RetainedNativeStockActivityArchive<P>,
    original_evidence: &'a E,
}
impl<'a, P: s::StockActivityPrincipal, E: s::StockActivityRecoveryEvidence>
    HomeboxStockActivityEvidence<'a, P, E>
{
    pub fn new(
        contracts: &'a NativeWriterContracts,
        archive: &'a RetainedNativeStockActivityArchive<P>,
        original_evidence: &'a E,
    ) -> Self {
        Self {
            contracts,
            archive,
            original_evidence,
        }
    }
    pub fn codec(&self) -> &'static str {
        ACTIVITY_NATIVE_CODEC_V3
    }
}
impl<P: s::StockActivityPrincipal, E: s::StockActivityRecoveryEvidence>
    s::StockActivityRecoveryEvidence for HomeboxStockActivityEvidence<'_, P, E>
{
    fn validate_record(&self, record: &s::RetainedStockActivity) -> s::Result<()> {
        let retained = self.archive.retained(record.operation().operation_id)?;
        if retained.producer.record() != record {
            return Err(incompatible());
        }
        activity_validation::validate_prefix(
            self.contracts,
            record,
            record.events(),
            &retained.native,
        )?;
        self.original_evidence.validate_record(record)
    }
    fn validate_event(&self, frame: s::StockActivityRecoveryEvent<'_>) -> s::Result<()> {
        let retained = self
            .archive
            .retained(frame.event.operation().operation_id)?;
        let record = retained.producer.record();
        let index = record
            .events()
            .iter()
            .position(|e| e.sequence() == frame.event.sequence())
            .ok_or_else(unavailable)?;
        let count = index.checked_add(1).ok_or_else(incompatible)?;
        let prefix = record.events().get(..count).ok_or_else(incompatible)?;
        let permit = prefix.iter().find_map(|event| match event.facts() {
            s::StockActivityEventFacts::Admit(cut) => Some(&cut.permit),
            _ => None,
        });
        let physical_hold = matches!(
            frame.event.operation().outcome.remote_activity,
            crate::providers::homebox::write::stock::RemoteActivity::Active { .. }
                | crate::providers::homebox::write::stock::RemoteActivity::EndUnproven { .. }
        );
        if frame.registration != record.registration()
            || frame.original != record.original()
            || frame.event != &record.events()[index]
            || frame.previous != index.checked_sub(1).map(|i| &record.events()[i])
            || frame.prefix != prefix
            || frame.permit != permit
            || frame.body_accepted != permit.is_some()
            || frame.physical_hold != physical_hold
        {
            return Err(incompatible());
        }
        activity_validation::validate_prefix(self.contracts, record, prefix, &retained.native)?;
        // Only this historical prefix is delegated. Later raw results, final
        // liabilities, response/readback/end facts never enter the callback.
        self.original_evidence.validate_event(frame)
    }
}
