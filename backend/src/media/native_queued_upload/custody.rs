use super::*;

impl StageOwner {
    pub(super) fn check(&self) -> MediaResult<()> {
        self.directory.check()?;
        let descriptor = self.directory.file.metadata()?;
        let named = std::fs::symlink_metadata(&self.directory.path)?;
        for metadata in [&descriptor, &named] {
            if !metadata.is_dir()
                || metadata.mode() & 0o7777 != 0o700
                || metadata.uid() != rustix::process::geteuid().as_raw()
            {
                return Err(MediaError::Unavailable);
            }
        }
        if descriptor.dev() != named.dev() || descriptor.ino() != named.ino() {
            return Err(MediaError::Unavailable);
        }
        Ok(())
    }
    pub(super) fn lock(&self) -> MediaResult<DirectoryLock<'_>> {
        self.check()?;
        rfs::flock(
            &self.directory.file,
            rfs::FlockOperation::NonBlockingLockExclusive,
        )
        .map_err(|_| MediaError::Unavailable)?;
        Ok(DirectoryLock(&self.directory.file))
    }
    pub(super) fn read_member(
        &self,
        name: &str,
        maximum: usize,
        budget: &WorkBudget,
    ) -> MediaResult<ReadMember> {
        budget.check()?;
        self.check()?;
        let flags = OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC;
        let file = File::from(rfs::openat(
            &self.directory.file,
            name,
            flags,
            Mode::empty(),
        )?);
        let mut reader = &file;
        let metadata = file.metadata()?;
        check_file(&metadata, maximum)?;
        let before = FileIdentity::of(&metadata);
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        let mut buffer = [0u8; 64 * 1024];
        loop {
            budget.check()?;
            let count = reader.read(&mut buffer)?;
            budget.check()?;
            if count == 0 {
                break;
            }
            if count > maximum.saturating_sub(bytes.len()) {
                return Err(MediaError::TooLarge);
            }
            bytes.extend_from_slice(&buffer[..count]);
        }
        let after = file.metadata()?;
        check_file(&after, maximum)?;
        let named = File::from(rfs::openat(
            &self.directory.file,
            name,
            flags,
            Mode::empty(),
        )?)
        .metadata()?;
        check_file(&named, maximum)?;
        if before != FileIdentity::of(&after)
            || before != FileIdentity::of(&named)
            || before.size != bytes.len() as u64
        {
            return Err(MediaError::Unavailable);
        }
        self.check()?;
        budget.check()?;
        Ok(ReadMember {
            file,
            bytes,
            identity: before,
        })
    }
    /// Full stable capacity DATA; abandoned reservations and missing/partial
    /// bodies stay charged. Unknown names or incomplete reservation JSON make
    /// the entire owner unavailable. No file scan issues a stage or admission.
    pub(super) fn scan(&self, budget: &WorkBudget) -> MediaResult<Catalog> {
        budget.check()?;
        self.check()?;
        let before = FileIdentity::of(&self.directory.file.metadata()?);
        let mut pairs: BTreeMap<String, (bool, bool)> = BTreeMap::new();
        let mut directory = rfs::Dir::read_from(&self.directory.file)?;
        while let Some(entry) = directory.read() {
            budget.check()?;
            let entry = entry?;
            let name = entry
                .file_name()
                .to_str()
                .map_err(|_| MediaError::Unavailable)?;
            if name == "." || name == ".." {
                continue;
            }
            let (id, reservation) = if let Some(id) = name.strip_suffix(".reservation.json") {
                (id, true)
            } else if let Some(id) = name.strip_suffix(".body") {
                (id, false)
            } else {
                return Err(MediaError::Unavailable);
            };
            if !canonical_uuid(id) {
                return Err(MediaError::Unavailable);
            }
            let pair = pairs.entry(id.to_owned()).or_default();
            if reservation {
                if pair.0 {
                    return Err(MediaError::Unavailable);
                }
                pair.0 = true;
            } else {
                if pair.1 {
                    return Err(MediaError::Unavailable);
                }
                pair.1 = true;
            }
            if pairs.len() > MAX_QUEUED_UPLOAD_STAGES {
                return Err(MediaError::TooLarge);
            }
        }
        let mut total = 0usize;
        let mut members = Vec::with_capacity(pairs.len());
        for (id, (reservation, body)) in pairs {
            budget.check()?;
            if !reservation {
                return Err(MediaError::Unavailable);
            }
            let retained =
                self.read_member(&reservation_name(&id), MAX_RESERVATION_BYTES, budget)?;
            let data: ReservationData =
                serde_json::from_slice(&retained.bytes).map_err(|_| MediaError::Unavailable)?;
            validate_reservation(&data, &id)?;
            total = total
                .checked_add(data.staged.byte_size as usize)
                .ok_or(MediaError::TooLarge)?;
            if total > MAX_QUEUED_UPLOAD_RESERVED_BYTES {
                return Err(MediaError::TooLarge);
            }
            let body = if body {
                let read =
                    self.read_member(&body_name(&id), data.staged.byte_size as usize, budget)?;
                Some(read.identity)
            } else {
                None
            };
            members.push(CatalogMember {
                id,
                reservation: retained.identity,
                body,
            });
        }
        self.check()?;
        budget.check()?;
        if before != FileIdentity::of(&self.directory.file.metadata()?) {
            return Err(MediaError::Unavailable);
        }
        Ok(Catalog {
            members,
            reserved_bytes: total,
        })
    }
    pub(super) fn write_new(
        &self,
        name: &str,
        bytes: &[u8],
        budget: &WorkBudget,
    ) -> MediaResult<()> {
        budget.check()?;
        self.check()?;
        let flags = OFlags::WRONLY
            | OFlags::CREATE
            | OFlags::EXCL
            | OFlags::NOFOLLOW
            | OFlags::NONBLOCK
            | OFlags::CLOEXEC;
        let mut file = File::from(rfs::openat(
            &self.directory.file,
            name,
            flags,
            Mode::RUSR | Mode::WUSR,
        )?);
        // Preserve inherited process settings while requiring exact private mode
        // on this descriptor. Any failure leaves this new reservation/body DATA.
        rfs::fchmod(&file, Mode::RUSR | Mode::WUSR)?;
        for chunk in bytes.chunks(64 * 1024) {
            budget.check()?;
            file.write_all(chunk)?;
            budget.check()?;
        }
        platform_fs::sync(&file)?;
        self.directory.sync()?;
        self.check()?;
        budget.check()
    }
}

