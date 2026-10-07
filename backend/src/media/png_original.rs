//! Original PNG validation without optional preview pixel transformations.
//! The public pinned codec inflates bounded windows while we check the declared
//! packed raster/filter layout. No row-sized allocation or unfilter is needed:
//! legal PNG filters are total byte transforms, and palette expansion is total
//! once the required palette exists. This returns no rendered/safe pixel data.
use png::{Decoded, StreamingDecoder, UnfilterRegion};

use crate::media::{MediaError, MediaResult, WorkBudget};

const INPUT_BYTES: usize = 4096;
const LOOKBACK_BYTES: usize = 32768;
const OUTPUT_BYTES: usize = 8192;
const BUFFER_BYTES: usize = LOOKBACK_BYTES + OUTPUT_BYTES;

struct Pass {
    row_bytes: u64,
    rows: u32,
}

struct Raster {
    passes: Vec<Pass>,
    pass: usize,
    row: u32,
    row_remaining: u64,
    remaining: u64,
    reader_bytes: u64,
}

impl Raster {
    fn new(header: &[u8; 13]) -> MediaResult<Self> {
        let width = u32::from_be_bytes(header[..4].try_into().unwrap());
        let height = u32::from_be_bytes(header[4..8].try_into().unwrap());
        let samples = match header[9] {
            0 | 3 => 1u64,
            2 => 3,
            4 => 2,
            _ => 4,
        };
        // Only packed row layout is calculated here; pixel deinterlacing stays
        // with the pinned codec in the separate bounded preview operation.
        let layout: &[(u32, u32, u32, u32)] = if header[12] == 0 {
            &[(0, 0, 1, 1)]
        } else {
            &[
                (0, 0, 8, 8),
                (4, 0, 8, 8),
                (0, 4, 4, 8),
                (2, 0, 4, 4),
                (0, 2, 2, 4),
                (1, 0, 2, 2),
                (0, 1, 1, 2),
            ]
        };
        let mut passes = Vec::with_capacity(7);
        let mut remaining = 0u64;
        let mut reader_bytes = 0u64;
        for &(x, y, dx, dy) in layout {
            let pixels = width.saturating_sub(x).div_ceil(dx);
            let rows = height.saturating_sub(y).div_ceil(dy);
            let row_bytes = (u64::from(pixels) * samples * u64::from(header[8])).div_ceil(8);
            // Match Reader's start_frame accounting, which includes a filter
            // byte for zero-width Adam7 passes even though no row is returned.
            reader_bytes += (row_bytes + 1) * u64::from(rows);
            if pixels == 0 || rows == 0 {
                continue;
            }
            remaining = remaining
                .checked_add((row_bytes + 1) * u64::from(rows))
                .ok_or(MediaError::TooLarge)?;
            passes.push(Pass { row_bytes, rows });
        }
        Ok(Self {
            passes,
            pass: 0,
            row: 0,
            row_remaining: 0,
            remaining,
            reader_bytes,
        })
    }

    fn consume(&mut self, mut bytes: &[u8]) -> MediaResult<()> {
        if bytes.len() as u64 > self.remaining {
            return Err(MediaError::Unsupported);
        }
        self.remaining -= bytes.len() as u64;
        while !bytes.is_empty() {
            let pass = self.passes.get(self.pass).ok_or(MediaError::Unsupported)?;
            if self.row_remaining == 0 {
                if bytes[0] > 4 {
                    return Err(MediaError::Unsupported);
                }
                bytes = &bytes[1..];
                self.row_remaining = pass.row_bytes;
            }
            let count = (self.row_remaining.min(bytes.len() as u64)) as usize;
            self.row_remaining -= count as u64;
            bytes = &bytes[count..];
            if self.row_remaining == 0 {
                self.row += 1;
                if self.row == pass.rows {
                    self.row = 0;
                    self.pass += 1;
                }
            }
        }
        Ok(())
    }

    fn complete(&self) -> bool {
        self.remaining == 0 && self.pass == self.passes.len() && self.row_remaining == 0
    }
}

pub(super) fn validate(bytes: &[u8], header: &[u8; 13], budget: &WorkBudget) -> MediaResult<()> {
    let mut raster = Raster::new(header)?;
    let declared = raster.remaining;
    let mut reader_remaining = raster.reader_bytes;
    let mut produced = 0u64;
    let mut released = 0u64;
    let mut decoder = StreamingDecoder::new();
    decoder.set_ignore_text_chunk(true);
    decoder.set_ignore_iccp_chunk(true);
    let mut buffer = vec![0; BUFFER_BYTES];
    let mut region = UnfilterRegion::default();
    let mut offset = 0usize;
    let mut flushed = false;
    loop {
        budget.check()?;
        // Public codec invariants preserve its last 32KiB of history. Every
        // appended byte was checked before compaction; no history is rewritten.
        buffer.copy_within(region.available..region.filled, 0);
        region.filled -= region.available;
        region.available = 0;
        let old_filled = region.filled;
        // Match Reader's bounded inflation headroom and last-row completion:
        // its frame budget reaching zero makes all bytes mutable; otherwise
        // its public inflater watermark must cover the actual final row.
        // Then finish with no sink, as Reader does after returning every row.
        buffer.resize(
            old_filled + reader_remaining.min(OUTPUT_BYTES as u64) as usize,
            0,
        );
        let end = offset.saturating_add(INPUT_BYTES).min(bytes.len());
        if end == offset {
            return Err(MediaError::Unsupported);
        }
        let ready = raster.complete() && (reader_remaining == 0 || released >= declared);
        let result = if ready {
            decoder.update(&bytes[offset..end], None)
        } else {
            decoder.update(&bytes[offset..end], Some(&mut region.as_buf(&mut buffer)))
        };
        budget.check()?;
        let (consumed, event) = result.map_err(|_| MediaError::Unsupported)?;
        if consumed > end - offset || region.filled > buffer.len() {
            return Err(MediaError::Unsupported);
        }
        let appended = region.filled - old_filled;
        reader_remaining -= appended as u64;
        let count = raster.remaining.min(appended as u64) as usize;
        raster.consume(&buffer[old_filled..old_filled + count])?;
        produced += appended as u64;
        released = produced.saturating_sub((region.filled - region.available) as u64);
        offset += consumed;
        match event {
            Decoded::ChunkBegin(_, kind) if kind == png::chunk::IDAT => {
                if decoder.info().is_none_or(|info| {
                    info.color_type == png::ColorType::Indexed && info.palette.is_none()
                }) {
                    return Err(MediaError::Unsupported);
                }
            }
            Decoded::ImageDataFlushed => {
                if !raster.complete() || (reader_remaining != 0 && released < declared) {
                    return Err(MediaError::Unsupported);
                }
                flushed = true;
            }
            Decoded::ChunkComplete(kind) if kind == png::chunk::IEND => {
                if !flushed || !raster.complete() || offset != bytes.len() {
                    return Err(MediaError::Unsupported);
                }
                return budget.check();
            }
            _ => (), // Preserve the codec's benign ancillary metadata policy.
        }
    }
}
