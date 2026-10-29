use super::*;

impl Write for FactBudget<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.budget.check().map_err(std::io::Error::other)?;
        if bytes.len() > MAX_ORIGINAL_FACT_BYTES.saturating_sub(self.bytes) {
            return Err(std::io::Error::other(MediaError::TooLarge));
        }
        self.bytes += bytes.len();
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl FactBudget<'_> {
    pub(super) fn partition(&mut self, partition: &jobs::SourcePartition) -> MediaResult<()> {
        self.json(&(
            partition.workspace_id.as_str(),
            partition.home_id.as_str(),
            partition.source_instance_id.as_str(),
            partition.collection_id.as_str(),
        ))
    }
    pub(super) fn selection(&mut self, selection: &jobs::ScopeSelection) -> MediaResult<()> {
        match selection {
            jobs::ScopeSelection::Collection => self.json("Collection"),
            jobs::ScopeSelection::Resources(resources) => {
                self.json("Resources")?;
                for resource in resources {
                    self.budget.check()?;
                    let kind = match resource.kind {
                        jobs::ResourceKind::Entity => "Entity",
                        jobs::ResourceKind::Location => "Location",
                        jobs::ResourceKind::Tag => "Tag",
                        jobs::ResourceKind::Template => "Template",
                        jobs::ResourceKind::EntityType => "EntityType",
                        jobs::ResourceKind::Field => "Field",
                        jobs::ResourceKind::File => "File",
                        jobs::ResourceKind::Maintenance => "Maintenance",
                    };
                    self.json(&(kind, resource.id.as_str()))?;
                }
                Ok(())
            }
        }
    }
    pub(super) fn json<T: Serialize + ?Sized>(&mut self, value: &T) -> MediaResult<()> {
        self.budget.check()?;
        serde_json::to_writer(&mut *self, value).map_err(|_| MediaError::TooLarge)?;
        self.budget.check()
    }
    pub(super) fn preflight(&mut self, preflight: &native::StockPreflight) -> MediaResult<()> {
        if preflight.preparation.snapshots.len() != 1
            || !preflight.preparation.native_clear_values.is_empty()
        {
            return Err(MediaError::InvalidInput);
        }
        let snapshot = &preflight.preparation.snapshots[0];
        self.json(&(
            &snapshot.target,
            &snapshot.value,
            &snapshot.digest,
            snapshot.complete,
            snapshot.hidden_fields_preserved,
            &preflight.preparation.staged_upload,
            preflight.provider_observation,
            &preflight.request_digest,
            preflight.source_epoch,
            &preflight.preflight_digest,
        ))
    }
    pub(super) fn queue_config(&mut self, config: &jobs::QueueConfig) -> MediaResult<()> {
        if config.registration.aliases.len() > MAX_QUEUE_ALIASES {
            return Err(MediaError::TooLarge);
        }
        let identity = &config.registration.identity;
        let profile = &config.admission_profile;
        // Native/queue digest constructors already strictly bound those fields.
        let qualification = match &profile.qualification {
            jobs::ProfileQualification::OfflineEngineeringFixture => "offline-engineering-fixture",
            jobs::ProfileQualification::QualifiedDeployment { evidence_digest } => {
                evidence_digest.as_hex()
            }
        };
        self.json(&(
            identity.deployment_id.as_str(),
            identity.physical_database_id.as_str(),
            identity.configuration_digest.as_hex(),
            config.registration.dispatcher_owner_id.as_str(),
            config.lease_duration_ms,
            config.retry.max_attempts,
            config.retry.initial_delay_ms,
            config.retry.max_delay_ms,
            profile.profile_version.as_str(),
            qualification,
            profile.max_waiting_intents,
            profile.max_admission_wait_ms,
            profile.max_unresolved_storage_attempts,
            profile.max_unresolved_storage_bytes,
        ))?;
        for alias in &config.registration.aliases {
            self.budget.check()?;
            self.json(&(
                alias.partition.workspace_id.as_str(),
                alias.partition.home_id.as_str(),
                alias.partition.source_instance_id.as_str(),
                alias.partition.collection_id.as_str(),
                alias.canonical_collection_id.as_str(),
            ))?;
        }
        Ok(())
    }
}
