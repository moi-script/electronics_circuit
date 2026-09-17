//! Import commands: preview SPICE files, commit chosen parts, manage user packs.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use multysm_core::import::pack::{list_packs, remove_pack, PackInfo};
use multysm_core::import::{commit, preview, Choice, ImportReport, Preview};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::commands::packs_dir;
use crate::simulation::engine_config;

#[derive(Default)]
pub struct ImportShared {
    latest: Mutex<Option<(u64, Preview)>>,
    next_id: AtomicU64,
    cancel: AtomicBool,
}

#[derive(Default, Clone)]
pub struct ImportState(pub Arc<ImportShared>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewDto {
    pub preview_id: u64,
    #[serde(flatten)]
    pub preview: Preview,
}

#[derive(Clone, Serialize)]
pub struct Progress {
    pub done: usize,
    pub total: usize,
}

#[tauri::command]
pub async fn preview_import(app: AppHandle, state: tauri::State<'_, ImportState>, paths: Vec<String>) -> Result<PreviewDto, String> {
    let packs = packs_dir(&app)?;
    let shared = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        let result = preview(&paths, &packs);
        let id = shared.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        *shared.latest.lock().unwrap_or_else(|e| e.into_inner()) = Some((id, result.clone()));
        PreviewDto { preview_id: id, preview: result }
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn commit_import(
    app: AppHandle,
    state: tauri::State<'_, ImportState>,
    preview_id: u64,
    choices: Vec<Choice>,
) -> Result<ImportReport, String> {
    let packs = packs_dir(&app)?;
    let shared = state.0.clone();
    let preview = match &*shared.latest.lock().unwrap_or_else(|e| e.into_inner()) {
        Some((id, preview)) if *id == preview_id => preview.clone(),
        _ => return Err("This preview is out of date. Pick the files again.".into()),
    };
    shared.cancel.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        commit(&preview, &choices, &packs, &engine_config(), &shared.cancel, &mut |done, total| {
            let _ = app.emit("import-progress", Progress { done, total });
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn cancel_import(state: tauri::State<'_, ImportState>) {
    state.0.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn list_imports(app: AppHandle) -> Result<Vec<PackInfo>, String> {
    Ok(list_packs(&packs_dir(&app)?))
}

#[tauri::command]
pub fn remove_import(app: AppHandle, pack_id: String) -> Result<(), String> {
    remove_pack(&packs_dir(&app)?, &pack_id)
}
