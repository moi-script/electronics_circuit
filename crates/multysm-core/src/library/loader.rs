//! Loads and validates manifests from one or more library folders.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use super::manifest::Manifest;
use super::spice_policy::check_spice_text;
use crate::netlist::template::placeholders;

const MANIFEST_SCHEMA: &str = include_str!("../../../../schemas/manifest.schema.json");

#[derive(Debug, Clone)]
pub struct Part {
    pub manifest: Manifest,
    /// Folder containing the manifest; relative file paths resolve from here.
    pub dir: PathBuf,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LibraryIssue {
    pub path: PathBuf,
    pub message: String,
}

#[derive(Debug, Default)]
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
        let mut files: Vec<PathBuf> = WalkDir::new(root)
            .into_iter()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.into_path())
            .filter(|p| p.extension().is_some_and(|ext| ext == "json"))
            .filter(|p| p.file_name().is_some_and(|name| name != "pack.json"))
            .collect();
        files.sort();

        for path in files {
            match load_part(&path, &validator) {
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

fn load_part(path: &Path, validator: &jsonschema::Validator) -> Result<Part, Vec<String>> {
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
    if !dir.join(&manifest.symbol.svg).is_file() {
        problems.push(format!("symbol file '{}' not found", manifest.symbol.svg));
    }
    if let Some(device) = manifest.spice.device() {
        if let Some(subckt) = &device.subckt {
            let path = dir.join(subckt);
            if !path.is_file() {
                problems.push(format!("subcircuit file '{subckt}' not found"));
            } else {
                match fs::read_to_string(&path) {
                    Ok(text) => {
                        if let Err(e) = check_spice_text(&text) {
                            problems.push(format!("subcircuit file '{subckt}' {e}"));
                        }
                    }
                    Err(e) => problems.push(format!("cannot read subcircuit file '{subckt}': {e}")),
                }
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

    if problems.is_empty() {
        Ok(Part { manifest, dir })
    } else {
        Err(problems)
    }
}
