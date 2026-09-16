//! Reading and writing `.msym` project files. Project files are untrusted:
//! they are validated against `schemas/project.schema.json` before use.

use std::collections::BTreeSet;

use crate::circuit::Project;

const PROJECT_SCHEMA: &str = include_str!("../../../schemas/project.schema.json");

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ProjectFileError {
    #[error("not valid JSON: {0}")]
    Json(String),
    #[error("not a valid multysm project: {}", .0.join("; "))]
    Schema(Vec<String>),
}

pub fn parse_project(text: &str) -> Result<Project, ProjectFileError> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| ProjectFileError::Json(e.to_string()))?;
    let schema: serde_json::Value =
        serde_json::from_str(PROJECT_SCHEMA).expect("bundled project schema is valid JSON");
    let validator = jsonschema::validator_for(&schema).expect("bundled project schema compiles");
    let errors: Vec<String> = validator.iter_errors(&value).map(|e| e.to_string()).collect();
    if !errors.is_empty() {
        return Err(ProjectFileError::Schema(errors));
    }
    let project: Project =
        serde_json::from_value(value).map_err(|e| ProjectFileError::Schema(vec![e.to_string()]))?;

    let mut seen = BTreeSet::new();
    let uids = project.components.iter().map(|c| &c.uid).chain(project.wires.iter().map(|w| &w.uid));
    let duplicates: Vec<String> = uids
        .filter(|uid| !seen.insert(uid.as_str()))
        .map(|uid| format!("duplicate uid '{uid}'"))
        .collect();
    if !duplicates.is_empty() {
        return Err(ProjectFileError::Schema(duplicates));
    }
    Ok(project)
}

pub fn project_to_json(project: &Project) -> String {
    serde_json::to_string_pretty(project).expect("projects always serialize")
}
