use super::*;

impl<S: SecurityPort, P: OAuthProviderPort, B> OAuthLifecycle<'_, S, P, B> {
    pub async fn begin<C>(
        &self,
        context: &C,
        binding: &RegistrationBinding,
        callback: CallbackSelection,
        purpose: SignInPurpose,
    ) -> Result<AuthorizationLaunch, AiError>
    where
        B: CredentialBoundary<C>,
    {
        let mut lease = self.credentials.acquire(context, binding).await?;
        let mut record = self.credentials.load(&lease).await?;
        check_binding(&record, binding)?;
        self.credentials
            .revalidate(context, &lease, binding)
            .await?;
        if !matches!(record.refresh_checkpoint, RefreshCheckpoint::None)
            || (record.state == LifecycleState::Disconnected && record.credentials.is_some())
        {
            // A new launch must not overwrite unverified session material or
            // the older session retained after a partial disconnect.
            return Err(AiError::ConnectionUnavailable);
        }
        if record.binding.authority_epoch != binding.authority_epoch
            || (record.binding.cancellation_epoch != binding.cancellation_epoch
                && record.credentials.is_some())
        {
            // Only a cleared session can adopt this operation's captured
            // cancellation binding. Retained credentials must not become usable
            // merely because a fresh authorization has been requested.
            return Err(AiError::ConnectionUnavailable);
        }
        let now = finite_time(self.credentials.now_ms()?)?;
        if record
            .pending_authorization
            .as_ref()
            .is_some_and(|attempt| now < attempt.expires_at_ms)
        {
            // This exclusive registration lease protects the original live
            // attempt across aliases. A second launch must not consume its
            // state/nonce/PKCE or replace its callback and purpose.
            return Err(AiError::ConnectionUnavailable);
        }
        let (redirect_uri, callback_host, authentication) = match (&record.kind, callback) {
            (
                RegistrationKind::LocalPublicClient,
                CallbackSelection::AvailableLoopbackPort(port),
            ) => (
                format!("http://127.0.0.1:{port}/auth/callback"),
                format!("127.0.0.1:{port}"),
                ClientAuthentication::Public,
            ),
            (
                RegistrationKind::IssuedWebsite {
                    registered_callback,
                    callback_host,
                    authentication,
                },
                CallbackSelection::RegisteredWebsite,
            ) if purpose == SignInPurpose::Identity => {
                self.security
                    .validate_website_callback(registered_callback, callback_host)?;
                (
                    registered_callback.clone(),
                    callback_host.clone(),
                    *authentication,
                )
            }
            _ => return Err(AiError::InvalidInput),
        };
        let client_id = match &record.issued_client_id {
            Some(client) if valid_client(client) => client.clone(),
            None if record.kind == RegistrationKind::LocalPublicClient => DYNAMIC_CLIENT.into(),
            _ => return Err(AiError::ConnectionUnavailable),
        };
        if record.app_name.trim().is_empty()
            || (record.kind == RegistrationKind::LocalPublicClient
                && record.stable_host_id.trim().is_empty())
        {
            return Err(AiError::InvalidInput);
        }
        let material = self.security.fresh().await?;
        validate_material(&material)?;
        let attempt = AuthorizationAttempt {
            binding: binding.clone(),
            material,
            redirect_uri,
            callback_host,
            purpose,
            client_id,
            authentication,
            expires_at_ms: finite_time(
                now.checked_add(ATTEMPT_LIFETIME_MS)
                    .ok_or(AiError::InvalidInput)?,
            )?,
        };
        let launch = authorization_url(&record, &attempt);
        // Persist the explicit reconnect transition with its new attempt under
        // this same active original lease. Stable ownership/authority is checked
        // above; neither a receipt proof nor this record renews that authority.
        record.binding.cancellation_epoch = binding.cancellation_epoch.clone();
        // A new attempt does not replace a previously valid identity/token set.
        record.pending_authorization = Some(attempt);
        self.credentials
            .revalidate(context, &lease, binding)
            .await?;
        self.credentials.persist_atomic(&mut lease, &record).await?;
        Ok(AuthorizationLaunch(launch))
    }
}
