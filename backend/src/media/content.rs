//! Bounded original PNG validation and optional stripped RGBA preview encoding;
//! PDF and UTF-8 text are originals
//! for download only. This validates framing, not PDF document safety.
use std::io::Write;

use flate2::{Compression, write::ZlibEncoder};

use super::types::{ContentType, PreviewPolicy};
use super::{MAX_BYTES, MediaError, MediaResult, WorkBudget};

const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
const MAX_PIXELS: u64 = 25_000_000;

/// Optional preview capability, never an original admission/availability limit.
/// The pixel codec synchronously filters/transforms each preview row.
pub const MAX_PNG_PREVIEW_ROW_BYTES: usize = 64 * 1024;

#[path = "png_decode.rs"]
mod png_decode;
#[path = "png_original.rs"]
mod png_original;

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

/// Original format validation is independent of optional preview rendering.
/// PNG inflation validates the declared raster in bounded windows, including
/// wide originals, without materializing/transformation of pixel rows.
pub fn validate_original_content(
    bytes: &[u8],
    content_type: ContentType,
    budget: &WorkBudget,
) -> MediaResult<()> {
    budget.check()?;
    match content_type {
        ContentType::Png => png_original::validate(bytes, &inspect_png(bytes, budget)?, budget),
        _ => validate_content(bytes, content_type, budget).map(|_| ()),
    }
}

fn inspect_png(bytes: &[u8], budget: &WorkBudget) -> MediaResult<[u8; 13]> {
    if bytes.len() > MAX_BYTES {
        return Err(MediaError::TooLarge);
    }
    if !bytes.starts_with(PNG_SIGNATURE) {
        return Err(MediaError::Unsupported);
    }
    let mut offset = 8usize;
    let mut header = None;
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
                if !matches!(
                    (h[9], h[8]),
                    (0, 1 | 2 | 4 | 8 | 16) | (2 | 4 | 6, 8 | 16) | (3, 1 | 2 | 4 | 8)
                ) || h[10] != 0
                    || h[11] != 0
                    || h[12] > 1
                {
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
            }
            b"IEND" => {
                if !has_idat || len != 0 || end != bytes.len() {
                    return Err(MediaError::Unsupported);
                }
                ended = true;
            }
            b"acTL" | b"fcTL" | b"fdAT" => return Err(MediaError::Unsupported),
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
    header.ok_or(MediaError::Unsupported)
}

pub fn render_png(bytes: &[u8], budget: &WorkBudget) -> MediaResult<Vec<u8>> {
    let header = inspect_png(bytes, budget)?;
    let width = u32::from_be_bytes(
        header[..4]
            .try_into()
            .map_err(|_| MediaError::Unsupported)?,
    );
    if !preview_rows_fit(&header) {
        return Err(MediaError::TooLarge);
    }
    let width = width as usize;
    let height = u32::from_be_bytes(
        header[4..8]
            .try_into()
            .map_err(|_| MediaError::Unsupported)?,
    ) as usize;
    let decoded = png_decode::decode(bytes, width, height, budget)?;
    let channels = decoded.channels;
    let stride = width
        .checked_mul(4)
        .and_then(|n| n.checked_add(1))
        .ok_or(MediaError::TooLarge)?;
    let mut row = Vec::new();
    row.try_reserve_exact(stride)
        .map_err(|_| MediaError::TooLarge)?;
    row.resize(stride, 0);
    let mut encoder = ZlibEncoder::new(LimitedOutput(Vec::new()), Compression::new(6));
    for samples in decoded.pixels.chunks_exact(decoded.line_size) {
        budget.check()?;
        for (index, (source, target)) in samples
            .chunks_exact(channels)
            .zip(row[1..].as_chunks_mut::<4>().0.iter_mut())
            .enumerate()
        {
            if index & 16383 == 0 {
                budget.check()?;
            }
            match channels {
                1 => target.copy_from_slice(&[source[0], source[0], source[0], 255]),
                2 => target.copy_from_slice(&[source[0], source[0], source[0], source[1]]),
                3 => target.copy_from_slice(&[source[0], source[1], source[2], 255]),
                _ => target.copy_from_slice(source),
            }
        }
        for chunk in row.chunks(65536) {
            budget.check()?;
            encoder.write_all(chunk).map_err(|_| MediaError::TooLarge)?;
        }
    }
    let mut header = header;
    header[8] = 8;
    header[9] = 6;
    header[12] = 0;
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

fn preview_rows_fit(header: &[u8; 13]) -> bool {
    let width = u64::from(u32::from_be_bytes(header[..4].try_into().unwrap()));
    let samples = match header[9] {
        0 | 3 => 1u64,
        2 => 3,
        4 => 2,
        _ => 4,
    };
    let source_row = (width * samples * u64::from(header[8])).div_ceil(8) + 1;
    source_row <= MAX_PNG_PREVIEW_ROW_BYTES as u64 && width * 4 <= MAX_PNG_PREVIEW_ROW_BYTES as u64
}

/// Called only after original validation. Row-ineligible originals are kept
/// without invoking the optional renderer; an actual successful bounded render
/// is the sole source of SafeRendered qualification. Budget failures propagate.
pub(super) fn qualify_original_preview(
    bytes: &[u8],
    content_type: ContentType,
    budget: &WorkBudget,
) -> MediaResult<PreviewPolicy> {
    budget.check()?;
    if content_type != ContentType::Png || !preview_rows_fit(&inspect_png(bytes, budget)?) {
        return Ok(PreviewPolicy::DownloadOnly);
    }
    let rendered = render_png(bytes, budget);
    budget.check()?;
    match rendered {
        Ok(_) => Ok(PreviewPolicy::SafeRendered),
        Err(MediaError::TooLarge | MediaError::Unsupported) => Ok(PreviewPolicy::DownloadOnly),
        Err(error) => Err(error),
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
