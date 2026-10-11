//! Bounded retained geometry framing. USDZ stays an original archive, never a
//! rendered preview. This does not execute USD, resolve layers or tessellate IFC.
use super::types::{ContentType, sha256};
use super::{MAX_BYTES, MediaError, MediaResult, WorkBudget};
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UsdzLayer {
    pub name: String,
    pub sha256: String,
    pub byte_size: u64,
}
fn bad() -> MediaError {
    MediaError::Unsupported
}
fn u16_at(bytes: &[u8], at: usize) -> MediaResult<usize> {
    Ok(u16::from_le_bytes(
        bytes
            .get(at..at + 2)
            .ok_or_else(bad)?
            .try_into()
            .map_err(|_| bad())?,
    ) as usize)
}
fn u32_at(bytes: &[u8], at: usize) -> MediaResult<usize> {
    Ok(u32::from_le_bytes(
        bytes
            .get(at..at + 4)
            .ok_or_else(bad)?
            .try_into()
            .map_err(|_| bad())?,
    ) as usize)
}
/// This fixed intake profile accepts one root USDC followed by bounded PNG
/// texture members. All names, CRCs, stored sizes and local/central records agree.
/// Texture members are retained; no extraction, decoding or URL loading occurs.
pub fn inspect_usdz(bytes: &[u8], budget: &WorkBudget) -> MediaResult<UsdzLayer> {
    budget.check()?;
    if bytes.len() > MAX_BYTES || bytes.len() < 22 {
        return Err(bad());
    }
    let end = bytes.len() - 22;
    if bytes.get(end..end + 4) != Some(b"PK\x05\x06")
        || u16_at(bytes, end + 4)? != 0
        || u16_at(bytes, end + 6)? != 0
        || u16_at(bytes, end + 20)? != 0
    {
        return Err(bad());
    }
    let count = u16_at(bytes, end + 10)?;
    if !(1..=8).contains(&count) || count != u16_at(bytes, end + 8)? {
        return Err(bad());
    }
    let mut central = u32_at(bytes, end + 16)?;
    if central.checked_add(u32_at(bytes, end + 12)?) != Some(end) {
        return Err(bad());
    }
    let central_start = central;
    let mut local = 0usize;
    let mut names = BTreeSet::new();
    let mut root = None;
    for index in 0..count {
        budget.check()?;
        if bytes.get(central..central + 4) != Some(b"PK\x01\x02")
            || u16_at(bytes, central + 8)? != 0
            || u16_at(bytes, central + 10)? != 0
            || u16_at(bytes, central + 34)? != 0
            || u32_at(bytes, central + 42)? != local
        {
            return Err(bad());
        }
        let length = u32_at(bytes, central + 20)?;
        let name_len = u16_at(bytes, central + 28)?;
        let extra_len = u16_at(bytes, central + 30)?;
        let comment_len = u16_at(bytes, central + 32)?;
        if length == 0
            || length > MAX_BYTES
            || length != u32_at(bytes, central + 24)?
            || name_len == 0
            || name_len > 256
            || comment_len != 0
        {
            return Err(bad());
        }
        let name_bytes = bytes
            .get(central + 46..central + 46 + name_len)
            .ok_or_else(bad)?;
        let name = std::str::from_utf8(name_bytes).map_err(|_| bad())?;
        if !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-./".contains(&b))
            || name.starts_with('/')
            || name
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
            || !names.insert(name.to_owned())
        {
            return Err(bad());
        }
        if bytes.get(local..local + 4) != Some(b"PK\x03\x04")
            || u16_at(bytes, local + 6)? != 0
            || u16_at(bytes, local + 8)? != 0
            || u32_at(bytes, local + 14)? != u32_at(bytes, central + 16)?
            || u32_at(bytes, local + 18)? != length
            || u32_at(bytes, local + 22)? != length
            || u16_at(bytes, local + 26)? != name_len
        {
            return Err(bad());
        }
        let extra = u16_at(bytes, local + 28)?;
        let data_at = local.checked_add(30 + name_len + extra).ok_or_else(bad)?;
        if data_at % 64 != 0 || bytes.get(local + 30..local + 30 + name_len) != Some(name_bytes) {
            return Err(bad());
        }
        // Some authored USDZs repeat their alignment padding in the central
        // directory. Accept only the exact mirrored, zero-filled 0x1986 field;
        // no other central extra field acquires meaning or authority here.
        if extra_len != 0 {
            let padding = bytes
                .get(central + 46 + name_len..central + 46 + name_len + extra_len)
                .ok_or_else(bad)?;
            if !(4..=67).contains(&extra_len)
                || extra != extra_len
                || bytes.get(local + 30 + name_len..data_at) != Some(padding)
                || u16_at(padding, 0)? != 0x1986
                || u16_at(padding, 2)? != extra_len - 4
                || padding[4..].iter().any(|byte| *byte != 0)
            {
                return Err(bad());
            }
        }
        // USDZ's alignment extra is opaque padding, bounded by the ZIP field.
        let data_end = data_at.checked_add(length).ok_or_else(bad)?;
        if data_end > central_start {
            return Err(bad());
        }
        let data = bytes.get(data_at..data_end).ok_or_else(bad)?;
        if crc32fast::hash(data) as usize != u32_at(bytes, central + 16)? {
            return Err(bad());
        }
        if index == 0 {
            if name.contains('/') || !name.ends_with(".usdc") || !data.starts_with(b"PXR-USDC") {
                return Err(bad());
            }
            root = Some(UsdzLayer {
                name: name.to_owned(),
                sha256: sha256(data),
                byte_size: length as u64,
            });
        } else if !name.ends_with(".png") || !data.starts_with(b"\x89PNG\r\n\x1a\n") {
            return Err(bad());
        }
        local = data_end;
        central = central
            .checked_add(46 + name_len + extra_len)
            .ok_or_else(bad)?;
    }
    if central != end || local != central_start {
        return Err(bad());
    }
    budget.check()?;
    root.ok_or_else(bad)
}

