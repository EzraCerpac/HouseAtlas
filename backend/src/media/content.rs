//! Bounded static 8-bit RGB/RGBA PNG decoding; PDF and UTF-8 text are originals
//! for download only. This validates framing, not PDF document safety.
use std::io::{Read, Write};

use flate2::{Compression, read::ZlibDecoder, write::ZlibEncoder};

use super::types::ContentType;
use super::{MAX_BYTES, MediaError, MediaResult, WorkBudget};

const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
const MAX_PIXELS: u64 = 25_000_000;

pub fn validate_content(
    bytes: &[u8],
    content_type: ContentType,
    budget: &WorkBudget,
) -> MediaResult<Option<Vec<u8>>> {
    budget.check()?;
    if bytes.len() > MAX_BYTES {
        return Err(MediaError::TooLarge);
    }
    match content_type {
        ContentType::Png => render_png(bytes, budget).map(Some),
        ContentType::Pdf => {
            let version = bytes.get(..8).ok_or(MediaError::Unsupported)?;
            if &version[..5] != b"%PDF-"
                || !(matches!(&version[5..8], b"2.0")
                    || version[5] == b'1'
                        && version[6] == b'.'
                        && (b'0'..=b'7').contains(&version[7]))
                || !matches!(bytes.get(8), Some(b'\r' | b'\n'))
            {
                return Err(MediaError::Unsupported);
            }
            let tail = &bytes[bytes.len().saturating_sub(1024)..];
            let end = tail
                .iter()
                .rposition(|b| !b"\t\n\x0c\r ".contains(b))
                .map_or(0, |i| i + 1);
            if !tail[..end].ends_with(b"%%EOF") {
                return Err(MediaError::Unsupported);
            }
            budget.check()?;
            Ok(None)
        }
        ContentType::Text => {
            std::str::from_utf8(bytes).map_err(|_| MediaError::Unsupported)?;
            if bytes.contains(&0) {
                return Err(MediaError::Unsupported);
            }
            budget.check()?;
            Ok(None)
        }
    }
}

