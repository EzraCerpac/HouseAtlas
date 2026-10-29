use super::*;

pub(super) fn check_binding(
    record: &RegistrationRecord,
    expected: &RegistrationBinding,
) -> Result<(), AiError> {
    // Persistent ownership stays stable across cancellation-epoch changes.
    // The boundary revalidates this operation's original authority/cancellation
    // epochs immediately before dispatch and activation; they cannot be rebased.
    if record.binding.registration_id != expected.registration_id
        || record.binding.actor_id != expected.actor_id
        || record.binding.workspace_id != expected.workspace_id
        || record.binding.home_id != expected.home_id
    {
        Err(AiError::ConnectionUnavailable)
    } else {
        Ok(())
    }
}
pub(super) fn finite_time(value: u64) -> Result<u64, AiError> {
    if value == 0 || value > MAX_SAFE_TIME {
        Err(AiError::InvalidInput)
    } else {
        Ok(value)
    }
}
pub(super) fn valid_client(value: &str) -> bool {
    value != DYNAMIC_CLIENT
        && !value.is_empty()
        && value.len() <= 200
        && value
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == b'_' || ch == b'-')
}
pub(super) fn validate_material(material: &FreshAuthorization) -> Result<(), AiError> {
    let valid = |value: &str| {
        (43..=128).contains(&value.len())
            && value
                .bytes()
                .all(|ch| ch.is_ascii_alphanumeric() || b"-._~".contains(&ch))
    };
    let state = material.state.expose_in_trusted_boundary();
    let nonce = material.nonce.expose_in_trusted_boundary();
    let verifier = material.verifier.expose_in_trusted_boundary();
    if !valid(state)
        || !valid(nonce)
        || !valid(verifier)
        || state == nonce
        || state == verifier
        || nonce == verifier
        || material.s256_challenge.len() != 43
        || !material
            .s256_challenge
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == b'-' || ch == b'_')
    {
        Err(AiError::InvalidInput)
    } else {
        Ok(())
    }
}
pub(super) fn one_parameter<'a>(
    request: &'a CallbackRequest,
    key: &str,
) -> Result<&'a str, AiError> {
    optional_parameter(request, key)?.ok_or(AiError::InvalidInput)
}
pub(super) fn optional_parameter<'a>(
    request: &'a CallbackRequest,
    key: &str,
) -> Result<Option<&'a str>, AiError> {
    let mut values = request.parameters.iter().filter(|(name, _)| name == key);
    let value = values.next().map(|(_, value)| value.as_str());
    if values.next().is_some() {
        Err(AiError::InvalidInput)
    } else {
        Ok(value)
    }
}
pub(super) fn validate_tokens(
    reply: &TokenReply,
    kind: &RegistrationKind,
    refresh: bool,
) -> Result<(), AiError> {
    finite_time(reply.received_at_ms)?;
    let scopes = reply.granted_scopes.as_deref().unwrap_or(&[]);
    if kind == &RegistrationKind::LocalPublicClient && !refresh && reply.granted_scopes.is_none() {
        return Err(AiError::InvalidProviderOutput);
    }
    if reply.access_token.is_some()
        && (reply
            .token_type
            .as_deref()
            .is_none_or(|kind| !kind.eq_ignore_ascii_case("bearer"))
            || reply.expires_at_ms.is_none_or(|expires| {
                finite_time(expires).is_err() || expires <= reply.received_at_ms
            }))
    {
        return Err(AiError::InvalidProviderOutput);
    }
    let offline_access = scopes.iter().any(|scope| scope == "offline_access");
    let direct_use = scopes.iter().any(|scope| scope == DIRECT_USAGE_SCOPE);
    // The pinned DevKit requires access for direct use, but a renewable token
    // only for an offline grant or a refresh exchange. Direct use alone does
    // not imply offline access or invent a refresh token requirement.
    if ((refresh || offline_access || direct_use) && reply.access_token.is_none())
        || ((refresh || offline_access) && reply.refresh_token.is_none())
    {
        return Err(AiError::InvalidProviderOutput);
    }
    Ok(())
}
pub(super) fn saved_tokens(reply: TokenReply, previous_scopes: Vec<String>) -> SavedCredentials {
    SavedCredentials {
        id_token: reply.id_token,
        access_token: reply.access_token,
        refresh_token: reply.refresh_token,
        expires_at_ms: reply.expires_at_ms,
        granted_scopes: reply.granted_scopes.unwrap_or(previous_scopes),
    }
}
pub(super) fn plan_state(kind: &RegistrationKind, scopes: &[String]) -> LifecycleState {
    if kind == &RegistrationKind::LocalPublicClient
        && scopes.iter().any(|scope| scope == DIRECT_USAGE_SCOPE)
    {
        LifecycleState::Connected
    } else {
        LifecycleState::PlanUseDisabled
    }
}
pub(super) fn provider_issue(diagnostic: &ProviderDiagnostic) -> OAuthIssue {
    match diagnostic.code.as_deref() {
        Some("invalid_client") => OAuthIssue::ClientConfigurationInvalid,
        Some(
            "invalid_grant"
            | "invalid_refresh_token"
            | "token_expired"
            | "refresh_token_expired"
            | "refresh_token_invalidated"
            | "refresh_token_reused",
        ) => OAuthIssue::ExplicitReauthorizationRequired,
        _ => OAuthIssue::ProviderRejected,
    }
}
pub(super) fn receipt(
    record: &RegistrationRecord,
    issue: OAuthIssue,
    diagnostic: Option<ProviderDiagnostic>,
) -> LifecycleReceipt {
    LifecycleReceipt {
        state: record.state,
        issue: Some(issue),
        revocation: record.revocation,
        diagnostic,
    }
}
pub(super) fn authorization_url(
    record: &RegistrationRecord,
    attempt: &AuthorizationAttempt,
) -> String {
    let mut parameters = vec![
        ("client_id", attempt.client_id.as_str()),
        ("response_type", "code"),
        ("redirect_uri", attempt.redirect_uri.as_str()),
        (
            "scope",
            if attempt.purpose == SignInPurpose::EnablePlanUse {
                PLAN_SCOPES
            } else {
                IDENTITY_SCOPES
            },
        ),
        ("state", attempt.material.state.expose_in_trusted_boundary()),
        ("nonce", attempt.material.nonce.expose_in_trusted_boundary()),
        ("code_challenge_method", "S256"),
        ("code_challenge", attempt.material.s256_challenge.as_str()),
    ];
    if record.kind == RegistrationKind::LocalPublicClient {
        parameters.push(("resource", OAUTH_RESOURCE));
        parameters.push(("ext_agent_host_id", record.stable_host_id.as_str()));
        if attempt.client_id == DYNAMIC_CLIENT {
            parameters.push(("agent_name_hint", record.app_name.as_str()));
        }
    }
    if attempt.purpose == SignInPurpose::EnablePlanUse {
        parameters.push(("prompt", "consent"));
    }
    let query = parameters
        .into_iter()
        .map(|(key, value)| format!("{}={}", form_encode(key), form_encode(value)))
        .collect::<Vec<_>>()
        .join("&");
    format!("{AUTHORIZATION_ENDPOINT}?{query}")
}
fn form_encode(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'*' | b'-' | b'.' | b'_' => {
                encoded.push(char::from(byte))
            }
            b' ' => encoded.push('+'),
            _ => {
                encoded.push('%');
                encoded.push(char::from(HEX[usize::from(byte >> 4)]));
                encoded.push(char::from(HEX[usize::from(byte & 15)]));
            }
        }
    }
    encoded
}
