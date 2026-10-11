//! Additional mandatory authorization for complete native objects at the actual
//! codec /3 carrier, independently of latest user disclosure. No default policy.
use crate::{providers::homebox::recovery as codec, storage};

pub trait NativeArchiveAuthorization<P: storage::StockActivityPrincipal>:
    storage::StockActivityRetentionAuthorization<P>
{
    /// Qualify every raw field, historical/preflight prefix and the configured
    /// private archive destination. Synchronous; no storage/state reentry or I/O.
    fn authorize_archive(
        &self,
        destination: &super::archive::ArchiveDestination,
        producer: &storage::StockActivityProducer<P>,
        native: Option<&codec::RetainedNativeStockActivity<P>>,
    ) -> Result<(), crate::providers::homebox::write::stock::StockPortFault>;
}
