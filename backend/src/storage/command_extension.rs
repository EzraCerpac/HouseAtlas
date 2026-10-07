//! Private transaction hooks; never exported to consumers.
use super::*;
use rusqlite::Connection;

pub(crate) trait CommandExtension {
    fn stock(&self) -> bool;
    fn authorize(
        &mut self,
        facts: &MutationAuthorizationContext,
        original: &Snapshot,
        candidate: Option<&Snapshot>,
        replay: Option<&Replay>,
        actor: &VerifiedActor,
    ) -> Result<()>;
    fn admit(
        &mut self,
        db: &Connection,
        actor: &VerifiedActor,
    ) -> Result<Option<Vec<MutationResult>>>;
    fn validate_original(&self, original: &Snapshot) -> Result<()>;
    fn stage(
        &mut self,
        original: &Snapshot,
        results: &[MutationResult],
        actor: &VerifiedActor,
    ) -> Result<()>;
    fn persist(&self, db: &Connection, hashes: &[String]) -> Result<()>;
}
pub(crate) struct Core;
impl CommandExtension for Core {
    fn stock(&self) -> bool {
        false
    }
    fn authorize(
        &mut self,
        _: &MutationAuthorizationContext,
        _: &Snapshot,
        _: Option<&Snapshot>,
        _: Option<&Replay>,
        _: &VerifiedActor,
    ) -> Result<()> {
        Ok(())
    }
    fn admit(&mut self, _: &Connection, _: &VerifiedActor) -> Result<Option<Vec<MutationResult>>> {
        Ok(None)
    }
    fn validate_original(&self, _: &Snapshot) -> Result<()> {
        Ok(())
    }
    fn stage(&mut self, _: &Snapshot, _: &[MutationResult], _: &VerifiedActor) -> Result<()> {
        Ok(())
    }
    fn persist(&self, _: &Connection, _: &[String]) -> Result<()> {
        Ok(())
    }
}
