use super::*;

pub(super) fn encode_upload_prepared(
    upload: &NativeQueuedUploadOriginal,
    storage_liability: jobs::StorageLiability,
    budget: &WorkBudget,
) -> MediaResult<s::PreparedNativeIntent> {
    let native::NativeBody::Multipart { stage, .. } = &upload.plan.request.body else {
        return Err(MediaError::Unavailable);
    };
    if stage != &upload.custody.staged || upload.ordered_impact.len() != 1 {
        return Err(MediaError::Unavailable);
    }
    let impact = &upload.ordered_impact[0];
    let snapshot = &upload.snapshot;
    let native_payload = encode_prepared_field(
        &UploadPreparedPayload {
            format: NATIVE_QUEUED_UPLOAD_PREPARED_CODEC,
            native_source_commit: native::NATIVE_SOURCE_COMMIT,
            contract_version: native::CONTRACT_VERSION,
            original_wire: &upload.command.original_wire,
            plan: &upload.plan,
        },
        budget,
    )?;
    let prepared_media_evidence = encode_prepared_field(
        &UploadPreparedMedia {
            format: QUEUED_UPLOAD_MEDIA_FORMAT,
            staged: &upload.custody.staged,
            source: &upload.source_reference,
            capture_digest: &upload.capture_digest,
            snapshot_scope: &snapshot.scope,
            snapshot_target: &snapshot.target,
            snapshot_path: &snapshot.path,
            snapshot_query: &snapshot.query,
            snapshot_observed_at: &snapshot.observed_at,
            snapshot_digest: &snapshot.digest,
            ordered_impact: [UploadPreparedImpact {
                partition: UploadPreparedPartition {
                    workspace_id: &impact.partition.workspace_id,
                    home_id: &impact.partition.home_id,
                    source_instance_id: &impact.partition.source_instance_id,
                    collection_id: &impact.partition.collection_id,
                },
                entity_id: &impact.entity_id,
                staged: &impact.staged,
                snapshot_digest: &impact.snapshot_digest,
            }],
        },
        budget,
    )?;
    Ok(s::PreparedNativeIntent {
        codec: NATIVE_QUEUED_UPLOAD_PREPARED_CODEC.into(),
        native_payload,
        prepared_media_evidence,
        storage_liability,
    })
}

impl Write for PreparedFieldWriter<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.budget.check().map_err(std::io::Error::other)?;
        if bytes.len() > MAX_PREPARED_FIELD_BYTES.saturating_sub(self.bytes.len()) {
            return Err(std::io::Error::other(MediaError::TooLarge));
        }
        self.bytes.extend_from_slice(bytes);
        self.budget.check().map_err(std::io::Error::other)?;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.budget.check().map_err(std::io::Error::other)
    }
}

fn encode_prepared_field<T: Serialize>(value: &T, budget: &WorkBudget) -> MediaResult<Vec<u8>> {
    budget.check()?;
    let mut writer = PreparedFieldWriter {
        bytes: Vec::new(),
        budget,
    };
    serde_json::to_writer(&mut writer, value).map_err(|_| MediaError::Unavailable)?;
    budget.check()?;
    Ok(writer.bytes)
}
