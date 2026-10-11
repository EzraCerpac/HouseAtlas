//! Versioned authenticated-encryption frame for private credential records.
//!
//! This encrypts bytes with caller-supplied associated data. It does not
//! establish an installation identity or current credential authority.

use crate::ai::AiError;
use ring::aead::{self, Aad, LessSafeKey, Nonce, UnboundKey};
use zeroize::Zeroizing;

use super::keys::SecretKey;

const MAGIC: &[u8; 8] = b"HACRED01";
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;
const HEADER_LEN: usize = MAGIC.len() + NONCE_LEN;
const MAX_PLAINTEXT_LEN: usize = 4 * 1024 * 1024;
const MIN_FRAME_LEN: usize = HEADER_LEN + TAG_LEN;
const MAX_FRAME_LEN: usize = MIN_FRAME_LEN + MAX_PLAINTEXT_LEN;
const UNAVAILABLE: AiError = AiError::DomainUnavailable;

fn aead_key(key: &SecretKey) -> Result<LessSafeKey, AiError> {
    // ring owns an opaque internal key representation; no zeroization of that
    // representation is claimed here. SecretKey owns the supplied key bytes.
    let unbound = UnboundKey::new(&aead::AES_256_GCM, key.expose()).map_err(|_| UNAVAILABLE)?;
    Ok(LessSafeKey::new(unbound))
}

pub(crate) fn seal(key: &SecretKey, aad: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, AiError> {
    if plaintext.len() > MAX_PLAINTEXT_LEN {
        return Err(AiError::LimitReached);
    }

    let key = aead_key(key)?;
    let mut nonce = [0_u8; NONCE_LEN];
    getrandom::fill(&mut nonce).map_err(|_| UNAVAILABLE)?;
    // Random nonces make collisions unlikely for bounded use; they do not
    // guarantee uniqueness across every use of an installation key.
    let mut scratch = Zeroizing::new(plaintext.to_vec());
    key.seal_in_place_append_tag(
        Nonce::assume_unique_for_key(nonce),
        Aad::from(aad),
        &mut *scratch,
    )
    .map_err(|_| UNAVAILABLE)?;

    let mut frame = Vec::with_capacity(HEADER_LEN + scratch.len());
    frame.extend_from_slice(MAGIC);
    frame.extend_from_slice(&nonce);
    frame.extend_from_slice(&scratch);
    Ok(frame)
}

pub(crate) fn open(
    key: &SecretKey,
    aad: &[u8],
    ciphertext: Vec<u8>,
) -> Result<Zeroizing<Vec<u8>>, AiError> {
    let mut frame = Zeroizing::new(ciphertext);
    if frame.len() > MAX_FRAME_LEN {
        return Err(AiError::LimitReached);
    }
    if frame.len() < MIN_FRAME_LEN || !frame.starts_with(MAGIC) {
        return Err(UNAVAILABLE);
    }

    let mut nonce = [0_u8; NONCE_LEN];
    nonce.copy_from_slice(&frame[MAGIC.len()..HEADER_LEN]);
    let key = aead_key(key)?;
    frame.drain(..HEADER_LEN);
    let plaintext_len = key
        .open_in_place(
            Nonce::assume_unique_for_key(nonce),
            Aad::from(aad),
            &mut frame,
        )
        .map_err(|_| UNAVAILABLE)?
        .len();
    frame.truncate(plaintext_len);
    Ok(frame)
}
