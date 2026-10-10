//! Native OIDC security using jsonwebtoken's maintained signature/claim verifier.
//! Reference: https://developers.openai.com/siwc/token-sharing-open-source/sign-in
//! Dependency proposal: jsonwebtoken =11.1.0, default-features=false, aws_lc_rs.
//! Constructors are inert; only verify_identity obtains live issuer/JWKS documents.

use super::provider::{bounded_body, discover, http_client, now_ms};
use crate::ai::{AiError, PortFuture, oauth::*};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::Jwk};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

const SKEW_MS: u64 = 60_000;
const MAX_SAFE_TIME: u64 = 9_007_199_254_740_991;

pub struct NativeSecurity {
    client: reqwest::Client,
    website_callback: Option<(String, String)>,
}

impl NativeSecurity {
    pub fn new() -> Result<Self, AiError> {
        Ok(Self {
            client: http_client()?,
            website_callback: None,
        })
    }

    /// Optional trusted website configuration only. This does not install a
    /// website provider, issue a client, or enable a website grant in startup.
    pub fn with_website_callback(exact_uri: String, exact_host: String) -> Result<Self, AiError> {
        if !valid_https_callback(&exact_uri, &exact_host) {
            return Err(AiError::InvalidInput);
        }
        Ok(Self {
            client: http_client()?,
            website_callback: Some((exact_uri, exact_host)),
        })
    }

    async fn verify(
        &self,
        token: &ProtectedValue,
        requirements: IdentityRequirements<'_>,
    ) -> IdentityValidation {
        let raw = token.expose_in_trusted_boundary();
        if requirements.issuer != OIDC_ISSUER
            || requirements.audience.is_empty()
            || requirements.audience.len() > 512
            || requirements.received_at_ms == 0
            || requirements.received_at_ms > MAX_SAFE_TIME
        {
            return IdentityValidation::Invalid;
        }
        let current = match now_ms() {
            Ok(value) => value,
            Err(_) => return IdentityValidation::TemporarilyUnavailable,
        };
        if requirements.received_at_ms > current.saturating_add(SKEW_MS) {
            return IdentityValidation::Invalid;
        }
        let header = match decode_header(raw) {
            Ok(value) => value,
            Err(_) => return IdentityValidation::Invalid,
        };
        // An explicit RS256-only profile avoids accepting symmetric keys or an
        // algorithm chosen solely by the untrusted token. Discovery must agree.
        if header.alg != Algorithm::RS256 {
            return IdentityValidation::Invalid;
        }
        let Some(kid) = header
            .kid
            .as_deref()
            .filter(|v| !v.is_empty() && v.len() <= 256)
        else {
            return IdentityValidation::Invalid;
        };
        // Reject unsupported critical/embedded-key headers, even when a JWT
        // library's permissive Header deserializer would otherwise ignore them.
        let Some(encoded_header) = raw.split('.').next() else {
            return IdentityValidation::Invalid;
        };
        let header_json = match URL_SAFE_NO_PAD
            .decode(encoded_header)
            .ok()
            .and_then(|v| serde_json::from_slice::<Value>(&v).ok())
        {
            Some(Value::Object(value)) => value,
            _ => return IdentityValidation::Invalid,
        };
        if ["crit", "jku", "x5u", "jwk", "b64"]
            .iter()
            .any(|field| header_json.contains_key(*field))
        {
            return IdentityValidation::Invalid;
        }
        let metadata = match discover(&self.client).await {
            Ok(value) => value,
            Err(_) => return IdentityValidation::TemporarilyUnavailable,
        };
        if !metadata
            .id_token_signing_alg_values_supported
            .iter()
            .any(|v| v == "RS256")
        {
            return IdentityValidation::Invalid;
        }
        let response = match self
            .client
            .get(&metadata.jwks_uri)
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
        {
            Ok(value) if value.status().as_u16() == 200 => value,
            _ => return IdentityValidation::TemporarilyUnavailable,
        };
        let body = match bounded_body(response).await {
            Ok(value) => value,
            Err(_) => return IdentityValidation::TemporarilyUnavailable,
        };
        let document: Value = match serde_json::from_slice(&body) {
            Ok(value) => value,
            Err(_) => return IdentityValidation::TemporarilyUnavailable,
        };
        let Some(keys) = document
            .get("keys")
            .and_then(Value::as_array)
            .filter(|v| v.len() <= 128)
        else {
            return IdentityValidation::TemporarilyUnavailable;
        };
        let mut matching = keys
            .iter()
            .filter(|key| key.get("kid").and_then(Value::as_str) == Some(kid));
        let Some(key_json) = matching.next() else {
            return IdentityValidation::Invalid;
        };
        if matching.next().is_some()
            || key_json.get("kty").and_then(Value::as_str) != Some("RSA")
            || key_json
                .get("alg")
                .is_some_and(|v| v.as_str() != Some("RS256"))
            || key_json
                .get("use")
                .is_some_and(|v| v.as_str() != Some("sig"))
            || key_json.get("key_ops").is_some_and(|v| {
                v.as_array().is_none_or(|ops| {
                    ops.is_empty() || ops.iter().any(|op| op.as_str() != Some("verify"))
                })
            })
        {
            return IdentityValidation::Invalid;
        }
        let jwk: Jwk = match serde_json::from_value(key_json.clone()) {
            Ok(value) => value,
            Err(_) => return IdentityValidation::TemporarilyUnavailable,
        };
        let key = match DecodingKey::from_jwk(&jwk) {
            Ok(value) => value,
            Err(_) => return IdentityValidation::TemporarilyUnavailable,
        };
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[OIDC_ISSUER]);
        validation.set_audience(&[requirements.audience]);
        validation.set_required_spec_claims(&["iss", "aud", "exp", "sub"]);
        // jsonwebtoken uses the wall clock for exp/nbf. Verification of a
        // durably received exchange must use its original receipt clock instead.
        // Signature, required claims, issuer and audience remain library verified;
        // only NumericDate comparisons below use the lifecycle's trusted receipt.
        validation.validate_exp = false;
        validation.validate_nbf = false;
        let claims = match decode::<Claims>(raw, &key, &validation) {
            Ok(value) => value.claims,
            Err(_) => return IdentityValidation::Invalid,
        };
        if !claims_valid(&claims, &requirements) {
            return IdentityValidation::Invalid;
        }
        IdentityValidation::Verified(VerifiedIdentity {
            subject: claims.sub,
            name: claims.name,
            email: claims.email,
        })
    }
}

