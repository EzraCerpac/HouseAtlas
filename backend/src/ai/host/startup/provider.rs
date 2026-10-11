//! Native public-client SIWC transport. Constructors perform no network I/O.
//! Protocol: https://developers.openai.com/siwc/token-sharing-open-source/sign-in
//! and https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
//! No code or rotating refresh grant is automatically replayed.

use crate::ai::{AiError, PortFuture, ProviderDiagnostic, oauth::*};
use reqwest::{
    Client, Response,
    header::{ACCEPT, CONTENT_TYPE, HeaderMap, HeaderValue},
};
use serde::Deserialize;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const DISCOVERY: &str = "https://auth.openai.com/.well-known/openid-configuration";
const TOKEN_ENDPOINT: &str = "https://auth.openai.com/api/accounts/oauth/token";
const MAX_BODY: usize = 262_144;
const MAX_FORM: usize = 262_144;
const MAX_SAFE_TIME: u64 = 9_007_199_254_740_991;

pub struct NativeOAuthProvider {
    client: Client,
}

impl NativeOAuthProvider {
    pub fn new() -> Result<Self, AiError> {
        Ok(Self {
            client: http_client()?,
        })
    }

    async fn tokens(&self, fields: &[(&str, &str)]) -> Result<ProviderTokens, AiError> {
        let response = post_form(&self.client, TOKEN_ENDPOINT, fields).await?;
        let status = response.status().as_u16();
        let body = bounded_body(response).await?;
        if status != 200 {
            return Ok(ProviderTokens::Rejected(diagnostic(status, &body)));
        }
        let raw: RawTokens =
            serde_json::from_slice(&body).map_err(|_| AiError::InvalidProviderOutput)?;
        // Capture receipt after the entire bounded response has arrived, before activation.
        let received_at_ms = now_ms()?;
        let expires_at_ms = raw
            .expires_in
            .map(|seconds| {
                if seconds == 0 {
                    return Err(AiError::InvalidProviderOutput);
                }
                received_at_ms
                    .checked_add(
                        seconds
                            .checked_mul(1000)
                            .ok_or(AiError::InvalidProviderOutput)?,
                    )
                    .filter(|v| *v <= MAX_SAFE_TIME)
                    .ok_or(AiError::InvalidProviderOutput)
            })
            .transpose()?;
        let granted_scopes = raw
            .scope
            .map(|scope| {
                if scope.len() > 8192
                    || !scope.bytes().all(|b| {
                        b == b' ' || ((0x21..=0x7e).contains(&b) && b != b'"' && b != b'\\')
                    })
                {
                    return Err(AiError::InvalidProviderOutput);
                }
                let scopes: Vec<String> = scope
                    .split(' ')
                    .filter(|s| !s.is_empty())
                    .map(str::to_owned)
                    .collect();
                if scopes.len() > 128 {
                    return Err(AiError::InvalidProviderOutput);
                }
                Ok(scopes)
            })
            .transpose()?;
        if raw
            .token_type
            .as_ref()
            .is_some_and(|v| v.len() > 64 || !v.bytes().all(|b| b.is_ascii_alphabetic()))
        {
            return Err(AiError::InvalidProviderOutput);
        }
        Ok(ProviderTokens::Received(TokenReply {
            id_token: protected(raw.id_token)?,
            access_token: protected(raw.access_token)?,
            refresh_token: protected(raw.refresh_token)?,
            token_type: raw.token_type,
            expires_at_ms,
            granted_scopes,
            received_at_ms,
        }))
    }
}

