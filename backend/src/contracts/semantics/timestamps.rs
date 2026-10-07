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

/// Ajv-formats 3.0.1's full `date-time` format used by the published contract.
///
/// This is deliberately distinct from Date.parse: the format admits ECMAScript
/// whitespace separators and hour-only offsets, and its leap-second branch has
/// different admissibility rules. Retain the literal getTime arithmetic rather
/// than substituting a stricter RFC 3339 or successful-Date.parse check.
pub(in crate::contracts) fn published_date_time_format(value: &str) -> bool {
    // getDateTime splits on /t|\s/i and requires exactly two pieces. In
    // particular, extra whitespace (including a trailing newline) fails.
    let mut pieces =
        value.split(|character| matches!(character, 'T' | 't') || ecmascript_whitespace(character));
    let Some(date) = pieces.next() else {
        return false;
    };
    let Some(time) = pieces.next() else {
        return false;
    };
    if pieces.next().is_some() || !published_date_format(date) {
        return false;
    }
    published_time_format(time)
}

fn published_date_format(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    let Some(year) = decimal(&bytes[..4]) else {
        return false;
    };
    let Some(month) = decimal(&bytes[5..7]) else {
        return false;
    };
    let Some(day) = decimal(&bytes[8..10]) else {
        return false;
    };
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&day)
}

fn published_time_format(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() < 9 || bytes[2] != b':' || bytes[5] != b':' {
        return false;
    }
    let Some(hour) = decimal(&bytes[..2]) else {
        return false;
    };
    let Some(minute) = decimal(&bytes[3..5]) else {
        return false;
    };
    if decimal(&bytes[6..8]).is_none() {
        return false;
    }
    let mut cursor = 8;
    if bytes.get(cursor) == Some(&b'.') {
        cursor += 1;
        let start = cursor;
        while bytes.get(cursor).is_some_and(u8::is_ascii_digit) {
            cursor += 1;
        }
        if cursor == start {
            return false;
        }
    }
    // Ajv applies unary + to the entire seconds token. Parsing as f64 preserves
    // its rounding before sec < 60 / sec < 61, including long decimal fractions.
    let Ok(second) = value[6..cursor].parse::<f64>() else {
        return false;
    };
    let (offset_sign, offset_hour, offset_minute) = match &bytes[cursor..] {
        [b'Z' | b'z'] => (1, 0, 0),
        [sign @ (b'+' | b'-'), rest @ ..] => {
            let (offset_hour, offset_minute) = match rest {
                [_, _] => (decimal(rest), Some(0)),
                [_, _, _, _] => (decimal(&rest[..2]), decimal(&rest[2..])),
                [_, _, b':', _, _] => (decimal(&rest[..2]), decimal(&rest[3..])),
                _ => return false,
            };
            let (Some(offset_hour), Some(offset_minute)) = (offset_hour, offset_minute) else {
                return false;
            };
            (
                if *sign == b'-' { -1 } else { 1 },
                offset_hour,
                offset_minute,
            )
        }
        _ => return false,
    };
    if offset_hour > 23 || offset_minute > 59 {
        return false;
    }
    if hour <= 23 && minute <= 59 && second < 60.0 {
        return true;
    }
    // Source's leap-second branch intentionally performs only this one minute
    // carry and checks exact 23/-1 and 59/-1 values, without modulo reduction.
    let utc_minute = minute - offset_minute * offset_sign;
    let utc_hour = hour - offset_hour * offset_sign - i64::from(utc_minute < 0);
    matches!(utc_hour, 23 | -1) && matches!(utc_minute, 59 | -1) && second < 61.0
}

fn ecmascript_whitespace(value: char) -> bool {
    v8_legacy_whitespace(value) || matches!(value, '\u{2028}' | '\u{2029}')
}

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

pub(super) fn parse_milliseconds(value: &str) -> Option<i64> {
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
