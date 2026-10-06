use super::{
    AccessPort, Audit, Capability, CurrentEntry, CurrentOutput, DomainError, DomainResult,
    EntryKind, MediaCapability, ReadPort, Record, RecordRef, Scope, SemanticKind, SourceRef,
    parent_ref, project_current,
};

/// Room/item queries assemble a single current read. No cached query result or
/// provider refresh is hidden in this facade.
pub struct Queries<R, A> {
    pub store: R,
    pub access: A,
}

impl<R, A> Queries<R, A> {
    pub fn current<P>(
        &mut self,
        principal: &P,
        scope: &Scope,
        now: &str,
        media: &[MediaCapability],
    ) -> DomainResult<CurrentOutput>
    where
        R: ReadPort<P>,
        A: AccessPort<P>,
    {
        let authority = self.access.authorize(principal, scope, Capability::Read)?;
        if &authority.home.scope != scope {
            return Err(DomainError::Forbidden);
        }
        let snapshot = self.store.snapshot(principal, scope)?;
        let output = project_current(&snapshot, &authority, now, media)?;
        let release_authority = self.access.authorize(principal, scope, Capability::Read)?;
        if release_authority != authority {
            return Err(DomainError::Forbidden);
        }
        self.access.revalidate(principal, scope, Capability::Read)?;
        Ok(output)
    }

    pub fn record<P>(
        &mut self,
        principal: &P,
        scope: &Scope,
        target: &RecordRef,
    ) -> DomainResult<Record>
    where
        R: ReadPort<P>,
        A: AccessPort<P>,
    {
        self.access.authorize(principal, scope, Capability::Read)?;
        let record = self.store.record(principal, scope, target)?;
        if &record.scope != scope || &record.target != target {
            return Err(DomainError::NotFound);
        }
        self.access.authorize(principal, scope, Capability::Read)?;
        self.access.revalidate(principal, scope, Capability::Read)?;
        Ok(record)
    }

    /// Bare recorded history, preserving storage order. Never sort by time/UUID,
    /// add a wrapper, or fabricate entries for a synthetic seed record.
    pub fn history<P>(
        &mut self,
        principal: &P,
        scope: &Scope,
        target: &RecordRef,
    ) -> DomainResult<Vec<Audit>>
    where
        R: ReadPort<P>,
        A: AccessPort<P>,
    {
        self.access
            .authorize(principal, scope, Capability::ReadHistory)?;
        let audits = self.store.history(principal, scope, target)?;
        if audits
            .iter()
            .any(|audit| &audit.scope != scope || &audit.record != target)
        {
            return Err(DomainError::NotFound);
        }
        self.access
            .authorize(principal, scope, Capability::ReadHistory)?;
        self.access
            .revalidate(principal, scope, Capability::ReadHistory)?;
        Ok(audits)
    }
}

impl CurrentOutput {
    pub fn visible_entries(&self, include_archived: bool) -> impl Iterator<Item = &CurrentEntry> {
        self.entries
            .iter()
            .filter(move |entry| include_archived || !entry.entity.archived)
    }

    pub fn rooms(&self, include_archived: bool) -> Vec<&CurrentEntry> {
        self.visible_entries(include_archived)
            .filter(|entry| {
                entry.kind == EntryKind::Place && entry.semantic_kind == SemanticKind::Room
            })
            .collect()
    }

    pub fn items(&self, include_archived: bool) -> Vec<&CurrentEntry> {
        self.visible_entries(include_archived)
            .filter(|entry| entry.kind == EntryKind::Item)
            .collect()
    }

    pub fn entry(&self, key: &SourceRef, include_archived: bool) -> Option<&CurrentEntry> {
        self.visible_entries(include_archived)
            .find(|entry| &entry.key == key)
    }

    pub fn parent_of(&self, entry: &CurrentEntry) -> Option<&CurrentEntry> {
        self.entry(&parent_ref(entry)?, true)
    }

    pub fn children_of(&self, key: &SourceRef, include_archived: bool) -> Vec<&CurrentEntry> {
        self.visible_entries(include_archived)
            .filter(|entry| parent_ref(entry).as_ref() == Some(key))
            .collect()
    }

    pub fn unplaced_items(&self, include_archived: bool) -> Vec<&CurrentEntry> {
        self.items(include_archived)
            .into_iter()
            .filter(|entry| self.parent_of(entry).is_none())
            .collect()
    }

    pub fn search(&self, query: &str, include_archived: bool) -> Vec<&CurrentEntry> {
        let query: String = query.chars().take(512).collect();
        let lowered = query.to_lowercase();
        let words: Vec<_> = lowered.split_whitespace().collect();
        self.visible_entries(include_archived)
            .filter(|entry| {
                let text = format!(
                    "{} {} {} {} {}",
                    entry.entity.name,
                    entry.entity.description,
                    entry.entity.manufacturer.as_deref().unwrap_or(""),
                    entry.entity.model_number.as_deref().unwrap_or(""),
                    entry.entity.entity_type.as_ref().map_or("", |t| &t.name)
                )
                .to_lowercase();
                let matches = |text: &str| words.iter().all(|word| text.contains(word));
                matches(&text)
                    || entry.attachments.iter().any(|attachment| {
                        let title = match attachment {
                            super::CurrentAttachment::StoredFile { title, .. }
                            | super::CurrentAttachment::ExternalLink { title, .. } => title,
                        };
                        matches(
                            &format!(
                                "{} {} {}",
                                title,
                                entry.entity.name,
                                entry.entity.model_number.as_deref().unwrap_or("")
                            )
                            .to_lowercase(),
                        )
                    })
            })
            .collect()
    }
}
