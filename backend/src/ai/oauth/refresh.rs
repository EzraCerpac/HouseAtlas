use super::*;

impl<S: SecurityPort, P: OAuthProviderPort, B> OAuthLifecycle<'_, S, P, B> {
    pub async fn refresh<C>(
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
        if matches!(
            record.refresh_checkpoint,
            RefreshCheckpoint::ExchangeReceived { .. }
        ) && record.state == LifecycleState::IdentityVerificationPending
        {
            // Explicit host refresh can finish verification without a second
            // exchange or refresh grant, including a first website identity.
            return self
                .activate_exchange(context, binding, &mut lease, &mut record)
                .await;
        }
        match record.state {
            LifecycleState::ConfigurationRepairRequired => {
                return Ok(receipt(
                    &record,
                    OAuthIssue::ClientConfigurationInvalid,
                    None,
                ));
            }
            LifecycleState::Disconnected | LifecycleState::ReauthorizationRequired => {
                return Ok(receipt(
                    &record,
                    OAuthIssue::ExplicitReauthorizationRequired,
                    None,
                ));
            }
            _ => {}
        }
        if record
            .identity
            .as_ref()
            .is_none_or(|identity| identity.subject.is_empty())
        {
            return Err(AiError::ConnectionUnavailable);
        }
        let client = record
            .issued_client_id
            .as_deref()
            .filter(|client| valid_client(client))
            .ok_or(AiError::ConnectionUnavailable)?
            .to_owned();
        if record.kind != RegistrationKind::LocalPublicClient {
            return Err(AiError::ConnectionUnavailable);
        }
        if matches!(
            record.refresh_checkpoint,
            RefreshCheckpoint::InvocationUnconfirmed(_)
        ) {
            return Ok(LifecycleReceipt {
                state: LifecycleState::RefreshUnconfirmed,
                ..receipt(&record, OAuthIssue::RefreshUnconfirmed, None)
            });
        }
        if matches!(record.refresh_checkpoint, RefreshCheckpoint::None) {
            let refresh = record
                .credentials
                .as_ref()
                .and_then(|tokens| tokens.refresh_token.as_ref())
                .ok_or(AiError::ConnectionUnavailable)?;
            record.refresh_checkpoint = RefreshCheckpoint::InvocationUnconfirmed(binding.clone());
            record.state = LifecycleState::RefreshUnconfirmed;
            self.credentials.persist_atomic(&mut lease, &record).await?;
            self.credentials
                .revalidate(context, &lease, binding)
                .await?;
            let reply = self
                .provider
                .refresh(
                    binding,
                    RefreshGrant {
                        client_id: &client,
                        refresh_token: refresh,
                        resource: OAUTH_RESOURCE,
                    },
                )
                .await;
            match reply {
                Ok(ProviderTokens::Received(reply)) => {
                    record.refresh_checkpoint = RefreshCheckpoint::Received {
                        binding: binding.clone(),
                        reply,
                    };
                    record.state = LifecycleState::IdentityVerificationPending;
                    // A received rotation cannot be replayed or activated while
                    // verification is unavailable, including after restart.
                    self.credentials.persist_atomic(&mut lease, &record).await?;
                }
                Ok(ProviderTokens::Rejected(diagnostic)) => {
                    let issue = provider_issue(&diagnostic);
                    if issue == OAuthIssue::ExplicitReauthorizationRequired {
                        self.credentials.stop_use(&mut lease).await?;
                        record.credentials = None;
                        record.refresh_checkpoint = RefreshCheckpoint::None;
                        record.state = LifecycleState::ReauthorizationRequired;
                    } else if issue == OAuthIssue::ClientConfigurationInvalid {
                        record.refresh_checkpoint = RefreshCheckpoint::None;
                        record.state = LifecycleState::ConfigurationRepairRequired;
                    }
                    self.credentials.persist_atomic(&mut lease, &record).await?;
                    return Ok(receipt(&record, issue, Some(diagnostic)));
                }
                Err(_) => return Ok(receipt(&record, OAuthIssue::RefreshUnconfirmed, None)),
            }
        }
        let rotation = match &record.refresh_checkpoint {
            RefreshCheckpoint::Received {
                binding: captured,
                reply,
            } if captured == binding => reply,
            _ => return Err(AiError::ConnectionUnavailable),
        };
        validate_tokens(rotation, &record.kind, true)?;
        let mut new_identity = None;
        if let Some(token) = &rotation.id_token {
            match self
                .security
                .verify_identity(
                    token,
                    IdentityRequirements {
                        issuer: OIDC_ISSUER,
                        audience: &client,
                        nonce: None,
                        received_at_ms: rotation.received_at_ms,
                    },
                )
                .await
            {
                Ok(IdentityValidation::Verified(identity))
                    if record
                        .identity
                        .as_ref()
                        .is_some_and(|old| old.subject == identity.subject) =>
                {
                    new_identity = Some(identity)
                }
                Ok(IdentityValidation::TemporarilyUnavailable) | Err(_) => {
                    return Ok(receipt(&record, OAuthIssue::IdentityUnavailable, None));
                }
                _ => {
                    self.credentials.stop_use(&mut lease).await?;
                    record.credentials = None;
                    record.refresh_checkpoint = RefreshCheckpoint::None;
                    record.state = LifecycleState::ReauthorizationRequired;
                    self.credentials.persist_atomic(&mut lease, &record).await?;
                    return Ok(receipt(&record, OAuthIssue::IdentityInvalid, None));
                }
            }
        }
        self.credentials
            .revalidate(context, &lease, binding)
            .await?;
        let previous_scopes = record
            .credentials
            .as_ref()
            .map(|old| old.granted_scopes.clone())
            .unwrap_or_default();
        let rotation =
            match std::mem::replace(&mut record.refresh_checkpoint, RefreshCheckpoint::None) {
                RefreshCheckpoint::Received {
                    binding: captured,
                    reply,
                } if &captured == binding => reply,
                _ => return Err(AiError::ConnectionUnavailable),
            };
        let mut tokens = saved_tokens(rotation, previous_scopes);
        if tokens.id_token.is_none() {
            tokens.id_token = record
                .credentials
                .as_mut()
                .and_then(|old| old.id_token.take());
        }
        record.state = plan_state(&record.kind, &tokens.granted_scopes);
        record.credentials = Some(tokens);
        if let Some(identity) = new_identity {
            record.identity = Some(identity);
        }
        self.credentials.persist_atomic(&mut lease, &record).await?;
        Ok(LifecycleReceipt {
            state: record.state,
            issue: (record.state == LifecycleState::PlanUseDisabled)
                .then_some(OAuthIssue::PlanScopeMissing),
            revocation: record.revocation,
            diagnostic: None,
        })
    }
}
