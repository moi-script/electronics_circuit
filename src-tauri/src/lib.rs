//! multysm desktop shell: a thin Tauri layer over multysm-core.

pub mod commands;
pub mod library_dto;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::load_library,
            commands::open_project,
            commands::save_project,
            commands::write_recovery,
            commands::read_recovery,
            commands::clear_recovery,
        ])
        .run(tauri::generate_context!())
        .expect("error while running multysm");
}
