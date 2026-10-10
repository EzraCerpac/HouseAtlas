//! Native Media 0.1.2 JPEG readability validation; never a sanitizer or renderer.
//! The input, dimensions, output and scan count are bounded. The decoder has
//! internal allocations and no cancellation callback: output size is not peak
//! memory, and WorkBudget checks cannot interrupt its synchronous decode.
use super::{MAX_BYTES, MAX_PIXELS, MediaError, MediaResult, WorkBudget};
use zune_jpeg::{
    JpegDecoder,
    zune_core::{bytestream::ZCursor, colorspace::ColorSpace, options::DecoderOptions},
};

const MAX_DIMENSION: usize = 16_384;
const MAX_SCANS: usize = 100;
const MAX_RGB_BYTES: usize = 75_000_000;

pub(super) fn validate(bytes: &[u8], budget: &WorkBudget) -> MediaResult<()> {
    budget.check()?;
    if bytes.len() > MAX_BYTES {
        return Err(MediaError::TooLarge);
    }
    if bytes.len() < 4 || !bytes.starts_with(b"\xff\xd8") || !bytes.ends_with(b"\xff\xd9") {
        return Err(MediaError::Unsupported);
    }
    let options = DecoderOptions::default()
        .set_strict_mode(true)
        .set_use_unsafe(false)
        .set_max_width(MAX_DIMENSION)
        .set_max_height(MAX_DIMENSION)
        .jpeg_set_max_scans(MAX_SCANS)
        .jpeg_set_out_colorspace(ColorSpace::RGB);
    let mut decoder = JpegDecoder::new_with_options(ZCursor::new(bytes), options);
    decoder
        .decode_headers()
        .map_err(|_| MediaError::Unsupported)?;
    budget.check()?;
    let info = decoder.info().ok_or(MediaError::Unsupported)?;
    if info.width == 0
        || info.height == 0
        || u64::from(info.width) * u64::from(info.height) > MAX_PIXELS
    {
        return Err(MediaError::TooLarge);
    }
    let length = decoder.output_buffer_size().ok_or(MediaError::TooLarge)?;
    if length > MAX_RGB_BYTES {
        return Err(MediaError::TooLarge);
    }
    let mut decoded = Vec::new();
    decoded
        .try_reserve_exact(length)
        .map_err(|_| MediaError::TooLarge)?;
    decoded.resize(length, 0);
    decoder
        .decode_into(&mut decoded)
        .map_err(|_| MediaError::Unsupported)?;
    budget.check()?;
    // No pixels, EXIF facts, transformed bytes or preview proofs leave this validator.
    Ok(())
}
