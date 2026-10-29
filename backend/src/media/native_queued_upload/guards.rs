use super::*;

pub(super) fn authorize_original(
    guard: &a::TransactionAuthorization<'_>,
    original: &RetainedPrincipal,
    source: &a::SourceGrant,
) -> MediaResult<()> {
    let principal = original.principal();
    let reference = source.reference();
    if !std::ptr::eq(guard.principal(), principal)
        || reference.key.source_kind != a::SourceKind::HomeboxEntity
        || reference.workspace_id != principal.scope().workspace_id
        || reference.home_id != principal.scope().home_id
    {
        return Err(MediaError::Forbidden);
    }
    guard.assert_mutation().map_err(access_error)?;
    guard
        .authorize(principal.scope(), a::Capability::Mutate)
        .map_err(access_error)?;
    guard.revalidate_source(source).map_err(access_error)?;
    guard
        .authorize(principal.scope(), a::Capability::ReadCacheEntity(reference))
        .map_err(access_error)?;
    guard.revalidate().map(|_| ()).map_err(access_error)
}

pub(super) fn check_metadata(metadata: &NativeQueuedUploadMetadata) -> MediaResult<()> {
    if metadata.filename.is_empty()
        || metadata.filename.chars().count() > 255
        || metadata.filename.contains("..")
        || metadata.filename.contains(['/', '\\'])
        || metadata.filename.chars().any(char::is_control)
    {
        return Err(MediaError::InvalidInput);
    }
    Ok(())
}

pub(super) fn revalidate_body(custody: &StageCustody, budget: &WorkBudget) -> MediaResult<()> {
    read_revalidated_body(custody, budget).map(|_| ())
}

pub(super) fn read_revalidated_body(
    custody: &StageCustody,
    budget: &WorkBudget,
) -> MediaResult<Vec<u8>> {
    budget.check()?;
    let body_size = usize::try_from(custody.staged.byte_size).map_err(|_| MediaError::TooLarge)?;
    if body_size == 0 || body_size > MAX_BYTES {
        return Err(MediaError::TooLarge);
    }
    let id = custody.staged.upload_token.to_string();
    let reservation =
        custody
            .owner
            .read_member(&reservation_name(&id), MAX_RESERVATION_BYTES, budget)?;
    let body = custody
        .owner
        .read_member(&body_name(&id), body_size, budget)?;
    if reservation.identity != custody.reservation_identity
        || reservation.bytes != custody.reservation_bytes
        || body.identity != custody.body_identity
        || body.bytes != custody.body_bytes
        || FileIdentity::of(&custody.body.metadata()?) != custody.body_identity
        || custody.staged.byte_size != body.bytes.len() as u64
        || custody.staged.sha256.as_str() != sha256(&body.bytes)
    {
        return Err(MediaError::Unavailable);
    }
    budget.check()?;
    Ok(body.bytes)
}
