//! Content policy for SPICE text that comes from component packs (manifest
//! `models` strings and subcircuit files). Packs are untrusted, and ngspice
//! can run shell commands from `.control` blocks, so only model-defining
//! directives are allowed.

const ALLOWED_DIRECTIVES: [&str; 5] = [".model", ".subckt", ".ends", ".param", ".func"];

/// Checks every line of `text`. Returns a message describing the first
/// offending line.
pub fn check_spice_text(text: &str) -> Result<(), String> {
    for (i, line) in text.lines().enumerate() {
        check_line(line).map_err(|reason| format!("line {}: {reason}", i + 1))?;
    }
    Ok(())
}

fn check_line(line: &str) -> Result<(), String> {
    if line.chars().any(|c| c.is_control() && c != '\t') {
        return Err("contains a control character".into());
    }
    let trimmed = line.trim_start();
    let lower = trimmed.to_lowercase();
    // ngspice runs `*#` lines as control commands, so they are not comments.
    if lower.starts_with("*#") {
        return Err("'*#' lines are not allowed".into());
    }
    if lower.contains(".control") || lower.contains(".endc") {
        return Err("'.control' blocks are not allowed".into());
    }
    if lower.split(|c: char| !(c.is_alphanumeric() || c == '_')).any(|token| token == "shell") {
        return Err("'shell' is not allowed".into());
    }
    if lower.starts_with('*') || lower.starts_with('+') {
        return Ok(());
    }
    let Some(first) = lower.split_whitespace().next() else {
        return Ok(());
    };
    if first.starts_with('.') && !ALLOWED_DIRECTIVES.contains(&first) {
        return Err(format!("directive '{first}' is not allowed"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_models_subcircuits_comments_and_continuations() {
        let text = "* comment\n.subckt X a b\nR1 a b 1k\n+ extra\n.model D1 D(Is=1e-14)\n.param k=2\n.func f(x) {x*2}\n.ends X\n\n";
        assert_eq!(check_spice_text(text), Ok(()));
        assert_eq!(check_spice_text(".MODEL LED D(Is=1e-20)"), Ok(()));
    }

    #[test]
    fn rejects_dangerous_lines() {
        for bad in [
            ".control",
            "  .ENDC",
            "R1 a b 1k ; .control",
            "shell echo hi",
            "* shell echo hi",
            "*# shell echo hi",
            "*#run",
            ".include other.lib",
            ".inc other.lib",
            ".lib other.lib tt",
            ".options gmin=1e-12",
            "R1 a b 1k\0",
        ] {
            assert!(check_spice_text(bad).is_err(), "{bad:?} should be rejected");
        }
    }
}
