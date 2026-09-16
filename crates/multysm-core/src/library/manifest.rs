//! Component manifest types (one JSON file per part).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Manifest {
    pub schema: u32,
    pub id: String,
    pub name: String,
    pub category: Category,
    #[serde(default)]
    pub tags: Vec<String>,
    pub symbol: Symbol,
    #[serde(default)]
    pub params: Vec<Param>,
    pub spice: Spice,
    #[serde(default)]
    pub live: Option<serde_json::Value>,
    #[serde(default)]
    pub controls: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Category {
    Sources,
    Basic,
    Diodes,
    Transistors,
    Analog,
    #[serde(rename = "TTL")]
    Ttl,
    #[serde(rename = "CMOS")]
    Cmos,
    #[serde(rename = "Advanced Peripherals")]
    AdvancedPeripherals,
    #[serde(rename = "Misc Digital")]
    MiscDigital,
    Mixed,
    Indicators,
    Power,
    Misc,
    #[serde(rename = "RF")]
    Rf,
    Electromechanical,
}

impl Category {
    pub const ALL: [Category; 15] = [
        Category::Sources,
        Category::Basic,
        Category::Diodes,
        Category::Transistors,
        Category::Analog,
        Category::Ttl,
        Category::Cmos,
        Category::AdvancedPeripherals,
        Category::MiscDigital,
        Category::Mixed,
        Category::Indicators,
        Category::Power,
        Category::Misc,
        Category::Rf,
        Category::Electromechanical,
    ];
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Symbol {
    pub width: i64,
    pub height: i64,
    pub svg: String,
    pub pins: Vec<Pin>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Pin {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    pub x: i64,
    pub y: i64,
    #[serde(default)]
    pub optional: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Param {
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub unit: String,
    pub default: String,
    #[serde(rename = "type")]
    pub kind: ParamKind,
    /// Allowed values for `choice` params; empty for other kinds.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<ChoiceOption>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChoiceOption {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ParamKind {
    Si,
    Text,
    Choice,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Spice {
    Ground,
    Analog(DeviceSpice),
    Digital(DeviceSpice),
}

impl Spice {
    pub fn device(&self) -> Option<&DeviceSpice> {
        match self {
            Spice::Ground => None,
            Spice::Analog(d) | Spice::Digital(d) => Some(d),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSpice {
    pub ref_prefix: String,
    pub template: String,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default)]
    pub subckt: Option<String>,
}
