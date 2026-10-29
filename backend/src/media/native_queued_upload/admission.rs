use super::*;

impl NativeQueuedUploadStages {
    pub fn open(path: &Path) -> MediaResult<Self> {
        let owner = Arc::new(StageOwner {
            directory: PrivateDir::open(path, false)?,
            custody: Mutex::new(()),
        });
        owner.check()?;
        Ok(Self { owner })
    }

    pub fn stage_under_guard<'grant, R: Read + ?Sized>(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        original: &RetainedPrincipal,
        source: &'grant a::SourceGrant,
        metadata: NativeQueuedUploadMetadata,
        input: &mut R,
        budget: &WorkBudget,
    ) -> MediaResult<NativeQueuedUploadStage<'grant>> {
        budget.check()?;
        check_metadata(&metadata)?;
        authorize_original(guard, original, source)?;
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            budget.check()?;
            let count = input.read(&mut buffer)?;
            budget.check()?;
            if count == 0 {
                break;
            }
            if count > MAX_BYTES.saturating_sub(bytes.len()) {
                return Err(MediaError::TooLarge);
            }
            bytes.extend_from_slice(&buffer[..count]);
        }
        if bytes.is_empty() {
            return Err(MediaError::InvalidInput);
        }
        content::validate_original_content(&bytes, metadata.content_type, budget)?;
        authorize_original(guard, original, source)?;
        // Generate token only after measuring real bounded original body bytes.
        let mut nonce = [0u8; 16];
        getrandom::fill(&mut nonce).map_err(|_| MediaError::Unavailable)?;
        nonce[6] = (nonce[6] & 0x0f) | 0x40;
        nonce[8] = (nonce[8] & 0x3f) | 0x80;
        let token = Uuid::from_bytes(nonce);
        let staged = native::StagedUpload {
            upload_token: token,
            sha256: native::Digest::parse(sha256(&bytes)).map_err(|_| MediaError::InvalidInput)?,
            byte_size: bytes.len() as u64,
            content_type: metadata.content_type.as_str().into(),
            filename: metadata.filename,
        };
        let reservation = ReservationData {
            format: RESERVATION_FORMAT.into(),
            actor_id: original.principal().actor_id().as_str().into(),
            source: source.reference().clone(),
            staged: staged.clone(),
        };
        let reservation_bytes =
            serde_json::to_vec(&reservation).map_err(|_| MediaError::Unavailable)?;
        if reservation_bytes.len() > MAX_RESERVATION_BYTES {
            return Err(MediaError::TooLarge);
        }
        let local_custody = self
            .owner
            .custody
            .try_lock()
            .map_err(|_| MediaError::Unavailable)?;
        let directory_custody = self.owner.lock()?;
        let before = self.owner.scan(budget)?;
        if before.members.len() >= MAX_QUEUED_UPLOAD_STAGES
            || bytes.len() > MAX_QUEUED_UPLOAD_RESERVED_BYTES.saturating_sub(before.reserved_bytes)
        {
            return Err(MediaError::TooLarge);
        }
        let id = token.to_string();
        // Reservation is durable BEFORE body installation. All errors retain the
        // charged reservation (or fail-closed incomplete DATA), never delete it.
        self.owner
            .write_new(&reservation_name(&id), &reservation_bytes, budget)?;
        self.owner.write_new(&body_name(&id), &bytes, budget)?;
        let actual_reservation =
            self.owner
                .read_member(&reservation_name(&id), MAX_RESERVATION_BYTES, budget)?;
        let actual_body = self.owner.read_member(&body_name(&id), MAX_BYTES, budget)?;
        if actual_reservation.bytes != reservation_bytes || actual_body.bytes != bytes {
            return Err(MediaError::Unavailable);
        }
        let after = self.owner.scan(budget)?;
        if after.members.len() != before.members.len() + 1
            || after.reserved_bytes != before.reserved_bytes + bytes.len()
            || before
                .members
                .iter()
                .any(|member| !after.members.contains(member))
            || !after.members.iter().any(|member| {
                member.id == id
                    && member.reservation == actual_reservation.identity
                    && member.body.as_ref() == Some(&actual_body.identity)
            })
        {
            return Err(MediaError::Unavailable);
        }
        drop(directory_custody);
        drop(local_custody);
        authorize_original(guard, original, source)?;
        budget.check()?;
        let custody = Arc::new(StageCustody {
            issuer: Arc::new(UploadIssuer),
            owner: Arc::clone(&self.owner),
            staged,
            reservation_bytes,
            reservation_identity: actual_reservation.identity,
            body: actual_body.file,
            body_bytes: bytes,
            body_identity: actual_body.identity,
        });
        Ok(NativeQueuedUploadStage {
            original: original.clone(),
            source,
            custody,
        })
    }
}
