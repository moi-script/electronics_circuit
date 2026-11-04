//! Importing parts from SPICE model files into user packs.

pub mod candidate;
pub mod category;
pub mod pack;
pub mod smoke;
pub mod spice;
pub mod symbols;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};

use crate::engine::EngineConfig;
use crate::library::Category;
use candidate::{build_candidates, Candidate, CandidateStatus};
use pack::{existing_models, new_pack_id, now_seconds, remove_part, write_pack_info, write_part, PackInfo};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFile {
    pub path: String,
    pub name: String,
    pub warnings: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub files: Vec<PreviewFile>,
    pub candidates: Vec<Candidate>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    pub key: String,
    pub selected: bool,
    pub category: Category,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedPart {
    pub key: String,
    pub name: String,
    pub message: String,
    pub log: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    /// `None` when nothing was imported (no pack was created).
    pub pack_id: Option<String>,
    pub imported: Vec<String>,
    pub failed: Vec<FailedPart>,
    /// Keys not attempted because the import was cancelled.
    pub skipped: Vec<String>,
    pub cancelled: bool,
}

fn file_name(path: &Path) -> String {
    path.file_name().map_or_else(|| path.display().to_string(), |n| n.to_string_lossy().into_owned())
}

/// Reads and analyses the files. Never writes and never runs ngspice.
pub fn preview(paths: &[PathBuf], packs_dir: &Path) -> Preview {
    let mut files = Vec::new();
    let mut parsed = Vec::new();
    for path in paths {
        let name = file_name(path);
        match spice::read_spice_file(path) {
            Ok(file) => {
                files.push(PreviewFile { path: path.display().to_string(), name: name.clone(), warnings: file.warnings.clone(), error: None });
                parsed.push((name, file));
            }
            Err(error) => {
                files.push(PreviewFile { path: path.display().to_string(), name: name.clone(), warnings: vec![], error: Some(error) });
                parsed.push((name, spice::SpiceFile::default()));
            }
        }
    }
    let candidates = build_candidates(&parsed, &existing_models(packs_dir));
    Preview { files, candidates }
}

/// Smoke-tests and writes the chosen parts into a new pack. The pack is built in a temporary
/// folder and renamed into place, so a failed write never leaves a half-written pack behind.
pub fn commit(
    preview: &Preview,
    choices: &[Choice],
    packs_dir: &Path,
    config: &EngineConfig,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(usize, usize),
) -> Result<ImportReport, String> {
    let chosen: Vec<(&Candidate, Category)> = choices
        .iter()
        .filter(|c| c.selected)
        .filter_map(|choice| {
            preview
                .candidates
                .iter()
                .find(|c| c.key == choice.key && c.status.importable())
                .map(|c| (c, choice.category))
        })
        .collect();

    fs::create_dir_all(packs_dir).map_err(|e| format!("cannot create {}: {e}", packs_dir.display()))?;
    let first_source = chosen.first().map_or("parts", |(c, _)| c.source.as_str());
    let pack_id = new_pack_id(packs_dir, first_source);
    let temp = packs_dir.join(format!(".tmp-{pack_id}"));
    let _ = fs::remove_dir_all(&temp);

    let mut report = ImportReport { pack_id: None, imported: vec![], failed: vec![], skipped: vec![], cancelled: false };
    let mut parts = Vec::new();
    let mut replaced: Vec<(String, String)> = Vec::new();
    let total = chosen.len();

    let result = (|| -> Result<(), String> {
        for (index, (candidate, category)) in chosen.iter().enumerate() {
            if cancel.load(Ordering::SeqCst) {
                report.cancelled = true;
                report.skipped.push(candidate.key.clone());
                continue;
            }
            match smoke::smoke_test(config, candidate) {
                Ok(()) => {
                    parts.push(write_part(&temp, &pack_id, candidate, *category)?);
                    report.imported.push(pack::part_id(&pack_id, &candidate.slug));
                    if let (CandidateStatus::AlreadyImported, Some(old)) = (candidate.status, &candidate.replaces) {
                        replaced.push((old.clone(), candidate.name.clone()));
                    }
                }
                Err((message, log)) => report.failed.push(FailedPart {
                    key: candidate.key.clone(),
                    name: candidate.name.clone(),
                    message,
                    log,
                }),
            }
            progress(index + 1, total);
        }
        if parts.is_empty() {
            return Ok(());
        }
        let mut sources: Vec<String> = chosen.iter().map(|(c, _)| c.source.clone()).collect();
        sources.dedup();
        write_pack_info(&temp, &PackInfo {
            id: pack_id.clone(),
            name: sources.join(", "),
            origin: "import".into(),
            sources,
            imported_at: now_seconds(),
            parts: std::mem::take(&mut parts),
        })?;
        fs::rename(&temp, packs_dir.join(&pack_id)).map_err(|e| format!("cannot finish the import: {e}"))?;
        report.pack_id = Some(pack_id.clone());
        // Only after the new pack is in place, so a failed rename never loses the old copy.
        for (old_pack, model_name) in &replaced {
            remove_part(packs_dir, old_pack, model_name)?;
        }
        Ok(())
    })();

    let _ = fs::remove_dir_all(&temp);
    result.map(|()| report)
}
