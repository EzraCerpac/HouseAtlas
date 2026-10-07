//! Incremental pinned-codec decoding. Its whole-row filter/transform work is
//! bounded before codec allocation; every input feed and returned row checks
//! the same operation budget. This supplies no hard preemption guarantee.
use std::io::{self, BufRead, Cursor, Read, Seek, SeekFrom};

use super::{MAX_PIXELS, MAX_PNG_DECODE_ROW_BYTES};
use crate::media::{MediaError, MediaResult, WorkBudget};

const INPUT_FEED_BYTES: usize = 4096;

pub(super) struct DecodedPng {
    pub pixels: Vec<u8>,
    pub channels: usize,
    pub line_size: usize,
}

struct BudgetInput<'a> {
    cursor: Cursor<&'a [u8]>,
    budget: &'a WorkBudget,
}

impl BudgetInput<'_> {
    fn check(&self) -> io::Result<()> {
        self.budget
            .check()
            .map_err(|_| io::Error::other("Media unavailable"))
    }
}

impl Read for BudgetInput<'_> {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        self.check()?;
        let length = output.len().min(INPUT_FEED_BYTES);
        self.cursor.read(&mut output[..length])
    }
}

impl BufRead for BudgetInput<'_> {
    fn fill_buf(&mut self) -> io::Result<&[u8]> {
        // png consumes BufRead directly. A checked Read hidden behind another
        // buffer would miss its repeated inflation calls on buffered input.
        self.check()?;
        let input = self.cursor.fill_buf()?;
        Ok(&input[..input.len().min(INPUT_FEED_BYTES)])
    }

    fn consume(&mut self, amount: usize) {
        self.cursor.consume(amount);
    }
}

impl Seek for BudgetInput<'_> {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        self.check()?;
        self.cursor.seek(position)
    }
}

fn checked<T>(result: Result<T, png::DecodingError>, budget: &WorkBudget) -> MediaResult<T> {
    // Budget failures use the existing private unavailable response, rather
    // than becoming an unsupported-format response through the codec's I/O.
    budget.check()?;
    result.map_err(|_| MediaError::Unsupported)
}

pub(super) fn decode(
    bytes: &[u8],
    width: usize,
    height: usize,
    budget: &WorkBudget,
) -> MediaResult<DecodedPng> {
    budget.check()?;
    let input = BudgetInput {
        cursor: Cursor::new(bytes),
        budget,
    };
    let mut decoder = png::Decoder::new(input);
    decoder.set_limits(png::Limits {
        bytes: 256 * 1024 * 1024,
    });
    decoder.set_ignore_text_chunk(true);
    decoder.set_ignore_iccp_chunk(true);
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = checked(decoder.read_info(), budget)?;
    let (color, depth) = reader.output_color_type();
    if reader.info().width as usize != width
        || reader.info().height as usize != height
        || depth != png::BitDepth::Eight
        || color == png::ColorType::Indexed
    {
        return Err(MediaError::Unsupported);
    }
    let channels = color.samples();
    let line_size = reader
        .output_line_size(reader.info().width)
        .ok_or(MediaError::TooLarge)?;
    let size = reader.output_buffer_size().ok_or(MediaError::TooLarge)?;
    if line_size != width.checked_mul(channels).ok_or(MediaError::TooLarge)?
        || size != line_size.checked_mul(height).ok_or(MediaError::TooLarge)?
        || line_size > MAX_PNG_DECODE_ROW_BYTES
        || size > (MAX_PIXELS as usize) * 4
    {
        return Err(MediaError::TooLarge);
    }
    let mut pixels = Vec::new();
    pixels
        .try_reserve_exact(size)
        .map_err(|_| MediaError::TooLarge)?;
    while pixels.len() < size {
        budget.check()?;
        pixels.resize((pixels.len() + MAX_PNG_DECODE_ROW_BYTES).min(size), 0);
    }
    let interlaced = reader.info().interlaced;
    let mut ordinary_rows = 0usize;
    let mut decoded_bytes = 0usize;
    loop {
        budget.check()?;
        let Some(row) = checked(reader.next_interlaced_row(), budget)? else {
            break;
        };
        let data = row.data();
        decoded_bytes = decoded_bytes
            .checked_add(data.len())
            .ok_or(MediaError::TooLarge)?;
        if data.is_empty()
            || !data.len().is_multiple_of(channels)
            || data.len() > line_size
            || decoded_bytes > size
        {
            return Err(MediaError::Unsupported);
        }
        match row.interlace() {
            png::InterlaceInfo::Null(_) if !interlaced => {
                if data.len() != line_size || ordinary_rows >= height {
                    return Err(MediaError::Unsupported);
                }
                let offset = ordinary_rows * line_size;
                pixels[offset..offset + line_size].copy_from_slice(data);
                ordinary_rows += 1;
            }
            png::InterlaceInfo::Adam7(info) if interlaced => {
                png::expand_interlaced_row(
                    &mut pixels,
                    line_size,
                    data,
                    info,
                    (channels * 8) as u8,
                );
            }
            _ => return Err(MediaError::Unsupported),
        }
        budget.check()?;
    }
    if decoded_bytes != size || !interlaced && ordinary_rows != height {
        return Err(MediaError::Unsupported);
    }
    checked(reader.finish(), budget)?;
    Ok(DecodedPng {
        pixels,
        channels,
        line_size,
    })
}
