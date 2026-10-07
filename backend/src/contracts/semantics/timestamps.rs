//! Date.parse comparisons for the published schema's date-time strings.
//!
//! The domain is a four-digit calendar date, one T/t or ECMAScript whitespace
//! separator, HH:MM:SS with optional decimal fraction, and a required Z/z or
//! signed HH, HHMM or HH:MM offset. Shape validation owns admissibility. This
//! does not implement JavaScript's general legacy-date grammar or local time.
//!
//! Source compatibility is scoped to Node 26.10.0's V8 dateparser-inl.h,
//! dateparser.h and dateparser.cc. T/t selects ISO parsing, where hour-only
//! offsets fail; whitespace selects the legacy branch, including its small-year
//! interpretation. U+2028/U+2029 become invalid legacy keywords in that tokenizer.
//! Leap seconds produce NaN, so either ordered comparison is false. Fractions
//! use V8's numeral/millisecond conversion, including its long-fraction quirk.
//! These helpers never rewrite the timestamp's original wire bytes.

/// The published `Date.parse(left) < Date.parse(right)` comparison.
pub fn date_less(left: &str, right: &str) -> bool {
    match (parse_milliseconds(left), parse_milliseconds(right)) {
        (Some(left), Some(right)) => left < right,
        _ => false,
    }
}

/// The published `Date.parse(left) > Date.parse(right)` comparison.
pub fn date_greater(left: &str, right: &str) -> bool {
    match (parse_milliseconds(left), parse_milliseconds(right)) {
        (Some(left), Some(right)) => left > right,
        _ => false,
    }
}

fn parse_milliseconds(value: &str) -> Option<i64> {
    let bytes = value.as_bytes();
    if bytes.get(4) != Some(&b'-') || bytes.get(7) != Some(&b'-') {
        return None;
    }
    let mut year = decimal(bytes.get(0..4)?)?;
    let mut month = decimal(bytes.get(5..7)?)?;
    let mut day = decimal(bytes.get(8..10)?)?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    let separator = value.get(10..)?.chars().next()?;
    let iso = matches!(separator, 'T' | 't');
    if !iso && !v8_legacy_whitespace(separator) {
        return None;
    }
    let time = value.get(10 + separator.len_utf8()..)?.as_bytes();
    if time.get(2) != Some(&b':') || time.get(5) != Some(&b':') {
        return None;
    }
    let hour = decimal(time.get(0..2)?)?;
    let minute = decimal(time.get(3..5)?)?;
    let second = decimal(time.get(6..8)?)?;
    if minute > 59 || second > 59 || hour > 24 {
        return None;
    }

    let mut cursor = 8;
    let mut milliseconds = 0;
    let mut fraction_number = 0;
    if time.get(cursor) == Some(&b'.') {
        cursor += 1;
        let start = cursor;
        while time.get(cursor).is_some_and(u8::is_ascii_digit) {
            cursor += 1;
        }
        let fraction = time.get(start..cursor)?;
        if fraction.is_empty() {
            return None;
        }
        fraction_number = v8_numeral(fraction);
        milliseconds = v8_milliseconds(fraction_number, fraction.len());
    }
    if hour == 24
        && (minute != 0 || second != 0 || milliseconds != 0 || (iso && fraction_number != 0))
    {
        return None;
    }

    let zone = time.get(cursor..)?;
    let offset_minutes = match zone {
        [b'Z' | b'z'] => 0,
        [sign @ (b'+' | b'-'), rest @ ..] => {
            let (offset_hour, offset_minute) = match rest {
                [_, _] if !iso => (decimal(rest)?, 0),
                [_, _, _, _] => (decimal(rest.get(0..2)?)?, decimal(rest.get(2..4)?)?),
                [_, _, b':', _, _] => (decimal(rest.get(0..2)?)?, decimal(rest.get(3..5)?)?),
                _ => return None,
            };
            if offset_hour > 23 || offset_minute > 59 {
                return None;
            }
            let offset = offset_hour.checked_mul(60)?.checked_add(offset_minute)?;
            if *sign == b'-' { -offset } else { offset }
        }
        _ => return None,
    };

    if !iso {
        // V8 DayComposer::Write chooses MDY when the first date component is
        // 1..31, then expands years 0..49 to 2000..2049 and 50..99 to 1950..1999.
        if (1..=31).contains(&year) {
            (year, month, day) = (day, year, month);
        }
        if !(1..=12).contains(&month) {
            return None;
        }
        if (0..=49).contains(&year) {
            year += 2000;
        } else if (50..=99).contains(&year) {
            year += 1900;
        }
    }

    // Within four-digit years all results are integral, exactly representable
    // JavaScript millisecond values, and comfortably inside Date's TimeClip.
    let days = days_from_civil(year, month, day)?;
    let time_minutes = hour.checked_mul(60)?.checked_add(minute)?;
    let local_seconds = days
        .checked_mul(86_400)?
        .checked_add(time_minutes.checked_mul(60)?)?
        .checked_add(second)?;
    local_seconds
        .checked_sub(offset_minutes.checked_mul(60)?)?
        .checked_mul(1_000)?
        .checked_add(milliseconds)
}

fn decimal(bytes: &[u8]) -> Option<i64> {
    if bytes.is_empty() {
        return None;
    }
    bytes.iter().try_fold(0_i64, |value, byte| {
        if !byte.is_ascii_digit() {
            return None;
        }
        value.checked_mul(10)?.checked_add(i64::from(byte - b'0'))
    })
}

fn v8_numeral(bytes: &[u8]) -> i64 {
    // InputReader::ReadUnsignedNumeral first skips every leading zero, then
    // retains at most nine significant digits while consuming the full token.
    bytes
        .iter()
        .skip_while(|byte| **byte == b'0')
        .take(9)
        .fold(0_i64, |value, byte| value * 10 + i64::from(byte - b'0'))
}

fn v8_milliseconds(number: i64, length: usize) -> i64 {
    // ReadMilliseconds uses the original token length, capped at nine. For
    // ordinary fractions this pads/truncates to milliseconds. Long fractions
    // with leading zeros retain the published tokenizer's different result.
    match length {
        1 => number * 100,
        2 => number * 10,
        3 => number,
        _ => number / 10_i64.pow((length.min(9) - 3) as u32),
    }
}

fn v8_legacy_whitespace(value: char) -> bool {
    // The V8 tokenizer tests words before whitespace. U+2028/U+2029 are line
    // terminators but not IsWhiteSpace, so they fail as words after the date.
    matches!(
        value,
        '\u{0009}'..='\u{000d}'
            | ' '
            | '\u{00a0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200a}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
            | '\u{feff}'
    )
}

fn days_from_civil(year: i64, month: i64, day: i64) -> Option<i64> {
    const BEFORE_MONTH: [i64; 12] = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    let before_month = *BEFORE_MONTH.get(usize::try_from(month.checked_sub(1)?).ok()?)?;
    let previous_year = year.checked_sub(1)?;
    let leap_days =
        previous_year.div_euclid(4) - previous_year.div_euclid(100) + previous_year.div_euclid(400);
    let leap_day = i64::from(month > 2 && year % 4 == 0 && (year % 100 != 0 || year % 400 == 0));
    year.checked_mul(365)?
        .checked_add(leap_days)?
        .checked_add(before_month)?
        .checked_add(leap_day)?
        .checked_add(day.checked_sub(1)?)?
        .checked_sub(719_527)
}
