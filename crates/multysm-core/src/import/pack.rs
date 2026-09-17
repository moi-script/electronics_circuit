//! User packs created by imports: `<packs>/<id>/{pack.json,components,symbols,models}`.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::candidate::{slug, Candidate};
use crate::library::{Category, DeviceSpice, Manifest, Spice, Symbol};

pub const PACK_FILE: &str = "pack.json";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackPart {
    pub id: String,
    pub model_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackInfo {
    pub id: String,
    pub name: String,
    pub origin: String,
    pub sources: Vec<String>,
    pub imported_at: u64,
    pub parts: Vec<PackPart>,
}

pub fn now_seconds() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

fn is_pack_id(id: &str) -> bool {
    id.starts_with("imported-") && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn read_info(dir: &Path) -> Option<PackInfo> {
    let text = fs::read_to_string(dir.join(PACK_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn list_packs(packs_dir: &Path) -> Vec<PackInfo> {
    let mut packs: Vec<PackInfo> = fs::read_dir(packs_dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| read_info(&e.path()).filter(|info| is_pack_id(&info.id) && e.file_name() == info.id.as_str()))
        .collect();
    packs.sort_by(|a, b| a.id.cmp(&b.id));
    packs
}

pub fn pack_roots(packs_dir: &Path) -> Vec<PathBuf> {
    list_packs(packs_dir).into_iter().map(|p| packs_dir.join(p.id)).collect()
}

pub fn existing_models(packs_dir: &Path) -> BTreeMap<String, String> {
    let mut models = BTreeMap::new();
    for pack in list_packs(packs_dir) {
        for part in pack.parts {
            models.entry(part.model_name.to_ascii_uppercase()).or_insert_with(|| pack.id.clone());
        }
    }
    models
}

pub fn new_pack_id(packs_dir: &Path, first_source: &str) -> String {
    let stem = Path::new(first_source).file_stem().and_then(|s| s.to_str()).unwrap_or("parts");
    let base_slug = slug(stem).replace('_', "-");
    let base = format!("imported-{}", if base_slug.is_empty() { "parts" } else { &base_slug });
    let taken = |id: &str| packs_dir.join(id).exists();
    if !taken(&base) {
        return base;
    }
    (2..).map(|n| format!("{base}-{n}")).find(|id| !taken(id)).expect("unbounded")
}

pub fn part_id(pack_id: &str, part_slug: &str) -> String {
    let pack = pack_id.trim_start_matches("imported-").replace('-', "_");
    format!("imported.{pack}.{part_slug}")
}

fn category_dir(category: Category) -> String {
    serde_json::to_value(category).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_else(|| "Misc".into())
}

fn write(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    fs::write(path, contents).map_err(|e| format!("cannot write {}: {e}", path.display()))
}

pub fn write_part(pack_dir: &Path, pack_id: &str, candidate: &Candidate, category: Category) -> Result<PackPart, String> {
    let id = part_id(pack_id, &candidate.slug);
    let symbol = &candidate.symbol;
    write(&pack_dir.join("symbols").join(&symbol.file_name), &symbol.svg)?;
    write(&pack_dir.join("models").join(format!("{}.lib", candidate.slug)), &format!("{}\n", candidate.model_text))?;

    let mut tags = vec!["imported".to_string()];
    if let Some(kind) = candidate.kind {
        tags.push(serde_json::to_value(kind).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default());
    }
    if let Some(model_type) = &candidate.model_type {
        tags.push(model_type.to_ascii_lowercase());
    }
    let manifest = Manifest {
        schema: 1,
        id: id.clone(),
        name: candidate.name.clone(),
        category,
        tags,
        symbol: Symbol {
            width: symbol.width,
            height: symbol.height,
            svg: format!("../../symbols/{}", symbol.file_name),
            pins: symbol.pins.clone(),
        },
        params: candidate.params.clone(),
        spice: Spice::Analog(DeviceSpice {
            ref_prefix: candidate.ref_prefix.clone(),
            template: candidate.template.clone(),
            models: vec![],
            subckt: Some(format!("../../models/{}.lib", candidate.slug)),
        }),
        live: None,
        controls: vec![],
    };
    let json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    write(&pack_dir.join("components").join(category_dir(category)).join(format!("{}.json", candidate.slug)), &json)?;
    Ok(PackPart { id, model_name: candidate.name.clone() })
}

pub fn write_pack_info(pack_dir: &Path, info: &PackInfo) -> Result<(), String> {
    let json = serde_json::to_string_pretty(info).map_err(|e| e.to_string())?;
    write(&pack_dir.join(PACK_FILE), &json)
}

fn pack_dir(packs_dir: &Path, pack_id: &str) -> Result<PathBuf, String> {
    let dir = packs_dir.join(pack_id);
    if !is_pack_id(pack_id) || read_info(&dir).is_none() {
        return Err(format!("no imported pack '{pack_id}'"));
    }
    Ok(dir)
}

pub fn remove_pack(packs_dir: &Path, pack_id: &str) -> Result<(), String> {
    let dir = pack_dir(packs_dir, pack_id)?;
    fs::remove_dir_all(&dir).map_err(|e| format!("cannot remove {}: {e}", dir.display()))
}

pub fn remove_part(packs_dir: &Path, pack_id: &str, model_name: &str) -> Result<(), String> {
    let dir = pack_dir(packs_dir, pack_id)?;
    let mut info = read_info(&dir).expect("checked by pack_dir");
    let part_slug = slug(model_name);
    info.parts.retain(|p| !p.model_name.eq_ignore_ascii_case(model_name));
    if info.parts.is_empty() {
        return fs::remove_dir_all(&dir).map_err(|e| format!("cannot remove {}: {e}", dir.display()));
    }
    for entry in walkdir::WalkDir::new(dir.join("components")).into_iter().flatten() {
        if entry.path().file_stem().is_some_and(|s| s == part_slug.as_str()) {
            let _ = fs::remove_file(entry.path());
        }
    }
    let _ = fs::remove_file(dir.join("models").join(format!("{part_slug}.lib")));
    let _ = fs::remove_file(dir.join("symbols").join(format!("{part_slug}.svg")));
    write_pack_info(&dir, &info)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::candidate::build_candidates;
    use crate::import::spice::parse_spice;
    use crate::library::load_library;
    use std::collections::BTreeMap;

    fn candidates() -> Vec<Candidate> {
        let text = ".model D5819 D(IS=31.7u N=1.373)\n.subckt AMP inp inn out PARAMS: GAIN=1e5\nE1 out 0 inp inn {GAIN}\n.ends\n";
        build_candidates(&[("vendor parts.lib".into(), parse_spice(text))], &BTreeMap::new())
    }

    fn write_pack(packs: &Path, id: &str, cs: &[Candidate]) -> PathBuf {
        let dir = packs.join(id);
        let parts: Vec<PackPart> = cs.iter().map(|c| write_part(&dir, id, c, c.category).unwrap()).collect();
        write_pack_info(&dir, &PackInfo {
            id: id.into(), name: id.into(), origin: "import".into(),
            sources: vec!["vendor parts.lib".into()], imported_at: 1, parts,
        }).unwrap();
        dir
    }

    #[test]
    fn written_parts_load_as_a_library_without_issues() {
        let packs = tempfile::tempdir().unwrap();
        let id = new_pack_id(packs.path(), "vendor parts.lib");
        assert_eq!(id, "imported-vendor-parts");
        let dir = write_pack(packs.path(), &id, &candidates());
        let library = load_library(&[dir]);
        assert!(library.issues.is_empty(), "{:#?}", library.issues);
        let amp = library.get("imported.vendor_parts.amp").expect("amp part");
        assert_eq!(amp.manifest.name, "AMP");
        assert_eq!(amp.manifest.category, Category::Misc);
        assert!(amp.manifest.tags.contains(&"imported".to_string()));
        assert_eq!(amp.manifest.params[0].key, "gain");
        let text = std::fs::read_to_string(amp.subckt_path.as_ref().unwrap()).unwrap();
        assert!(text.contains(".subckt AMP"));
        assert!(library.get("imported.vendor_parts.d5819").is_some());
    }

    #[test]
    fn pack_ids_do_not_clash() {
        let packs = tempfile::tempdir().unwrap();
        write_pack(packs.path(), "imported-vendor-parts", &candidates());
        assert_eq!(new_pack_id(packs.path(), "Vendor-Parts.LIB"), "imported-vendor-parts-2");
    }

    #[test]
    fn lists_packs_roots_and_existing_models() {
        let packs = tempfile::tempdir().unwrap();
        write_pack(packs.path(), "imported-b", &candidates()[..1]);
        write_pack(packs.path(), "imported-a", &candidates()[1..]);
        std::fs::create_dir_all(packs.path().join(".tmp-x")).unwrap();
        let listed: Vec<String> = list_packs(packs.path()).into_iter().map(|p| p.id).collect();
        assert_eq!(listed, ["imported-a", "imported-b"]);
        assert_eq!(pack_roots(packs.path()), [packs.path().join("imported-a"), packs.path().join("imported-b")]);
        let models = existing_models(packs.path());
        assert_eq!(models.get("D5819").map(String::as_str), Some("imported-b"));
        assert_eq!(models.get("AMP").map(String::as_str), Some("imported-a"));
    }

    #[test]
    fn removes_parts_and_packs() {
        let packs = tempfile::tempdir().unwrap();
        let dir = write_pack(packs.path(), "imported-x", &candidates());
        remove_part(packs.path(), "imported-x", "d5819").unwrap();
        let info = &list_packs(packs.path())[0];
        assert_eq!(info.parts.len(), 1);
        assert!(!dir.join("components/Diodes/d5819.json").exists());
        remove_part(packs.path(), "imported-x", "AMP").unwrap();
        assert!(!dir.exists(), "empty pack folder is deleted");

        write_pack(packs.path(), "imported-y", &candidates());
        remove_pack(packs.path(), "imported-y").unwrap();
        assert!(list_packs(packs.path()).is_empty());
        assert!(remove_pack(packs.path(), "../outside").is_err());
        assert!(remove_pack(packs.path(), "imported-missing").is_err());
    }
}
