//! Tauri commands: the only API the UI calls.

use std::fs;
use std::path::{Path, PathBuf};

use multysm_core::circuit::Project;
use multysm_core::project_file::{parse_project, project_to_json};
use tauri::{AppHandle, Manager};

use crate::library_dto::{components_root, library_dto, LibraryDto};
use crate::simulation::{engine_config, run_simulation, SimOutcome, SimState, SIM_TIMEOUT};

pub fn read_project_file(path: &Path) -> Result<Project, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
    parse_project(&text).map_err(|e| e.to_string())
}

pub fn write_project_file(path: &Path, project: &Project) -> Result<(), String> {
    fs::write(path, project_to_json(project)).map_err(|e| format!("Cannot save {}: {e}", path.display()))
}

#[tauri::command]
pub fn load_library() -> LibraryDto {
    library_dto(&multysm_core::library::load_library(&[components_root()]))
}

#[tauri::command]
pub fn open_project(path: String) -> Result<Project, String> {
    read_project_file(Path::new(&path))
}

#[tauri::command]
pub fn save_project(path: String, project: Project) -> Result<(), String> {
    write_project_file(Path::new(&path), &project)
}

fn recovery_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("recovery.msym"))
}

#[tauri::command]
pub fn write_recovery(app: AppHandle, project: Project) -> Result<(), String> {
    write_project_file(&recovery_path(&app)?, &project)
}

#[tauri::command]
pub fn read_recovery(app: AppHandle) -> Result<Option<Project>, String> {
    let path = recovery_path(&app)?;
    if !path.is_file() {
        return Ok(None);
    }
    read_project_file(&path).map(Some)
}

#[tauri::command]
pub fn clear_recovery(app: AppHandle) -> Result<(), String> {
    let path = recovery_path(&app)?;
    if path.is_file() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn simulate(state: tauri::State<'_, SimState>, project: Project) -> Result<SimOutcome, String> {
    let shared = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        run_simulation(&shared, &project, &components_root(), &engine_config(), SIM_TIMEOUT)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stop_simulation(state: tauri::State<'_, SimState>) {
    state.0.cancel.store(true, std::sync::atomic::Ordering::SeqCst);
}
