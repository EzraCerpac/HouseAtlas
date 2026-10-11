//! Read-only owner seams for committed stage cleanup and original reuse.
use super::super::{upload_repository as upload, *};
use super::{AtlasStore, authorize, read_request, shape};
use crate::{domain::stock::StockContractPort, media::vault::PreparedOriginal};

impl<C: Contract, A: Authorization, R: Runtime> AtlasStore<C, A, R> {
    /// Return only a strict genuine committed-consumption carrier. Missing is
    /// not cleanup permission. Disclosure requires current original authority;
    /// owner maintenance after authority loss needs its own separately qualified
    /// peer, never a bypass or reconstruction of the original grant.
    pub fn committed_upload_with_authorization<B: Authorization, S: StockContractPort>(
        &mut self,
        authorization: &B,
        principal: &B::Principal,
        contracts: &S,
        scope: &Scope,
        upload_token: &str,
    ) -> Result<Option<ConsumedUpload>> {
        shape(&self.contract, "scope", scope)?;
        let actor = authorize(
            &self.contract,
            authorization,
            principal,
            read_request(scope, Capability::ReadAssetManifest, &[]),
        )?;
        let tx = self.db.transaction()?;
        let consumed = upload::load_for_token(&tx, &self.contract, contracts, scope, upload_token)?;
        let targets = consumed
            .as_ref()
            .map(|v| RecordRef {
                record_type: RecordType::Asset,
                record_id: v.asset_id().into(),
            })
            .into_iter()
            .collect::<Vec<_>>();
        let check = || -> Result<()> {
            if authorize(
                &self.contract,
                authorization,
                principal,
                read_request(scope, Capability::ReadAssetManifest, &targets),
            )? != actor
            {
                return Err(Error::new(
                    "unauthenticated",
                    "Upload query principal changed",
                ));
            }
            if authorize(
                &self.contract,
                authorization,
                principal,
                read_request(scope, Capability::ReadHistory, &targets),
            )? != actor
            {
                return Err(Error::new(
                    "unauthenticated",
                    "Upload history query principal changed",
                ));
            }
            Ok(())
        };
        check()?;
        tx.commit()?;
        check()?;
        Ok(consumed)
    }

    /// Resolve by exact authorized home and immutable original identity. This
    /// does not consume a new stage, change provenance or authorize attachment.
    /// The domain owner must bind this ID/revision into its original plan and
    /// revalidate exact references/guards in the normal mutation transaction.
    pub fn resolve_original_asset_with_authorization<B: Authorization>(
        &mut self,
        authorization: &B,
        principal: &B::Principal,
        scope: &Scope,
        prepared: &PreparedOriginal,
    ) -> Result<Option<ExistingOriginalAsset>> {
        shape(&self.contract, "scope", scope)?;
        let actor = authorize(
            &self.contract,
            authorization,
            principal,
            read_request(scope, Capability::ReadAssetManifest, &[]),
        )?;
        let tx = self.db.transaction()?;
        let existing = upload::existing_original(&tx, &self.contract, scope, prepared)?;
        let targets = existing
            .as_ref()
            .map(ExistingOriginalAsset::target)
            .into_iter()
            .collect::<Vec<_>>();
        let check = || -> Result<()> {
            if authorize(
                &self.contract,
                authorization,
                principal,
                read_request(scope, Capability::ReadAssetManifest, &targets),
            )? != actor
            {
                return Err(Error::new(
                    "unauthenticated",
                    "Original asset query principal changed",
                ));
            }
            // The carrier exposes the full record, including its audit and
            // timestamp fields, beyond the manifest payload's authority.
            if !targets.is_empty()
                && authorize(
                    &self.contract,
                    authorization,
                    principal,
                    read_request(scope, Capability::Read, &targets),
                )? != actor
            {
                return Err(Error::new(
                    "unauthenticated",
                    "Original asset record principal changed",
                ));
            }
            Ok(())
        };
        check()?;
        // Authorize the actual target before opening its retained bytes.
        if let Some(value) = &existing {
            let proof = self.runtime.verify_available_asset(value.record())?;
            if proof.sha256 != prepared.identity.sha256
                || proof.byte_size != prepared.identity.byte_size
            {
                return Err(Error::new(
                    "asset-unavailable",
                    "Original asset bytes are unavailable",
                ));
            }
        }
        check()?;
        tx.commit()?;
        check()?;
        Ok(existing)
    }
}
