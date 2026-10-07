use std::fmt;

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use scrypt::{Params, scrypt};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

use super::{AccessError, AccessResult};

const PREFIX: &str = "scrypt:32768:8:1:";

/// Compatible with the published salted scrypt verifier. Never a browser DTO.
#[derive(Clone)]
pub struct PasswordVerifier(String);

impl PasswordVerifier {
    pub fn parse(value: impl Into<String>) -> AccessResult<Self> {
        let value = value.into();
        let Some(tail) = value.strip_prefix(PREFIX) else {
            return Err(AccessError::InvalidInput);
        };
        let Some((salt, digest)) = tail.split_once(':') else {
            return Err(AccessError::InvalidInput);
        };
        if decode_hex::<16>(salt).is_none() || decode_hex::<32>(digest).is_none() {
            return Err(AccessError::InvalidInput);
        }
        Ok(Self(value))
    }

    pub(super) fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for PasswordVerifier {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("PasswordVerifier([redacted])")
    }
}

fn valid_password(password: &str) -> bool {
    password.encode_utf16().count() >= 12 && password.len() <= 1024
}

/// Trusted provisioning seam; no provisioning route or account bootstrap exists.
pub fn hash_password(password: &str) -> AccessResult<PasswordVerifier> {
    if !valid_password(password) {
        return Err(AccessError::InvalidInput);
    }
    let salt = random_bytes::<16>()?;
    let digest = derive(password.as_bytes(), &salt)?;
    PasswordVerifier::parse(format!("{PREFIX}{}:{}", hex(&salt), hex(&digest)))
}

pub(super) fn verify_password(
    password: &str,
    verifier: Option<&PasswordVerifier>,
) -> AccessResult<bool> {
    let (salt, expected) = verifier
        .and_then(|v| v.as_str().strip_prefix(PREFIX)?.split_once(':'))
        .and_then(|(s, d)| Some((decode_hex::<16>(s)?, decode_hex::<32>(d)?)))
        .unwrap_or(([0; 16], [0; 32]));
    let valid = valid_password(password);
    let input = if valid {
        password.as_bytes()
    } else {
        b"invalid-synthetic-password"
    };
    let actual = derive(input, &salt)?;
    let matched = bool::from(actual.ct_eq(&expected));
    Ok(valid && verifier.is_some() && matched)
}

fn derive(password: &[u8], salt: &[u8; 16]) -> AccessResult<[u8; 32]> {
    let params = Params::new(15, 8, 1, 32).map_err(|_| AccessError::Unavailable)?;
    let mut result = [0; 32];
    scrypt(password, salt, &params, &mut result).map_err(|_| AccessError::Unavailable)?;
    Ok(result)
}

pub(super) fn random_bytes<const N: usize>() -> AccessResult<[u8; N]> {
    let mut bytes = [0; N];
    getrandom::fill(&mut bytes).map_err(|_| AccessError::Unavailable)?;
    Ok(bytes)
}

pub(super) fn nonce() -> AccessResult<String> {
    Ok(URL_SAFE_NO_PAD.encode(random_bytes::<32>()?))
}

pub(super) fn digest(value: &str) -> String {
    hex(&Sha256::digest(value.as_bytes()))
}

pub(super) fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(DIGITS[(b >> 4) as usize] as char);
        out.push(DIGITS[(b & 15) as usize] as char);
    }
    out
}

fn decode_hex<const N: usize>(value: &str) -> Option<[u8; N]> {
    if value.len() != 2 * N
        || !value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return None;
    }
    let mut result = [0; N];
    for (index, slot) in result.iter_mut().enumerate() {
        *slot = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).ok()?;
    }
    Some(result)
}