pub fn validate(bytes: &[u8], kind: ContentType, budget: &WorkBudget) -> MediaResult<()> {
    match kind {
        ContentType::Usdz => inspect_usdz(bytes, budget).map(|_| ()),
        ContentType::Ifc => {
            budget.check()?;
            if bytes.len() > MAX_BYTES || bytes.is_empty() || bytes.contains(&0) {
                return Err(bad());
            }
            let text = std::str::from_utf8(bytes).map_err(|_| bad())?.trim();
            if !text.starts_with("ISO-10303-21;")
                || !text.ends_with("END-ISO-10303-21;")
                || !text.contains("FILE_SCHEMA(('IFC")
            {
                return Err(bad());
            }
            budget.check()
        }
        _ => Err(bad()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn stored_archive(mirrored: bool) -> Vec<u8> {
        let members = [
            ("root.usdc", b"PXR-USDC synthetic retained layer".as_slice()),
            (
                "0/texture.png",
                b"\x89PNG\r\n\x1a\n synthetic retained texture".as_slice(),
            ),
        ];
        let mut bytes = Vec::new();
        let mut central = Vec::new();
        for (name, data) in members {
            let offset = bytes.len();
            let name = name.as_bytes();
            let padding_len = (64 - (offset + 30 + name.len()) % 64) % 64;
            let padding_len = if padding_len < 4 {
                padding_len + 64
            } else {
                padding_len
            };
            let mut padding = Vec::from(0x1986u16.to_le_bytes());
            padding.extend_from_slice(&((padding_len - 4) as u16).to_le_bytes());
            padding.resize(padding_len, 0);
            let crc = crc32fast::hash(data);
            bytes.extend_from_slice(b"PK\x03\x04");
            bytes.extend_from_slice(&20u16.to_le_bytes());
            bytes.extend_from_slice(&[0; 8]);
            bytes.extend_from_slice(&crc.to_le_bytes());
            bytes.extend_from_slice(&(data.len() as u32).to_le_bytes());
            bytes.extend_from_slice(&(data.len() as u32).to_le_bytes());
            bytes.extend_from_slice(&(name.len() as u16).to_le_bytes());
            bytes.extend_from_slice(&(padding.len() as u16).to_le_bytes());
            bytes.extend_from_slice(name);
            bytes.extend_from_slice(&padding);
            assert_eq!(bytes.len() % 64, 0);
            bytes.extend_from_slice(data);
            central.extend_from_slice(b"PK\x01\x02");
            central.extend_from_slice(&20u16.to_le_bytes());
            central.extend_from_slice(&20u16.to_le_bytes());
            central.extend_from_slice(&[0; 8]);
            central.extend_from_slice(&crc.to_le_bytes());
            central.extend_from_slice(&(data.len() as u32).to_le_bytes());
            central.extend_from_slice(&(data.len() as u32).to_le_bytes());
            central.extend_from_slice(&(name.len() as u16).to_le_bytes());
            central.extend_from_slice(
                &(if mirrored { padding.len() as u16 } else { 0 }).to_le_bytes(),
            );
            central.extend_from_slice(&[0; 10]);
            central.extend_from_slice(&(offset as u32).to_le_bytes());
            central.extend_from_slice(name);
            if mirrored {
                central.extend_from_slice(&padding);
            }
        }
        let central_offset = bytes.len();
        bytes.extend_from_slice(&central);
        bytes.extend_from_slice(b"PK\x05\x06");
        bytes.extend_from_slice(&[0; 4]);
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&(central.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&(central_offset as u32).to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes
    }

    #[test]
    fn healthy_stored_usdz_with_mirrored_alignment_padding() {
        let expected = b"PXR-USDC synthetic retained layer";
        for mirrored in [false, true] {
            let bytes = stored_archive(mirrored);
            let budget = WorkBudget::new(
                Duration::from_secs(10),
                super::super::Cancellation::default(),
            )
            .unwrap();
            let layer = inspect_usdz(&bytes, &budget).unwrap();
            assert_eq!(layer.name, "root.usdc");
            assert_eq!(layer.byte_size, expected.len() as u64);
            assert_eq!(layer.sha256, sha256(expected));
            validate(&bytes, ContentType::Usdz, &budget).unwrap();
        }
    }
}
