//! Reads SPICE model files into `.model` and `.subckt` definitions.

use std::fs;
use std::path::Path;

/// Largest file the importer reads.
pub const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub enum DefKind {
    /// `model_type` is upper case: `D`, `NPN`, `NMOS`, …
    Model { model_type: String },
    /// `params` keep their original spelling; `nested` is true when the body defines another subcircuit.
    Subckt { ports: Vec<String>, params: Vec<(String, String)>, nested: bool },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Definition {
    /// Name as written in the file.
    pub name: String,
    pub kind: DefKind,
    /// The definition's logical lines (continuations joined, comments removed), newline separated.
    pub text: String,
    /// Comment lines directly above the definition, without the leading `*`.
    pub comments: Vec<String>,
    /// Upper-case subcircuit names used by `X` lines in the body.
    pub subckt_refs: Vec<String>,
    /// Every upper-case token of the body's element lines; model references are the ones that name a `.model`.
    pub tokens: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct SpiceFile {
    pub definitions: Vec<Definition>,
    pub warnings: Vec<String>,
}

pub fn read_spice_file(path: &Path) -> Result<SpiceFile, String> {
    let size = fs::metadata(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?.len();
    if size > MAX_FILE_BYTES {
        return Err(format!("{} is larger than 20 MB", path.display()));
    }
    let bytes = fs::read(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    Ok(parse_spice(&decode(&bytes)))
}

/// UTF-8, or Latin-1 when the bytes are not valid UTF-8.
pub(crate) fn decode(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => bytes.iter().map(|&b| b as char).collect(),
    }
}

enum Line {
    Comment(String),
    Blank,
    Code(String),
}

/// Joins `+` continuations and removes `;` and ` $` inline comments.
fn logical_lines(text: &str) -> Vec<Line> {
    let mut lines: Vec<Line> = Vec::new();
    for raw in text.lines() {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            lines.push(Line::Blank);
            continue;
        }
        if let Some(comment) = trimmed.strip_prefix('*') {
            lines.push(Line::Comment(comment.trim().to_string()));
            continue;
        }
        let code = strip_inline_comment(trimmed);
        if let Some(rest) = code.strip_prefix('+') {
            if let Some(Line::Code(previous)) = lines.iter_mut().rev().find(|l| matches!(l, Line::Code(_))) {
                previous.push(' ');
                previous.push_str(rest.trim());
                continue;
            }
        }
        if !code.is_empty() {
            lines.push(Line::Code(code));
        }
    }
    lines
}

fn strip_inline_comment(line: &str) -> String {
    let mut end = line.len();
    if let Some(i) = line.find(';') {
        end = end.min(i);
    }
    let bytes = line.as_bytes();
    for (i, &b) in bytes.iter().enumerate() {
        if b == b'$' && (i == 0 || bytes[i - 1].is_ascii_whitespace()) {
            end = end.min(i);
            break;
        }
    }
    line[..end].trim_end().to_string()
}

fn directive(line: &str) -> String {
    line.split_whitespace().next().unwrap_or("").to_ascii_lowercase()
}

struct Open {
    name: String,
    ports: Vec<String>,
    params: Vec<(String, String)>,
    nested: bool,
    depth: usize,
    lines: Vec<String>,
    comments: Vec<String>,
    subckt_refs: Vec<String>,
    tokens: Vec<String>,
}

pub fn parse_spice(text: &str) -> SpiceFile {
    let mut file = SpiceFile::default();
    let mut comments: Vec<String> = Vec::new();
    let mut open: Option<Open> = None;

    for line in logical_lines(text) {
        let code = match line {
            Line::Blank => {
                if open.is_none() {
                    comments.clear();
                }
                continue;
            }
            Line::Comment(c) => {
                if open.is_none() {
                    comments.push(c);
                }
                continue;
            }
            Line::Code(code) => code,
        };
        let dir = directive(&code);

        if let Some(sub) = open.as_mut() {
            sub.lines.push(code.clone());
            match dir.as_str() {
                ".subckt" => {
                    sub.nested = true;
                    sub.depth += 1;
                }
                ".ends" => {
                    if sub.depth == 0 {
                        let sub = open.take().expect("open subcircuit");
                        push_definition(
                            &mut file,
                            Definition {
                                name: sub.name,
                                kind: DefKind::Subckt { ports: sub.ports, params: sub.params, nested: sub.nested },
                                text: sub.lines.join("\n"),
                                comments: sub.comments,
                                subckt_refs: sub.subckt_refs,
                                tokens: sub.tokens,
                            },
                        );
                    } else {
                        sub.depth -= 1;
                    }
                }
                _ if dir.starts_with('.') => {}
                _ if sub.depth == 0 => {
                    let tokens: Vec<String> = code.split_whitespace().map(str::to_ascii_uppercase).collect();
                    if tokens[0].starts_with('X') {
                        if let Some(name) = x_line_subckt(&tokens) {
                            sub.subckt_refs.push(name);
                        }
                    }
                    sub.tokens.extend(tokens.into_iter().skip(1));
                }
                _ => {}
            }
            continue;
        }

        match dir.as_str() {
            ".model" => {
                let mut parts = code.split_whitespace().skip(1);
                let name = parts.next().unwrap_or("").to_string();
                let model_type: String = parts
                    .next()
                    .unwrap_or("")
                    .split('(')
                    .next()
                    .unwrap_or("")
                    .to_ascii_uppercase();
                if name.is_empty() || model_type.is_empty() {
                    file.warnings.push(format!("'{code}' is not a complete .model line"));
                } else {
                    push_definition(
                        &mut file,
                        Definition {
                            name,
                            kind: DefKind::Model { model_type },
                            text: code.clone(),
                            comments: std::mem::take(&mut comments),
                            subckt_refs: vec![],
                            tokens: vec![],
                        },
                    );
                }
            }
            ".subckt" => {
                let (name, ports, params) = subckt_header(&code);
                open = Some(Open {
                    name,
                    ports,
                    params,
                    nested: false,
                    depth: 0,
                    lines: vec![code.clone()],
                    comments: std::mem::take(&mut comments),
                    subckt_refs: vec![],
                    tokens: vec![],
                });
            }
            ".include" | ".inc" | ".lib" => {
                let target = code.split_whitespace().nth(1).unwrap_or("").trim_matches(|c| c == '"' || c == '\'');
                file.warnings.push(format!(
                    "'{}' is not followed; import {target} together with this file",
                    directive(&code)
                ));
            }
            _ => {}
        }
        comments.clear();
    }

    if let Some(sub) = open {
        file.warnings.push(format!("subcircuit {} has no .ends and was skipped", sub.name));
    }
    file
}

fn push_definition(file: &mut SpiceFile, definition: Definition) {
    if file.definitions.iter().any(|d| d.name.eq_ignore_ascii_case(&definition.name)) {
        file.warnings.push(format!("{} is defined more than once; the first definition is used", definition.name));
    } else {
        file.definitions.push(definition);
    }
}

/// `.subckt NAME ports… [PARAMS:] [k=v …]`, tolerating spaces around `=`.
fn subckt_header(line: &str) -> (String, Vec<String>, Vec<(String, String)>) {
    let normalized = line.replace(" =", "=").replace("= ", "=");
    let mut tokens = normalized.split_whitespace().skip(1);
    let name = tokens.next().unwrap_or("").to_string();
    let mut ports = Vec::new();
    let mut params = Vec::new();
    let mut in_params = false;
    for token in tokens {
        if token.eq_ignore_ascii_case("params:") {
            in_params = true;
        } else if let Some((key, value)) = token.split_once('=') {
            in_params = true;
            params.push((key.to_string(), value.to_string()));
        } else if !in_params {
            ports.push(token.to_string());
        }
    }
    (name, ports, params)
}

/// The subcircuit named by an `X` line: the last token before any `PARAMS:` or `k=v`.
fn x_line_subckt(tokens: &[String]) -> Option<String> {
    tokens
        .iter()
        .skip(1)
        .take_while(|t| t.as_str() != "PARAMS:" && !t.contains('='))
        .last()
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(file: &SpiceFile) -> Vec<&str> {
        file.definitions.iter().map(|d| d.name.as_str()).collect()
    }

    #[test]
    fn reads_models_with_and_without_parentheses() {
        let file = parse_spice(".model D1N4148 D(IS=4.352n N=1.906)\n.MODEL Q2N3904 npn IS=1e-14 BF=300\n");
        assert_eq!(names(&file), ["D1N4148", "Q2N3904"]);
        assert_eq!(file.definitions[0].kind, DefKind::Model { model_type: "D".into() });
        assert_eq!(file.definitions[1].kind, DefKind::Model { model_type: "NPN".into() });
        assert_eq!(file.definitions[1].text, ".MODEL Q2N3904 npn IS=1e-14 BF=300");
    }

    #[test]
    fn joins_continuations_and_strips_comments() {
        let text = "* header\n\n* Ideal diode\n.model DX D(IS=1e-14 ; saturation\n+ N=1.5 $ emission\n+ RS=2)\n";
        let file = parse_spice(text);
        let d = &file.definitions[0];
        assert_eq!(d.text, ".model DX D(IS=1e-14 N=1.5 RS=2)");
        assert_eq!(d.comments, ["Ideal diode"]);
    }

    #[test]
    fn reads_subcircuits_with_ports_params_and_references() {
        let text = "\
.SUBCKT LM358 IN+ IN- VCC VEE OUT PARAMS: GAIN=100k VOS = 1m
X1 IN+ IN- N1 STAGE1
Q1 VCC N1 OUT QOUT
.model QOUT NPN(BF=100)
.ENDS LM358
.subckt STAGE1 a b c
R1 a c 1k
.ends
";
        let file = parse_spice(text);
        assert_eq!(names(&file), ["LM358", "STAGE1"]);
        let DefKind::Subckt { ports, params, nested } = &file.definitions[0].kind else { panic!() };
        assert_eq!(ports, &["IN+", "IN-", "VCC", "VEE", "OUT"]);
        assert_eq!(params, &[("GAIN".to_string(), "100k".to_string()), ("VOS".to_string(), "1m".to_string())]);
        assert!(!nested);
        assert_eq!(file.definitions[0].subckt_refs, ["STAGE1"]);
        assert!(file.definitions[0].tokens.contains(&"QOUT".to_string()));
        assert!(file.definitions[0].text.starts_with(".SUBCKT LM358"));
        assert!(file.definitions[0].text.ends_with(".ENDS LM358"));
    }

    #[test]
    fn x_line_reference_ignores_params() {
        let file = parse_spice(".subckt TOP a b\nX1 a b INNER PARAMS: K=2\nX2 a b INNER2 K=3\n.ends\n");
        assert_eq!(file.definitions[0].subckt_refs, ["INNER", "INNER2"]);
    }

    #[test]
    fn marks_nested_subcircuits() {
        let file = parse_spice(".subckt OUTER a\n.subckt INNER b\nR1 b 0 1\n.ends INNER\nR2 a 0 1\n.ends OUTER\n");
        assert_eq!(names(&file), ["OUTER"]);
        let DefKind::Subckt { nested, .. } = file.definitions[0].kind else { panic!() };
        assert!(nested);
    }

    #[test]
    fn keeps_first_duplicate_and_warns_about_includes() {
        let file = parse_spice(".model A D(IS=1)\n.model a D(IS=2)\n.include \"other.lib\"\n.lib models.lib\n");
        assert_eq!(names(&file), ["A"]);
        assert!(file.definitions[0].text.contains("IS=1"));
        assert_eq!(file.warnings.len(), 3, "{:?}", file.warnings);
        assert!(file.warnings[0].contains("defined more than once"));
        assert!(file.warnings[1].contains("other.lib"));
        assert!(file.warnings[2].contains("models.lib"));
    }

    #[test]
    fn unterminated_subcircuit_is_a_warning() {
        let file = parse_spice(".subckt OPEN a b\nR1 a b 1k\n");
        assert!(file.definitions.is_empty());
        assert!(file.warnings[0].contains("OPEN"));
    }

    #[test]
    fn decodes_latin1() {
        let bytes = b"* R\xe9sistance\n.model DX D(IS=1)\n";
        assert_eq!(parse_spice(&decode(bytes)).definitions.len(), 1);
    }

    #[test]
    fn rejects_files_over_the_size_limit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("big.lib");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_FILE_BYTES + 1).unwrap();
        assert!(read_spice_file(&path).unwrap_err().contains("20 MB"));
    }
}
