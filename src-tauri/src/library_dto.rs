//! Library data as sent to the UI: manifests plus symbol SVG markup
//! (the webview never reads files itself).

use std::fs;
use std::path::PathBuf;

use multysm_core::library::{Category, Library, Manifest};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct LibraryDto {
    pub categories: Vec<Category>,
    pub parts: Vec<PartDto>,
    pub issues: Vec<IssueDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartDto {
    pub manifest: Manifest,
    pub svg: String,
    pub ref_prefix: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct IssueDto {
    pub path: String,
    pub message: String,
}

/// Built-in component folder. `MULTYSM_COMPONENTS` overrides it; otherwise the
/// repository's `components/core` is used (bundling comes with packaging).
pub fn components_root() -> PathBuf {
    std::env::var_os("MULTYSM_COMPONENTS")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../components/core"))
}

pub fn library_dto(library: &Library) -> LibraryDto {
    let mut issues: Vec<IssueDto> = library
        .issues
        .iter()
        .map(|i| IssueDto { path: i.path.display().to_string(), message: i.message.clone() })
        .collect();
    let mut parts = Vec::new();
    for part in library.parts.values() {
        match fs::read_to_string(&part.symbol_path) {
            Ok(svg) => parts.push(PartDto {
                ref_prefix: part
                    .manifest
                    .spice
                    .device()
                    .map_or_else(|| "GND".to_string(), |d| d.ref_prefix.clone()),
                svg,
                manifest: part.manifest.clone(),
            }),
            Err(e) => issues.push(IssueDto {
                path: part.symbol_path.display().to_string(),
                message: format!("cannot read symbol: {e}"),
            }),
        }
    }
    LibraryDto { categories: Category::ALL.to_vec(), parts, issues }
}
