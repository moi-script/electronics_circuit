//! Prints the core library as UI JSON; used to refresh the browser mock fixture:
//! `cargo run -q -p multysm-app --bin export_library > app/src/backend/mock-library.json`

fn main() {
    let library = multysm_core::library::load_library(&[multysm_app_lib::library_dto::components_root()]);
    let dto = multysm_app_lib::library_dto::library_dto(&library);
    println!("{}", serde_json::to_string_pretty(&dto).expect("library DTO serializes"));
}
