//! Loads and validates manifests from one or more library folders.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use walkdir::WalkDir;

use super::manifest::{Manifest, ParamKind};
use super::spice_policy::check_spice_text;
use crate::netlist::template::placeholders;
use crate::netlist::validate::is_valid_text_param;

const MANIFEST_SCHEMA: &str = include_str!("../../../../schemas/manifest.schema.json");

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Part {
    pub manifest: Manifest,
    /// Folder containing the manifest; relative file paths resolve from here.
    pub dir: PathBuf,
    /// Canonical path of the symbol SVG, inside the library root.
    pub symbol_path: PathBuf,
    /// Canonical path of the subcircuit file, inside the library root.
    pub subckt_path: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LibraryIssue {
    pub path: PathBuf,
    pub message: String,
}

#[derive(Debug, Default, Serialize)]
pub struct Library {
    pub parts: BTreeMap<String, Part>,
    pub issues: Vec<LibraryIssue>,
}

impl Library {
    pub fn get(&self, id: &str) -> Option<&Part> {
        self.parts.get(id)
    }
}

pub fn load_library(roots: &[PathBuf]) -> Library {
    let schema: serde_json::Value =
        serde_json::from_str(MANIFEST_SCHEMA).expect("bundled manifest schema is valid JSON");
    let validator = jsonschema::validator_for(&schema).expect("bundled manifest schema compiles");

    let mut library = Library::default();
    let mut origins: BTreeMap<String, PathBuf> = BTreeMap::new();

    for root in roots {
        let root_dir = match fs::canonicalize(root) {
            Ok(dir) if dir.is_dir() => dir,
            Ok(_) => {
                library.issues.push(LibraryIssue {
                    path: root.clone(),
                    message: "library root is not a folder".into(),
                });
                continue;
            }
            Err(e) => {
                library.issues.push(LibraryIssue {
                    path: root.clone(),
                    message: format!("cannot open library root: {e}"),
                });
                continue;
            }
        };
        let mut files: Vec<PathBuf> = Vec::new();
        for entry in WalkDir::new(root) {
            match entry {
                Ok(entry) => files.push(entry.into_path()),
                Err(e) => library.issues.push(LibraryIssue {
                    path: e.path().unwrap_or(root).to_path_buf(),
                    message: format!("cannot read library folder: {e}"),
                }),
            }
        }
        files.retain(|p| {
            p.extension().is_some_and(|ext| ext == "json")
                && p.file_name().is_some_and(|name| name != "pack.json")
        });
        files.sort();

        for path in files {
            match load_part(&path, &root_dir, &validator) {
                Ok(part) => {
                    let id = part.manifest.id.clone();
                    if let Some(first) = origins.get(&id) {
                        library.issues.push(LibraryIssue {
                            path: path.clone(),
                            message: format!(
                                "duplicate part id '{id}' (first defined in {})",
                                first.display()
                            ),
                        });
                    } else {
                        origins.insert(id.clone(), path.clone());
                        library.parts.insert(id, part);
                    }
                }
                Err(messages) => library.issues.extend(
                    messages
                        .into_iter()
                        .map(|message| LibraryIssue { path: path.clone(), message }),
                ),
            }
        }
    }
    library
}

fn load_part(
    path: &Path,
    root: &Path,
    validator: &jsonschema::Validator,
) -> Result<Part, Vec<String>> {
    let text = fs::read_to_string(path).map_err(|e| vec![format!("cannot read file: {e}")])?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| vec![format!("invalid JSON: {e}")])?;

    let schema_errors: Vec<String> = validator
        .iter_errors(&value)
        .map(|e| format!("schema: {e}"))
        .collect();
    if !schema_errors.is_empty() {
        return Err(schema_errors);
    }

    let manifest: Manifest =
        serde_json::from_value(value).map_err(|e| vec![format!("invalid manifest: {e}")])?;
    let dir = path.parent().unwrap_or(Path::new(".")).to_path_buf();

    let mut problems = Vec::new();
    for param in &manifest.params {
        if param.kind != ParamKind::Choice {
            continue;
        }
        for option in &param.options {
            let value = &option.value;
            if value.is_empty() || value.chars().any(char::is_whitespace) || !is_valid_text_param(value) {
                problems.push(format!("param '{}' option value '{value}' is not allowed", param.key));
            }
        }
        if !param.options.iter().any(|o| o.value == param.default) {
            problems.push(format!(
                "param '{}' default '{}' is not one of its options",
                param.key, param.default
            ));
        }
    }
    let symbol_path = resolve_file(root, &dir, &manifest.symbol.svg, "symbol")
        .map_err(|e| problems.push(e))
        .ok();
    let mut subckt_path = None;
    if let Some(device) = manifest.spice.device() {
        if let Some(subckt) = &device.subckt {
            match resolve_file(root, &dir, subckt, "subcircuit") {
                Ok(path) => match fs::read_to_string(&path) {
                    Ok(text) => match check_spice_text(&text) {
                        Ok(()) => subckt_path = Some(path),
                        Err(e) => problems.push(format!("subcircuit file '{subckt}' {e}")),
                    },
                    Err(e) => problems.push(format!("cannot read subcircuit file '{subckt}': {e}")),
                },
                Err(e) => problems.push(e),
            }
        }
        for (i, model) in device.models.iter().enumerate() {
            if let Err(e) = check_spice_text(model) {
                problems.push(format!("models[{i}] {e}"));
            }
        }
        if device.template.chars().any(char::is_control) {
            problems.push("template contains a control character".into());
        }
        match placeholders(&device.template) {
            Ok(names) => {
                for name in names {
                    let known = name == "ref"
                        || name.strip_prefix("pin.").is_some_and(|pin| {
                            manifest.symbol.pins.iter().any(|p| p.id == pin)
                        })
                        || manifest.params.iter().any(|p| p.key == name);
                    if !known {
                        problems.push(format!("template uses unknown placeholder {{{name}}}"));
                    }
                }
            }
            Err(e) => problems.push(format!("template: {e}")),
        }
    }

    match symbol_path {
        Some(symbol_path) if problems.is_empty() => {
            Ok(Part { manifest, dir, symbol_path, subckt_path })
        }
        _ => Err(problems),
    }
}

/// Resolves a manifest-relative file path. The file must exist and, after
/// following `..` and links, lie inside the library root: packs are
/// untrusted and must not reach files elsewhere on disk.
fn resolve_file(root: &Path, dir: &Path, rel: &str, what: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    let anchored = rel_path
        .components()
        .any(|c| matches!(c, Component::Prefix(_) | Component::RootDir));
    if anchored || rel_path.is_absolute() {
        return Err(format!("{what} file '{rel}' must be a relative path"));
    }
    let path = fs::canonicalize(dir.join(rel_path))
        .map_err(|_| format!("{what} file '{rel}' not found"))?;
    if !path.starts_with(root) {
        return Err(format!("{what} file '{rel}' is outside the library folder"));
    }
    if !path.is_file() {
        return Err(format!("{what} file '{rel}' not found"));
    }
    Ok(path)
}
