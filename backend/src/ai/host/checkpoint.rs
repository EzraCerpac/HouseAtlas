//! Private checkpoint codec for the encrypted credential boundary only.
//! These plaintext buffers are never HTTP/browser DTOs, diagnostics or files.
//! Encryption, ciphertext authenticity, storage and memory hygiene remain with
//! that boundary; successful encoding authorizes no activation or token reuse.
use crate::ai::{
    AiError,
    oauth::{ProtectedValue, RefreshCheckpoint, RegistrationBinding, TokenReply},
};
use serde::{Deserialize, Serialize};

const MAX_BYTES: usize = 1024 * 1024;

/// Intentionally has no Debug, Display, Clone or Serialize implementation.
pub struct CheckpointPlaintext(Vec<u8>);
impl CheckpointPlaintext {
    /// Supply solely to the existing OS-backed authenticated encryption adapter.
    pub fn expose_for_encryption(&self) -> &[u8] {
        &self.0
    }
}

#[derive(Serialize)]
struct Frame<'a> {
    version: u8,
    checkpoint: Encoded<'a>,
}
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum Encoded<'a> {
    None,
    InvocationUnconfirmed {
        binding: BindingRef<'a>,
    },
    Received {
        binding: BindingRef<'a>,
        reply: ReplyRef<'a>,
    },
    ExchangeReceived {
        binding: BindingRef<'a>,
        client_id: &'a str,
        nonce: &'a str,
        reply: ReplyRef<'a>,
    },
}
#[derive(Serialize)]
struct BindingRef<'a> {
    registration_id: &'a str,
    actor_id: &'a str,
    workspace_id: &'a str,
    home_id: &'a str,
    authority_epoch: &'a str,
    cancellation_epoch: &'a str,
}
impl<'a> From<&'a RegistrationBinding> for BindingRef<'a> {
    fn from(b: &'a RegistrationBinding) -> Self {
        Self {
            registration_id: &b.registration_id,
            actor_id: &b.actor_id,
            workspace_id: &b.workspace_id,
            home_id: &b.home_id,
            authority_epoch: &b.authority_epoch,
            cancellation_epoch: &b.cancellation_epoch,
        }
    }
}
#[derive(Serialize)]
struct ReplyRef<'a> {
    id_token: Option<&'a str>,
    access_token: Option<&'a str>,
    refresh_token: Option<&'a str>,
    token_type: Option<&'a str>,
    expires_at_ms: Option<u64>,
    granted_scopes: Option<&'a [String]>,
    received_at_ms: u64,
}
impl<'a> From<&'a TokenReply> for ReplyRef<'a> {
    fn from(r: &'a TokenReply) -> Self {
        Self {
            id_token: r
                .id_token
                .as_ref()
                .map(ProtectedValue::expose_in_trusted_boundary),
            access_token: r
                .access_token
                .as_ref()
                .map(ProtectedValue::expose_in_trusted_boundary),
            refresh_token: r
                .refresh_token
                .as_ref()
                .map(ProtectedValue::expose_in_trusted_boundary),
            token_type: r.token_type.as_deref(),
            expires_at_ms: r.expires_at_ms,
            granted_scopes: r.granted_scopes.as_deref(),
            received_at_ms: r.received_at_ms,
        }
    }
}
/// Retain raw received material, including unverified fields, exactly. This
/// codec performs no issuer/scope/expiry decision; the shared lifecycle does.
pub fn encode(checkpoint: &RefreshCheckpoint) -> Result<CheckpointPlaintext, AiError> {
    let checkpoint = match checkpoint {
        RefreshCheckpoint::None => Encoded::None,
        RefreshCheckpoint::InvocationUnconfirmed(b) => {
            Encoded::InvocationUnconfirmed { binding: b.into() }
        }
        RefreshCheckpoint::Received { binding, reply } => Encoded::Received {
            binding: binding.into(),
            reply: reply.into(),
        },
        RefreshCheckpoint::ExchangeReceived {
            binding,
            client_id,
            nonce,
            reply,
        } => Encoded::ExchangeReceived {
            binding: binding.into(),
            client_id,
            nonce: nonce.expose_in_trusted_boundary(),
            reply: reply.into(),
        },
    };
    let bytes = serde_json::to_vec(&Frame {
        version: 1,
        checkpoint,
    })
    .map_err(|_| AiError::DomainUnavailable)?;
    if bytes.len() > MAX_BYTES {
        return Err(AiError::LimitReached);
    }
    Ok(CheckpointPlaintext(bytes))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DecodedFrame {
    version: u8,
    checkpoint: Decoded,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
enum Decoded {
    None,
    InvocationUnconfirmed {
        binding: BindingValue,
    },
    Received {
        binding: BindingValue,
        reply: ReplyValue,
    },
    ExchangeReceived {
        binding: BindingValue,
        client_id: String,
        nonce: String,
        reply: ReplyValue,
    },
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BindingValue {
    registration_id: String,
    actor_id: String,
    workspace_id: String,
    home_id: String,
    authority_epoch: String,
    cancellation_epoch: String,
}
impl From<BindingValue> for RegistrationBinding {
    fn from(b: BindingValue) -> Self {
        Self {
            registration_id: b.registration_id,
            actor_id: b.actor_id,
            workspace_id: b.workspace_id,
            home_id: b.home_id,
            authority_epoch: b.authority_epoch,
            cancellation_epoch: b.cancellation_epoch,
        }
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReplyValue {
    id_token: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    token_type: Option<String>,
    expires_at_ms: Option<u64>,
    granted_scopes: Option<Vec<String>>,
    received_at_ms: u64,
}
impl ReplyValue {
    fn into_reply(self) -> Result<TokenReply, AiError> {
        Ok(TokenReply {
            id_token: self
                .id_token
                .map(ProtectedValue::from_trusted_adapter)
                .transpose()?,
            access_token: self
                .access_token
                .map(ProtectedValue::from_trusted_adapter)
                .transpose()?,
            refresh_token: self
                .refresh_token
                .map(ProtectedValue::from_trusted_adapter)
                .transpose()?,
            token_type: self.token_type,
            expires_at_ms: self.expires_at_ms,
            granted_scopes: self.granted_scopes,
            received_at_ms: self.received_at_ms,
        })
    }
}
/// Call only on bytes decrypted/authenticated by the same-registration owner.
/// Never accept model/browser input here or fall back to plaintext storage.
pub fn decode(decrypted: &[u8]) -> Result<RefreshCheckpoint, AiError> {
    if decrypted.len() > MAX_BYTES {
        return Err(AiError::LimitReached);
    }
    let frame: DecodedFrame =
        serde_json::from_slice(decrypted).map_err(|_| AiError::DomainUnavailable)?;
    if frame.version != 1 {
        return Err(AiError::DomainUnavailable);
    }
    Ok(match frame.checkpoint {
        Decoded::None => RefreshCheckpoint::None,
        Decoded::InvocationUnconfirmed { binding } => {
            RefreshCheckpoint::InvocationUnconfirmed(binding.into())
        }
        Decoded::Received { binding, reply } => RefreshCheckpoint::Received {
            binding: binding.into(),
            reply: reply.into_reply()?,
        },
        Decoded::ExchangeReceived {
            binding,
            client_id,
            nonce,
            reply,
        } => RefreshCheckpoint::ExchangeReceived {
            binding: binding.into(),
            client_id,
            nonce: ProtectedValue::from_trusted_adapter(nonce)?,
            reply: reply.into_reply()?,
        },
    })
}
