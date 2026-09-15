//! Checks on project-supplied strings before they are written into netlist
//! text. Projects are untrusted files, and a newline in a reference or
//! parameter would let a project add its own SPICE lines (including
//! `.control` blocks that run shell commands).

/// References must match `^[A-Za-z][A-Za-z0-9_]*$`.
pub fn is_valid_reference(reference: &str) -> bool {
    let mut chars = reference.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Text parameter values may not contain control characters or the SPICE
/// comment/expression characters `;`, `$`, `{`, `}`.
pub fn is_valid_text_param(value: &str) -> bool {
    !value.chars().any(|c| c.is_control() || matches!(c, ';' | '$' | '{' | '}'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn references() {
        for ok in ["R1", "r1", "GND_1", "U"] {
            assert!(is_valid_reference(ok), "{ok}");
        }
        for bad in ["", "1R", "_R", "R 1", "R1\n.control", "R-1", "R1;", "Ω1"] {
            assert!(!is_valid_reference(bad), "{bad:?}");
        }
    }

    #[test]
    fn text_params() {
        assert!(is_valid_text_param("PULSE(0 5 1m)"));
        assert!(is_valid_text_param(""));
        for bad in ["a\nb", "a\rb", "a\0b", "a;b", "a$b", "{x}", "a\tb"] {
            assert!(!is_valid_text_param(bad), "{bad:?}");
        }
    }
}
