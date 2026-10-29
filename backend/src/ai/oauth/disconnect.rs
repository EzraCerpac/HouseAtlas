use super::*;

impl<S: SecurityPort, P: OAuthProviderPort, B> OAuthLifecycle<'_, S, P, B> {
    pub async fn disconnect<C>(
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
        self.credentials.stop_use(&mut lease).await?;
        record.state = LifecycleState::Disconnected;
        record.pending_authorization = None;
        if record.credentials.is_some()
            || !matches!(record.refresh_checkpoint, RefreshCheckpoint::None)
        {
            // Existing session material creates a new remote-disconnection
            // obligation, even when no renewable token is available. An empty
            // repeated disconnect preserves the prior revocation evidence.
            record.revocation = RevocationState::Unconfirmed;
        }
        // Stop use durably before remote I/O; a failed revocation never silently
        // reconnects or destroys the saved issued-client/account registration.
        self.credentials.persist_atomic(&mut lease, &record).await?;
        let exchange = matches!(
            record.refresh_checkpoint,
            RefreshCheckpoint::ExchangeReceived { .. }
        );
        let mut diagnostic = None;
        let mut primary_confirmed = false;
        {
            let (client, refresh) = match &record.refresh_checkpoint {
                RefreshCheckpoint::ExchangeReceived {
                    client_id, reply, ..
                } => (Some(client_id), reply.refresh_token.as_ref()),
                RefreshCheckpoint::Received { reply, .. } => (
                    record.issued_client_id.as_ref(),
                    reply.refresh_token.as_ref(),
                ),
                _ => (
                    record.issued_client_id.as_ref(),
                    record
                        .credentials
                        .as_ref()
                        .and_then(|tokens| tokens.refresh_token.as_ref()),
                ),
            };
            if let (Some(client), Some(refresh)) = (client, refresh) {
                match self.provider.revoke(binding, client, refresh).await {
                    Ok(ProviderRevocation::Confirmed) => primary_confirmed = true,
                    Ok(ProviderRevocation::Unconfirmed(detail)) => diagnostic = detail,
                    Err(_) => {}
                }
            }
        }
        if primary_confirmed {
            record.refresh_checkpoint = RefreshCheckpoint::None;
            if !exchange {
                record.credentials = None;
            }
            record.revocation = if record.credentials.is_none() {
                RevocationState::Confirmed
            } else {
                RevocationState::Unconfirmed
            };
            // Durably retire this confirmed session before another provider
            // await. A later disconnect cannot resubmit its removed token.
            self.credentials.persist_atomic(&mut lease, &record).await?;
        }
        // A new authorization exchange is a separate renewable session from
        // any previously active credentials. Disconnect must attempt both;
        // success for one cannot stand in for revocation of the other.
        let mut previous_confirmed = false;
        if exchange
            && let Some(previous) = record.credentials.as_ref()
            && let (Some(client), Some(refresh)) =
                (&record.issued_client_id, &previous.refresh_token)
        {
            match self.provider.revoke(binding, client, refresh).await {
                Ok(ProviderRevocation::Confirmed) => previous_confirmed = true,
                Ok(ProviderRevocation::Unconfirmed(detail)) => {
                    if diagnostic.is_none() {
                        diagnostic = detail;
                    }
                }
                Err(_) => {}
            }
        }
        if previous_confirmed {
            record.credentials = None;
            record.revocation = if matches!(record.refresh_checkpoint, RefreshCheckpoint::None) {
                RevocationState::Confirmed
            } else {
                RevocationState::Unconfirmed
            };
        }
        // Preserve only unconfirmed session material, including an older-only
        // remainder on a later disconnect. Disconnected state prevents use.
        self.credentials.persist_atomic(&mut lease, &record).await?;
        Ok(LifecycleReceipt {
            state: record.state,
            issue: None,
            revocation: record.revocation,
            diagnostic,
        })
    }
}
