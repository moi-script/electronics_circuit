//! Parsing of engineering values like `4.7k`, `100n`, `2meg`.

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum SiError {
    #[error("empty value")]
    Empty,
    #[error("'{0}' is not a number")]
    NotANumber(String),
    #[error("'{0}' is out of range")]
    OutOfRange(String),
}

/// Parses an engineering value. Case rules: `meg`/`M` = 1e6, `m` = 1e-3,
/// `f` = 1e-15, `F` = farad (x1). Other scale letters are case-insensitive.
/// Unknown trailing letters are treated as units and ignored.
pub fn parse_si(input: &str) -> Result<f64, SiError> {
    let s = input.trim();
    if s.is_empty() {
        return Err(SiError::Empty);
    }
    let len = numeric_prefix_len(s);
    if len == 0 {
        return Err(SiError::NotANumber(s.to_string()));
    }
    let mantissa = &s[..len];
    let exponent = scale_exponent(&s[len..]);
    // Parse "4.7e3" rather than computing 4.7 * 1000, which is not exact.
    let parsed = if exponent == 0 {
        mantissa.parse::<f64>()
    } else if mantissa.contains(['e', 'E']) {
        mantissa.parse::<f64>().map(|v| v * 10f64.powi(exponent))
    } else {
        format!("{mantissa}e{exponent}").parse::<f64>()
    };
    let value = parsed.map_err(|_| SiError::NotANumber(s.to_string()))?;
    if !value.is_finite() {
        return Err(SiError::OutOfRange(s.to_string()));
    }
    Ok(value)
}

/// Writes a value in a form every SPICE accepts, e.g. `4.7e3`.
pub fn format_spice(value: f64) -> String {
    format!("{value:e}")
}

fn numeric_prefix_len(s: &str) -> usize {
    let b = s.as_bytes();
    let mut i = 0;
    if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
        i += 1;
    }
    let mut digits = 0;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
        digits += 1;
    }
    if i < b.len() && b[i] == b'.' {
        i += 1;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
            digits += 1;
        }
    }
    if digits == 0 {
        return 0;
    }
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        let mut j = i + 1;
        if j < b.len() && (b[j] == b'+' || b[j] == b'-') {
            j += 1;
        }
        let exp_start = j;
        while j < b.len() && b[j].is_ascii_digit() {
            j += 1;
        }
        if j > exp_start {
            i = j;
        }
    }
    i
}

fn scale_exponent(suffix: &str) -> i32 {
    let suffix = suffix.trim();
    if suffix.to_lowercase().starts_with("meg") {
        return 6;
    }
    match suffix.chars().next() {
        Some('T' | 't') => 12,
        Some('G' | 'g') => 9,
        Some('M') => 6,
        Some('K' | 'k') => 3,
        Some('m') => -3,
        Some('U' | 'u' | 'µ' | 'μ') => -6,
        Some('N' | 'n') => -9,
        Some('P' | 'p') => -12,
        Some('f') => -15,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() <= b.abs() * 1e-12 + 1e-30
    }

    #[test]
    fn plain_numbers() {
        assert_eq!(parse_si("10").unwrap(), 10.0);
        assert_eq!(parse_si(" -2.5 ").unwrap(), -2.5);
        assert_eq!(parse_si(".5").unwrap(), 0.5);
        assert_eq!(parse_si("1e3").unwrap(), 1000.0);
        assert_eq!(parse_si("3E-3").unwrap(), 0.003);
    }

    #[test]
    fn scale_suffixes() {
        assert!(close(parse_si("4.7k").unwrap(), 4700.0));
        assert!(close(parse_si("4.7K").unwrap(), 4700.0));
        assert!(close(parse_si("2meg").unwrap(), 2e6));
        assert!(close(parse_si("2MEG").unwrap(), 2e6));
        assert!(close(parse_si("2M").unwrap(), 2e6));
        assert!(close(parse_si("5m").unwrap(), 5e-3));
        assert!(close(parse_si("10u").unwrap(), 10e-6));
        assert!(close(parse_si("10µ").unwrap(), 10e-6));
        assert!(close(parse_si("100n").unwrap(), 100e-9));
        assert!(close(parse_si("22p").unwrap(), 22e-12));
        assert!(close(parse_si("3f").unwrap(), 3e-15));
        assert!(close(parse_si("1G").unwrap(), 1e9));
        assert!(close(parse_si("1T").unwrap(), 1e12));
    }

    #[test]
    fn units_are_ignored() {
        assert!(close(parse_si("10uF").unwrap(), 10e-6));
        assert!(close(parse_si("1F").unwrap(), 1.0));
        assert!(close(parse_si("5V").unwrap(), 5.0));
        assert!(close(parse_si("1kΩ").unwrap(), 1000.0));
        assert!(close(parse_si("10mA").unwrap(), 10e-3));
        assert!(close(parse_si("60Hz").unwrap(), 60.0));
    }

    #[test]
    fn rejects_non_numbers() {
        assert_eq!(parse_si(""), Err(SiError::Empty));
        assert_eq!(parse_si("   "), Err(SiError::Empty));
        assert_eq!(parse_si("abc"), Err(SiError::NotANumber("abc".into())));
        assert_eq!(parse_si("-"), Err(SiError::NotANumber("-".into())));
        assert_eq!(parse_si("."), Err(SiError::NotANumber(".".into())));
    }

    #[test]
    fn rejects_non_finite_values() {
        assert_eq!(parse_si("1e400"), Err(SiError::OutOfRange("1e400".into())));
        assert_eq!(parse_si("-1e400"), Err(SiError::OutOfRange("-1e400".into())));
        assert_eq!(parse_si("1e308k"), Err(SiError::OutOfRange("1e308k".into())));
    }

    #[test]
    fn formats_for_spice() {
        assert_eq!(format_spice(4700.0), "4.7e3");
        assert_eq!(format_spice(10.0), "1e1");
        assert_eq!(format_spice(0.0), "0e0");
        assert_eq!(format_spice(1e-5), "1e-5");
        assert_eq!(format_spice(parse_si("4.7k").unwrap()), "4.7e3");
        assert_eq!(format_spice(parse_si("10u").unwrap()), "1e-5");
    }
}
