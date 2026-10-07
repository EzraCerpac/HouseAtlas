//! Checked lexical limits keep decimal arithmetic inside the processing envelope.
//! These limits bound representation work; canonical schemas still own value limits.

const MAX_TOKEN_BYTES: usize = 4096;
const MAX_DECIMAL_MAGNITUDE: i64 = 4096;

pub(super) struct NumberParts<'a> {
    negative: bool,
    integer: &'a [u8],
    fraction: &'a [u8],
    decimal_shift: i64,
}

impl NumberParts<'_> {
    fn digits(&self) -> impl DoubleEndedIterator<Item = u8> + Clone + '_ {
        self.integer.iter().chain(self.fraction.iter()).copied()
    }

    pub(super) fn is_integer(&self) -> bool {
        if self.digits().all(|digit| digit == b'0') || self.decimal_shift >= 0 {
            return true;
        }
        let Some(required_zeros) = self
            .decimal_shift
            .checked_neg()
            .and_then(|shift| usize::try_from(shift).ok())
        else {
            return false;
        };
        self.digits()
            .rev()
            .take_while(|digit| *digit == b'0')
            .count()
            >= required_zeros
    }

    pub(super) fn equals_i64(&self, expected: i64) -> bool {
        let digits = self.digits().skip_while(|digit| *digit == b'0');
        let Ok(coefficient_len) = i64::try_from(digits.clone().count()) else {
            return false;
        };
        if coefficient_len == 0 {
            return expected == 0;
        }
        if self.negative != (expected < 0) || !self.is_integer() {
            return false;
        }
        let expected_digits = expected.unsigned_abs().to_string();
        let Ok(expected_len) = i64::try_from(expected_digits.len()) else {
            return false;
        };
        if coefficient_len.checked_add(self.decimal_shift) != Some(expected_len) {
            return false;
        }
        // Negative shifts discard only zero suffixes; positive shifts supply zeros.
        // The comparison visits at most the expected i64's decimal digit count.
        digits
            .chain(std::iter::repeat(b'0'))
            .take(expected_digits.len())
            .eq(expected_digits.bytes())
    }
}

pub(super) fn analyze_number(number: &serde_json::Number) -> Result<NumberParts<'_>, &'static str> {
    analyze_literal(number.as_str())
}

pub(super) fn analyze_literal(literal: &str) -> Result<NumberParts<'_>, &'static str> {
    if literal.len() > MAX_TOKEN_BYTES {
        return Err("numeric token exceeds the 4096-byte processing limit");
    }
    let bytes = literal.as_bytes();
    let negative = bytes.first() == Some(&b'-');
    let mut offset = usize::from(negative);
    let integer_start = offset;
    match bytes.get(offset) {
        Some(b'0') => offset += 1,
        Some(b'1'..=b'9') => {
            while bytes.get(offset).is_some_and(u8::is_ascii_digit) {
                offset += 1;
            }
        }
        _ => return Err("invalid JSON numeric token"),
    }
    let integer = &bytes[integer_start..offset];
    let mut fraction = &bytes[offset..offset];
    if bytes.get(offset) == Some(&b'.') {
        offset += 1;
        let fraction_start = offset;
        while bytes.get(offset).is_some_and(u8::is_ascii_digit) {
            offset += 1;
        }
        if offset == fraction_start {
            return Err("invalid JSON numeric token");
        }
        fraction = &bytes[fraction_start..offset];
    }
    let mut exponent = 0_i64;
    if matches!(bytes.get(offset), Some(b'e' | b'E')) {
        offset += 1;
        let exponent_negative = bytes.get(offset) == Some(&b'-');
        if matches!(bytes.get(offset), Some(b'-' | b'+')) {
            offset += 1;
        }
        let exponent_start = offset;
        while let Some(digit) = bytes.get(offset).filter(|digit| digit.is_ascii_digit()) {
            exponent = exponent
                .checked_mul(10)
                .and_then(|value| value.checked_add(i64::from(*digit - b'0')))
                .filter(|value| *value <= MAX_DECIMAL_MAGNITUDE)
                .ok_or("numeric exponent exceeds the 4096 processing limit")?;
            offset += 1;
        }
        if offset == exponent_start {
            return Err("invalid JSON numeric token");
        }
        if exponent_negative {
            exponent = exponent
                .checked_neg()
                .ok_or("numeric exponent arithmetic exceeds the processing limit")?;
        }
    }
    if offset != bytes.len() {
        return Err("invalid JSON numeric token");
    }
    let fraction_len = i64::try_from(fraction.len())
        .map_err(|_| "numeric fraction length exceeds the processing limit")?;
    let decimal_shift = exponent
        .checked_sub(fraction_len)
        .ok_or("numeric decimal shift arithmetic exceeds the processing limit")?;
    if decimal_shift
        .checked_abs()
        .is_none_or(|magnitude| magnitude > MAX_DECIMAL_MAGNITUDE)
    {
        return Err("numeric decimal shift exceeds the 4096 processing limit");
    }
    Ok(NumberParts {
        negative,
        integer,
        fraction,
        decimal_shift,
    })
}
