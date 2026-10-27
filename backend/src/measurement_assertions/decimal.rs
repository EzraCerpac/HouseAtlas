use std::cmp::Ordering;

use super::{ValidationError, ValidationResult};

/// Original fixed-point entry token, including leading/trailing zeros. Exact
/// here means lossless entry, never physical accuracy. No f64 conversion exists.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecimalToken(String);

impl DecimalToken {
    /// Deliberately bounded v1 grammar: ASCII digits, optional dot and digits;
    /// 64 bytes maximum, 18 fractional digits maximum, positive dimensions only.
    /// Locale/exponent/fraction parsing requires a separately reviewed boundary.
    pub fn parse(token: &str) -> ValidationResult<Self> {
        if token.is_empty() || token.len() > 64 {
            return Err(ValidationError("decimal token length"));
        }
        let (whole, fraction) = token.split_once('.').unwrap_or((token, ""));
        if whole.is_empty()
            || !whole.bytes().all(|c| c.is_ascii_digit())
            || (token.contains('.') && fraction.is_empty())
            || fraction.len() > 18
            || !fraction.bytes().all(|c| c.is_ascii_digit())
            || !token.bytes().any(|c| matches!(c, b'1'..=b'9'))
        {
            return Err(ValidationError("positive fixed-point decimal required"));
        }
        Ok(Self(token.to_owned()))
    }

    pub fn token(&self) -> &str {
        &self.0
    }

    // Comparison-only normalized decimal in millimetres or square millimetres.
    // Powers of ten are digit shifts, so even 64-byte entries remain exact.
    fn base_parts(&self, shift: usize) -> (String, String) {
        let (whole, fraction) = self.0.split_once('.').unwrap_or((&self.0, ""));
        let mut digits = format!("{whole}{fraction}");
        let scale = fraction.len().saturating_sub(shift);
        if shift > fraction.len() {
            digits.extend(std::iter::repeat_n('0', shift - fraction.len()));
        }
        let split = digits.len() - scale;
        let integral = digits[..split].trim_start_matches('0');
        (
            if integral.is_empty() { "0" } else { integral }.to_owned(),
            digits[split..].trim_end_matches('0').to_owned(),
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuantityKind {
    Length,
    Area,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unit {
    Millimetre,
    Centimetre,
    Metre,
    SquareMillimetre,
    SquareCentimetre,
    SquareMetre,
}

impl Unit {
    pub fn kind(self) -> QuantityKind {
        match self {
            Self::Millimetre | Self::Centimetre | Self::Metre => QuantityKind::Length,
            Self::SquareMillimetre | Self::SquareCentimetre | Self::SquareMetre => {
                QuantityKind::Area
            }
        }
    }

    fn base_shift(self) -> usize {
        match self {
            Self::Millimetre | Self::SquareMillimetre => 0,
            Self::Centimetre => 1,
            Self::Metre => 3,
            Self::SquareCentimetre => 2,
            Self::SquareMetre => 6,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExactQuantity {
    pub entered: DecimalToken,
    pub unit: Unit,
    pub kind: QuantityKind,
}

impl ExactQuantity {
    pub fn validate(&self) -> ValidationResult<()> {
        if self.unit.kind() != self.kind {
            return Err(ValidationError("unit and quantity kind disagree"));
        }
        Ok(())
    }

    /// Exact metric comparison, independent of token spelling and display
    /// rounding. V1 applies no implicit tolerance or inferred precision.
    pub fn compare(&self, other: &Self) -> ValidationResult<Ordering> {
        self.validate()?;
        other.validate()?;
        if self.kind != other.kind {
            return Err(ValidationError("cannot compare different quantity kinds"));
        }
        let (a, af) = self.entered.base_parts(self.unit.base_shift());
        let (b, bf) = other.entered.base_parts(other.unit.base_shift());
        let integral = a.len().cmp(&b.len()).then_with(|| a.cmp(&b));
        if integral != Ordering::Equal {
            return Ok(integral);
        }
        let width = af.len().max(bf.len());
        Ok(af
            .bytes()
            .chain(std::iter::repeat(b'0'))
            .take(width)
            .cmp(bf.bytes().chain(std::iter::repeat(b'0')).take(width)))
    }
}