pub fn render_png(bytes: &[u8], budget: &WorkBudget) -> MediaResult<Vec<u8>> {
    if bytes.len() > MAX_BYTES {
        return Err(MediaError::TooLarge);
    }
    if !bytes.starts_with(PNG_SIGNATURE) {
        return Err(MediaError::Unsupported);
    }
    let mut offset = 8usize;
    let mut header = None;
    let mut idat = Vec::new();
    let mut state = 0u8;
    let mut has_idat = false;
    let mut ended = false;
    let mut palette = false;
    while offset < bytes.len() {
        budget.check()?;
        let prefix = bytes
            .get(offset..offset + 8)
            .ok_or(MediaError::Unsupported)?;
        let len = u32::from_be_bytes(
            prefix[..4]
                .try_into()
                .map_err(|_| MediaError::Unsupported)?,
        ) as usize;
        let end = offset
            .checked_add(len)
            .and_then(|n| n.checked_add(12))
            .ok_or(MediaError::Unsupported)?;
        let chunk = bytes.get(offset + 4..end).ok_or(MediaError::Unsupported)?;
        let kind = &chunk[..4];
        let data = &chunk[4..chunk.len() - 4];
        let crc = u32::from_be_bytes(
            chunk[chunk.len() - 4..]
                .try_into()
                .map_err(|_| MediaError::Unsupported)?,
        );
        if !kind.iter().all(u8::is_ascii_alphabetic)
            || kind[2] & 32 != 0
            || crc32fast::hash(&chunk[..chunk.len() - 4]) != crc
            || header.is_none() && kind != b"IHDR"
        {
            return Err(MediaError::Unsupported);
        }
        match kind {
            b"IHDR" => {
                if header.is_some() || len != 13 {
                    return Err(MediaError::Unsupported);
                }
                let h: [u8; 13] = data.try_into().map_err(|_| MediaError::Unsupported)?;
                let width =
                    u32::from_be_bytes(h[..4].try_into().map_err(|_| MediaError::Unsupported)?);
                let height =
                    u32::from_be_bytes(h[4..8].try_into().map_err(|_| MediaError::Unsupported)?);
                if width == 0
                    || height == 0
                    || width > 0x7fff_ffff
                    || height > 0x7fff_ffff
                    || u64::from(width) * u64::from(height) > MAX_PIXELS
                {
                    return Err(MediaError::TooLarge);
                }
                if h[8] != 8 || !matches!(h[9], 2 | 6) || h[10..].iter().any(|b| *b != 0) {
                    return Err(MediaError::Unsupported);
                }
                header = Some(h);
            }
            b"IDAT" => {
                if state == 2 {
                    return Err(MediaError::Unsupported);
                }
                state = 1;
                has_idat = true;
                idat.extend_from_slice(data);
            }
            b"IEND" => {
                if !has_idat || len != 0 || end != bytes.len() {
                    return Err(MediaError::Unsupported);
                }
                ended = true;
            }
            b"acTL" | b"fcTL" | b"fdAT" | b"tRNS" => return Err(MediaError::Unsupported),
            _ => {
                if state == 1 {
                    state = 2;
                }
                if kind == b"PLTE" {
                    if palette || state != 0 || len == 0 || len > 768 || !len.is_multiple_of(3) {
                        return Err(MediaError::Unsupported);
                    }
                    palette = true;
                } else if kind[0] & 32 == 0 {
                    return Err(MediaError::Unsupported);
                }
            }
        }
        offset = end;
    }
    if !ended {
        return Err(MediaError::Unsupported);
    }
    let header = header.ok_or(MediaError::Unsupported)?;
    let width = u32::from_be_bytes(
        header[..4]
            .try_into()
            .map_err(|_| MediaError::Unsupported)?,
    ) as usize;
    let height = u32::from_be_bytes(
        header[4..8]
            .try_into()
            .map_err(|_| MediaError::Unsupported)?,
    ) as usize;
    let bpp = if header[9] == 6 { 4 } else { 3 };
    let stride = width.checked_mul(bpp).ok_or(MediaError::TooLarge)?;
    let size = height.checked_mul(stride + 1).ok_or(MediaError::TooLarge)?;
    let mut decoder = ZlibDecoder::new(idat.as_slice());
    let mut raw = Vec::new();
    raw.try_reserve_exact(size)
        .map_err(|_| MediaError::TooLarge)?;
    let mut scratch = [0u8; 65536];
    loop {
        budget.check()?;
        let limit = scratch.len().min(size + 1 - raw.len());
        let read = decoder
            .read(&mut scratch[..limit])
            .map_err(|_| MediaError::Unsupported)?;
        if read == 0 {
            break;
        }
        raw.extend_from_slice(&scratch[..read]);
        if raw.len() > size {
            return Err(MediaError::Unsupported);
        }
    }
    if raw.len() != size {
        return Err(MediaError::Unsupported);
    }
    let mut scanlines = vec![0u8; size];
    for y in 0..height {
        budget.check()?;
        let row = y * (stride + 1);
        let filter = raw[row];
        if filter > 4 {
            return Err(MediaError::Unsupported);
        }
        for x in 0..stride {
            if x & 65535 == 0 {
                budget.check()?;
            }
            let at = row + 1 + x;
            let a = if x >= bpp { scanlines[at - bpp] } else { 0 };
            let b = if y > 0 { scanlines[at - stride - 1] } else { 0 };
            let c = if y > 0 && x >= bpp {
                scanlines[at - stride - 1 - bpp]
            } else {
                0
            };
            let add = match filter {
                0 => 0,
                1 => a,
                2 => b,
                3 => ((u16::from(a) + u16::from(b)) / 2) as u8,
                _ => paeth(a, b, c),
            };
            scanlines[at] = raw[at].wrapping_add(add);
        }
    }
    drop(raw);
    let mut encoder = ZlibEncoder::new(LimitedOutput(Vec::new()), Compression::new(6));
    for chunk in scanlines.chunks(65536) {
        budget.check()?;
        encoder.write_all(chunk).map_err(|_| MediaError::TooLarge)?;
    }
    let encoded = encoder.finish().map_err(|_| MediaError::TooLarge)?.0;
    budget.check()?;
    let mut output = PNG_SIGNATURE.to_vec();
    png_chunk(&mut output, b"IHDR", &header);
    png_chunk(&mut output, b"IDAT", &encoded);
    png_chunk(&mut output, b"IEND", &[]);
    if output.len() > MAX_BYTES {
        return Err(MediaError::TooLarge);
    }
    Ok(output)
}

fn paeth(a: u8, b: u8, c: u8) -> u8 {
    let (a, b, c) = (i32::from(a), i32::from(b), i32::from(c));
    let p = a + b - c;
    let (x, y, z) = ((p - a).abs(), (p - b).abs(), (p - c).abs());
    if x <= y && x <= z {
        a as u8
    } else if y <= z {
        b as u8
    } else {
        c as u8
    }
}

fn png_chunk(output: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    output.extend_from_slice(&(data.len() as u32).to_be_bytes());
    let start = output.len();
    output.extend_from_slice(kind);
    output.extend_from_slice(data);
    let crc = crc32fast::hash(&output[start..]);
    output.extend_from_slice(&crc.to_be_bytes());
}

struct LimitedOutput(Vec<u8>);

impl Write for LimitedOutput {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > MAX_BYTES.saturating_sub(self.0.len()) {
            return Err(std::io::Error::other("Media unavailable"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
