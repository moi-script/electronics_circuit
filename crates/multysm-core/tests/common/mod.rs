#![allow(dead_code)]

use multysm_core::library::{load_library, Library};
use std::path::{Path, PathBuf};

pub fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("crate lives in <root>/crates/multysm-core")
        .to_path_buf()
}

pub fn core_library() -> Library {
    let lib = load_library(&[workspace_root().join("components").join("core")]);
    assert!(lib.issues.is_empty(), "core library issues: {:#?}", lib.issues);
    lib
}