impl OAuthProviderPort for NativeOAuthProvider {
    fn exchange<'a>(
        &'a self,
        _binding: &'a RegistrationBinding,
        grant: CodeExchange<'a>,
    ) -> PortFuture<'a, ProviderTokens> {
        Box::pin(async move {
            valid_client(grant.client_id)?;
            if grant.authentication != ClientAuthentication::Public
                || !valid_loopback_callback(grant.redirect_uri)
                || grant.resource.is_some_and(|v| v != OAUTH_RESOURCE)
            {
                return Err(AiError::InvalidInput);
            }
            let verifier = grant.verifier.expose_in_trusted_boundary();
            if !(43..=128).contains(&verifier.len())
                || !verifier
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-._~".contains(&b))
            {
                return Err(AiError::InvalidInput);
            }
            let mut fields = vec![
                ("grant_type", "authorization_code"),
                ("client_id", grant.client_id),
                ("code", grant.code.expose_in_trusted_boundary()),
                ("code_verifier", verifier),
                ("redirect_uri", grant.redirect_uri),
            ];
            if let Some(resource) = grant.resource {
                fields.push(("resource", resource));
            }
            self.tokens(&fields).await
        })
    }
    fn refresh<'a>(
        &'a self,
        _binding: &'a RegistrationBinding,
        grant: RefreshGrant<'a>,
    ) -> PortFuture<'a, ProviderTokens> {
        Box::pin(async move {
            valid_client(grant.client_id)?;
            if grant.resource != OAUTH_RESOURCE {
                return Err(AiError::InvalidInput);
            }
            self.tokens(&[
                ("grant_type", "refresh_token"),
                ("client_id", grant.client_id),
                (
                    "refresh_token",
                    grant.refresh_token.expose_in_trusted_boundary(),
                ),
                ("resource", grant.resource),
            ])
            .await
        })
    }
    fn revoke<'a>(
        &'a self,
        _binding: &'a RegistrationBinding,
        client_id: &'a str,
        refresh_token: &'a ProtectedValue,
    ) -> PortFuture<'a, ProviderRevocation> {
        Box::pin(async move {
            valid_client(client_id)?;
            let metadata = match discover(&self.client).await {
                Ok(value) => value,
                Err(_) => return Ok(ProviderRevocation::Unconfirmed(None)),
            };
            let Some(endpoint) = metadata.revocation_endpoint else {
                return Ok(ProviderRevocation::Unconfirmed(None));
            };
            let response = match post_form(
                &self.client,
                &endpoint,
                &[
                    ("token", refresh_token.expose_in_trusted_boundary()),
                    ("token_type_hint", "refresh_token"),
                    ("client_id", client_id),
                ],
            )
            .await
            {
                Ok(value) => value,
                Err(_) => return Ok(ProviderRevocation::Unconfirmed(None)),
            };
            let status = response.status().as_u16();
            let body = match bounded_body(response).await {
                Ok(value) => value,
                Err(_) => return Ok(ProviderRevocation::Unconfirmed(None)),
            };
            // The documented success is an empty 200, including already-invalid tokens.
            if status == 200 && body.is_empty() {
                Ok(ProviderRevocation::Confirmed)
            } else {
                Ok(ProviderRevocation::Unconfirmed(Some(diagnostic(
                    status, &body,
                ))))
            }
        })
    }
}

#[derive(Deserialize)]
struct RawTokens {
    id_token: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    token_type: Option<String>,
    expires_in: Option<u64>,
    scope: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct IssuerMetadata {
    issuer: String,
    pub(super) jwks_uri: String,
    token_endpoint: String,
    pub(super) revocation_endpoint: Option<String>,
    pub(super) id_token_signing_alg_values_supported: Vec<String>,
}

pub(super) fn http_client() -> Result<Client, AiError> {
    Client::builder()
        .https_only(true)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(20))
        .pool_max_idle_per_host(2)
        .build()
        .map_err(|_| AiError::ConnectionUnavailable)
}

pub(super) async fn discover(client: &Client) -> Result<IssuerMetadata, AiError> {
    let response = client
        .get(DISCOVERY)
        .header(ACCEPT, "application/json")
        .send()
        .await
        .map_err(|_| AiError::ProviderUnavailable)?;
    if response.status().as_u16() != 200 {
        return Err(AiError::ProviderUnavailable);
    }
    let metadata: IssuerMetadata = serde_json::from_slice(&bounded_body(response).await?)
        .map_err(|_| AiError::InvalidProviderOutput)?;
    if metadata.issuer != OIDC_ISSUER
        || metadata.token_endpoint != TOKEN_ENDPOINT
        || !official_endpoint(&metadata.jwks_uri)
        || metadata
            .revocation_endpoint
            .as_ref()
            .is_some_and(|v| !official_endpoint(v))
        || metadata.id_token_signing_alg_values_supported.len() > 32
    {
        return Err(AiError::InvalidProviderOutput);
    }
    Ok(metadata)
}

