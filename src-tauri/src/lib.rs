//! multysm desktop shell: a thin Tauri layer over multysm-core.

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running multysm");
}
