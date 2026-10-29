use super::*;

impl<S: SecurityPort, P: OAuthProviderPort, B> OAuthLifecycle<'_, S, P, B> {
    pub async fn complete<C>(
        &self,
        context: &C,
        binding: &RegistrationBinding,
        callback: CallbackRequest,
    ) -> Result<LifecycleReceipt, AiError>
    where
        B: CredentialBoundary<C>,
    {
        let mut lease = self.credentials.acquire(context, binding).await?;
        let mut record = self.credentials.load(&lease).await?;
        check_binding(&record, binding)?;
        if !matches!(record.refresh_checkpoint, RefreshCheckpoint::None) {
            return Err(AiError::ConnectionUnavailable);
        }
        let attempt = record
            .pending_authorization
            .as_ref()
            .ok_or(AiError::InvalidInput)?;
        let now = finite_time(self.credentials.now_ms()?)?;
        let state = one_parameter(&callback, "state")?;
        if callback.method != "GET"
            || callback.host != attempt.callback_host
            || callback.redirect_uri != attempt.redirect_uri
            || &attempt.binding != binding
            || now >= attempt.expires_at_ms
            || !self.security.state_matches(&attempt.material.state, state)
        {
            // An unrelated request cannot consume the legitimate pending attempt.
            return Ok(receipt(&record, OAuthIssue::CallbackInvalid, None));
        }
        let error = optional_parameter(&callback, "error")?;
        let code = optional_parameter(&callback, "code")?;
        let returned_client = optional_parameter(&callback, "client_id")?;
        let client = returned_client.unwrap_or(&attempt.client_id).to_owned();
        let client_valid = valid_client(&client)
            && (attempt.client_id == DYNAMIC_CLIENT || client == attempt.client_id);
        let attempt = record
            .pending_authorization
            .take()
            .ok_or(AiError::InvalidInput)?;
        // Consume a verified one-time callback and retain the issued registration
        // before exchanging its code. Later failures require fresh authorization.
        if error.is_none() && client_valid {
            record.issued_client_id = Some(client.clone());
        }
        self.credentials.persist_atomic(&mut lease, &record).await?;
        if let Some(error) = error {
            let issue = if error == "access_denied" {
                OAuthIssue::ConsentDeclined
            } else {
                OAuthIssue::ProviderRejected
            };
            return Ok(receipt(&record, issue, None));
        }
        if !client_valid || code.is_none() {
            return Ok(receipt(&record, OAuthIssue::RegistrationIncomplete, None));
        }
        let code =
            ProtectedValue::from_trusted_adapter(code.ok_or(AiError::InvalidInput)?.to_owned())?;
        self.credentials
            .revalidate(context, &lease, binding)
            .await?;
        let reply = self
            .provider
            .exchange(
                binding,
                CodeExchange {
                    client_id: &client,
                    code: &code,
                    verifier: &attempt.material.verifier,
                    redirect_uri: &attempt.redirect_uri,
                    resource: (record.kind == RegistrationKind::LocalPublicClient)
                        .then_some(OAUTH_RESOURCE),
                    authentication: attempt.authentication,
                },
            )
            .await;
        let reply = match reply {
            Ok(ProviderTokens::Received(reply)) => reply,
            Ok(ProviderTokens::Rejected(diagnostic)) => {
                return Ok(receipt(
                    &record,
                    provider_issue(&diagnostic),
                    Some(diagnostic),
                ));
            }
            Err(_) => return Ok(receipt(&record, OAuthIssue::ExchangeUnconfirmed, None)),
        };
        record.refresh_checkpoint = RefreshCheckpoint::ExchangeReceived {
            binding: binding.clone(),
            client_id: client,
            nonce: attempt.material.nonce,
            reply,
        };
        record.state = LifecycleState::IdentityVerificationPending;
        // Capture received remote session material before any validation await.
        // The encrypted checkpoint is not active credentials; persistence is
        // required even if keys/identity verification are temporarily unavailable.
        self.credentials.persist_atomic(&mut lease, &record).await?;
        self.activate_exchange(context, binding, &mut lease, &mut record)
            .await
    }

    /// Retry only verification of a durable received exchange. Never exchanges
    /// the consumed authorization code or starts a new grant/refresh/inference.
    pub async fn verify_received_exchange<C>(
        &self,
        context: &C,
        binding: &RegistrationBinding,
    ) -> Result<LifecycleReceipt, AiError>
    where
        B: CredentialBoundary<C>,
    {
        let mut lease = self.credentials.acquire(context, binding).await?;
        let mut record = self.credentials.load(&lease).await?;
        check_binding(&record, binding)?;
        self.credentials
            .revalidate(context, &lease, binding)
            .await?;
        if record.state != LifecycleState::IdentityVerificationPending {
            return Err(AiError::ConnectionUnavailable);
        }
        self.activate_exchange(context, binding, &mut lease, &mut record)
            .await
    }

    pub(super) async fn activate_exchange<C>(
        &self,
        context: &C,
        binding: &RegistrationBinding,
        lease: &mut B::Lease,
        record: &mut RegistrationRecord,
    ) -> Result<LifecycleReceipt, AiError>
    where
        B: CredentialBoundary<C>,
    {
        let (client, nonce, reply) = match &record.refresh_checkpoint {
            RefreshCheckpoint::ExchangeReceived {
                binding: captured,
                client_id,
                nonce,
                reply,
            } if captured == binding && record.issued_client_id.as_ref() == Some(client_id) => {
                (client_id, nonce, reply)
            }
            _ => return Err(AiError::ConnectionUnavailable),
        };
        validate_tokens(reply, &record.kind, false)?;
        self.credentials.revalidate(context, lease, binding).await?;
        let token = reply
            .id_token
            .as_ref()
            .ok_or(AiError::InvalidProviderOutput)?;
        let identity = match self
            .security
            .verify_identity(
                token,
                IdentityRequirements {
                    issuer: OIDC_ISSUER,
                    audience: client,
                    nonce: Some(nonce),
                    received_at_ms: reply.received_at_ms,
                },
            )
            .await
        {
            Ok(IdentityValidation::Verified(identity))
                if !identity.subject.is_empty()
                    && record
                        .identity
                        .as_ref()
                        .is_none_or(|old| old.subject == identity.subject) =>
            {
                identity
            }
            Ok(IdentityValidation::TemporarilyUnavailable) | Err(_) => {
                return Ok(receipt(record, OAuthIssue::IdentityUnavailable, None));
            }
            _ => return Ok(receipt(record, OAuthIssue::IdentityInvalid, None)),
        };
        record.state = plan_state(&record.kind, reply.granted_scopes.as_deref().unwrap_or(&[]));
        record.identity = Some(identity);
        self.credentials.revalidate(context, lease, binding).await?;
        let reply = match std::mem::replace(&mut record.refresh_checkpoint, RefreshCheckpoint::None)
        {
            RefreshCheckpoint::ExchangeReceived { reply, .. } => reply,
            _ => return Err(AiError::ConnectionUnavailable),
        };
        // Website identity has no supported plan-use token contract. Retain
        // only its validated identity mapping; local plan-use registrations
        // keep their protected token set in the selected credential boundary.
        record.credentials = if record.kind == RegistrationKind::LocalPublicClient {
            Some(saved_tokens(reply, vec![]))
        } else {
            None
        };
        record.revocation = RevocationState::NotRequested;
        self.credentials.persist_atomic(lease, record).await?;
        Ok(LifecycleReceipt {
            state: record.state,
            issue: (record.state == LifecycleState::PlanUseDisabled)
                .then_some(OAuthIssue::PlanScopeMissing),
            revocation: record.revocation,
            diagnostic: None,
        })
    }
}