fn official_endpoint(uri: &str) -> bool {
    url::Url::parse(uri).is_ok_and(|u| {
        u.scheme() == "https"
            && u.host_str() == Some("auth.openai.com")
            && u.port().is_none()
            && u.username().is_empty()
            && u.password().is_none()
            && u.query().is_none()
            && u.fragment().is_none()
    })
}

fn valid_loopback_callback(uri: &str) -> bool {
    url::Url::parse(uri).is_ok_and(|u| {
        u.scheme() == "http"
            && u.host_str() == Some("127.0.0.1")
            && u.port().is_some_and(|p| p != 0)
            && u.path() == "/auth/callback"
            && u.username().is_empty()
            && u.password().is_none()
            && u.query().is_none()
            && u.fragment().is_none()
            && uri == u.as_str()
    })
}

fn valid_client(client: &str) -> Result<(), AiError> {
    if client.is_empty()
        || client.len() > 200
        || client == "dynamic_agent_client"
        || !client
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        Err(AiError::InvalidInput)
    } else {
        Ok(())
    }
}

async fn post_form(
    client: &Client,
    endpoint: &str,
    fields: &[(&str, &str)],
) -> Result<Response, AiError> {
    let body = {
        let mut encoded = url::form_urlencoded::Serializer::new(String::new());
        for (key, value) in fields {
            encoded.append_pair(key, value);
        }
        encoded.finish()
    };
    if body.len() > MAX_FORM {
        return Err(AiError::LimitReached);
    }
    let mut headers = HeaderMap::new();
    let mut content_type = HeaderValue::from_static("application/x-www-form-urlencoded");
    content_type.set_sensitive(true);
    headers.insert(CONTENT_TYPE, content_type);
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
    // Raw reqwest errors contain request URLs and are deliberately never propagated/logged.
    client
        .post(endpoint)
        .headers(headers)
        .body(body)
        .send()
        .await
        .map_err(|_| AiError::ProviderUnavailable)
}

pub(super) async fn bounded_body(mut response: Response) -> Result<Vec<u8>, AiError> {
    if response
        .content_length()
        .is_some_and(|n| n > MAX_BODY as u64)
    {
        return Err(AiError::LimitReached);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| AiError::ProviderUnavailable)?
    {
        if chunk.len() > MAX_BODY.saturating_sub(body.len()) {
            return Err(AiError::LimitReached);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

pub(super) fn now_ms() -> Result<u64, AiError> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| AiError::ConnectionUnavailable)?
        .as_millis();
    u64::try_from(millis)
        .ok()
        .filter(|v| *v > 0 && *v <= MAX_SAFE_TIME)
        .ok_or(AiError::ConnectionUnavailable)
}

fn protected(value: Option<String>) -> Result<Option<ProtectedValue>, AiError> {
    value
        .map(ProtectedValue::from_trusted_adapter)
        .transpose()
        .map_err(|_| AiError::InvalidProviderOutput)
}

fn diagnostic(status: u16, body: &[u8]) -> ProviderDiagnostic {
    // Only protocol-defined codes leave the private response boundary; no arbitrary strings.
    let code = serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|v| {
            let error = v.get("error")?.as_str()?;
            matches!(
                error,
                "invalid_grant"
                    | "invalid_client"
                    | "unauthorized_client"
                    | "invalid_request"
                    | "unsupported_grant_type"
                    | "invalid_scope"
                    | "access_denied"
                    | "temporarily_unavailable"
                    | "server_error"
            )
            .then(|| error.to_owned())
        });
    ProviderDiagnostic {
        http_status: Some(status),
        code,
        parameter: None,
        request_id: None,
    }
}