fn canonical_uuid(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|id| !id.is_nil() && id.to_string() == value)
}

pub(super) fn reservation_name(id: &str) -> String {
    format!("{id}.reservation.json")
}

pub(super) fn body_name(id: &str) -> String {
    format!("{id}.body")
}

fn check_file(metadata: &Metadata, maximum: usize) -> MediaResult<()> {
    if !metadata.is_file()
        || metadata.mode() & 0o7777 != 0o600
        || metadata.uid() != rustix::process::geteuid().as_raw()
        || metadata.nlink() != 1
    {
        return Err(MediaError::Unavailable);
    }
    if metadata.len() > maximum as u64 {
        return Err(MediaError::TooLarge);
    }
    Ok(())
}

fn validate_reservation(data: &ReservationData, id: &str) -> MediaResult<()> {
    if data.format != RESERVATION_FORMAT
        || data.staged.upload_token.to_string() != id
        || data.staged.byte_size == 0
        || data.staged.byte_size > MAX_BYTES as u64
        || !canonical_uuid(&data.actor_id)
        || data.source.key.source_kind != a::SourceKind::HomeboxEntity
        || !canonical_uuid(&data.source.key.external_id)
        || !canonical_uuid(&data.source.key.collection_id)
    {
        return Err(MediaError::Unavailable);
    }
    let content_type = ContentType::parse(&data.staged.content_type)?;
    check_metadata(&NativeQueuedUploadMetadata {
        content_type,
        filename: data.staged.filename.clone(),
    })
}