impl SecurityPort for NativeSecurity {
    fn fresh<'a>(&'a self) -> PortFuture<'a, FreshAuthorization> {
        Box::pin(async move {
            let state = random_value()?;
            let nonce = random_value()?;
            let verifier = random_value()?;
            let s256_challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(
                verifier.expose_in_trusted_boundary().as_bytes(),
            ));
            Ok(FreshAuthorization {
                state,
                nonce,
                verifier,
                s256_challenge,
            })
        })
    }
    fn state_matches(&self, expected: &ProtectedValue, returned: &str) -> bool {
        // Generated states are canonical base64url of independent 32-byte values.
        // Callback values have already been query-decoded once by the trusted host.
        if returned.len() != 43 || expected.expose_in_trusted_boundary().len() != 43 {
            return false;
        }
        let left = URL_SAFE_NO_PAD.decode(expected.expose_in_trusted_boundary());
        let right = URL_SAFE_NO_PAD.decode(returned);
        match (left, right) {
            (Ok(left), Ok(right)) if left.len() == 32 && right.len() == 32 => {
                bool::from(left.ct_eq(&right))
            }
            _ => false,
        }
    }
    fn validate_website_callback(&self, uri: &str, host: &str) -> Result<(), AiError> {
        if self
            .website_callback
            .as_ref()
            .is_some_and(|(registered_uri, registered_host)| {
                uri == registered_uri && host == registered_host
            })
            && valid_https_callback(uri, host)
        {
            Ok(())
        } else {
            Err(AiError::InvalidInput)
        }
    }
    fn verify_identity<'a>(
        &'a self,
        token: &'a ProtectedValue,
        requirements: IdentityRequirements<'a>,
    ) -> PortFuture<'a, IdentityValidation> {
        Box::pin(async move { Ok(self.verify(token, requirements).await) })
    }
}

fn random_value() -> Result<ProtectedValue, AiError> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| AiError::ConnectionUnavailable)?;
    ProtectedValue::from_trusted_adapter(URL_SAFE_NO_PAD.encode(bytes))
}

fn valid_https_callback(uri: &str, host: &str) -> bool {
    let Ok(parsed) = url::Url::parse(uri) else {
        return false;
    };
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.fragment().is_some()
        || uri != parsed.as_str()
    {
        return false;
    }
    // URL serialization supplies canonical bracketed IPv6 and explicit ports.
    let authority = &parsed[url::Position::BeforeHost..url::Position::AfterPort];
    authority == host
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Audience {
    One(String),
    Many(Vec<String>),
}

#[derive(Deserialize)]
struct Claims {
    iss: String,
    sub: String,
    aud: Audience,
    exp: u64,
    iat: u64,
    nbf: Option<u64>,
    azp: Option<String>,
    nonce: Option<String>,
    name: Option<String>,
    email: Option<String>,
}

fn claims_valid(claims: &Claims, requirements: &IdentityRequirements<'_>) -> bool {
    if claims.iss != OIDC_ISSUER
        || claims.sub.is_empty()
        || claims.sub.len() > 1024
        || claims.sub.chars().any(char::is_control)
        || claims
            .name
            .as_ref()
            .is_some_and(|v| v.len() > 1024 || v.chars().any(char::is_control))
        || claims
            .email
            .as_ref()
            .is_some_and(|v| v.len() > 1024 || v.chars().any(char::is_control))
    {
        return false;
    }
    let audience_count = match &claims.aud {
        Audience::One(value) if value == requirements.audience => 1,
        Audience::Many(values)
            if !values.is_empty()
                && values.len() <= 32
                && values.iter().all(|v| !v.is_empty() && v.len() <= 512)
                && values.iter().any(|v| v == requirements.audience) =>
        {
            values.len()
        }
        _ => return false,
    };
    if claims
        .azp
        .as_ref()
        .is_some_and(|v| v != requirements.audience)
        || (audience_count > 1 && claims.azp.is_none())
    {
        return false;
    }
    let Some(expiry) = claims.exp.checked_mul(1000).filter(|v| *v <= MAX_SAFE_TIME) else {
        return false;
    };
    let Some(issued) = claims
        .iat
        .checked_mul(1000)
        .filter(|v| *v > 0 && *v <= MAX_SAFE_TIME)
    else {
        return false;
    };
    if expiry <= issued
        || expiry.saturating_add(SKEW_MS) <= requirements.received_at_ms
        || issued > requirements.received_at_ms.saturating_add(SKEW_MS)
    {
        return false;
    }
    if let Some(nbf) = claims.nbf {
        let Some(not_before) = nbf.checked_mul(1000).filter(|v| *v <= MAX_SAFE_TIME) else {
            return false;
        };
        if not_before > requirements.received_at_ms.saturating_add(SKEW_MS) || not_before >= expiry
        {
            return false;
        }
    }
    if let Some(expected) = requirements.nonce {
        let Some(returned) = claims.nonce.as_deref().filter(|v| v.len() <= 256) else {
            return false;
        };
        // Hash fixed-size digests to avoid a length-dependent secret comparison.
        let expected_hash = Sha256::digest(expected.expose_in_trusted_boundary().as_bytes());
        let returned_hash = Sha256::digest(returned.as_bytes());
        if !bool::from(expected_hash.ct_eq(&returned_hash)) {
            return false;
        }
    }
    true
}
