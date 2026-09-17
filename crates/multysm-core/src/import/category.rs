//! Guesses a browser category for an imported part.

use super::candidate::PartKind;
use crate::library::Category;

pub fn guess_category(kind: PartKind, name: &str, comments: &[String]) -> Category {
    match kind {
        PartKind::Diode => return Category::Diodes,
        PartKind::Bjt | PartKind::Mosfet | PartKind::Jfet => return Category::Transistors,
        PartKind::Subckt => {}
    }
    let upper = name.to_ascii_uppercase();
    if let Some(category) = by_name(&upper) {
        return category;
    }
    let description = comments.join(" ").to_ascii_lowercase();
    if description.contains("regulator") || description.contains("ldo") {
        Category::Power
    } else if ["op amp", "op-amp", "opamp", "operational amplifier", "comparator"].iter().any(|k| description.contains(k)) {
        Category::Analog
    } else if description.contains("555") || description.contains("timer") {
        Category::Mixed
    } else {
        Category::Misc
    }
}

fn by_name(upper: &str) -> Option<Category> {
    let letters_then_digits = |prefix: &str| {
        upper.strip_prefix(prefix).is_some_and(|rest| rest.chars().next().is_some_and(|c| c.is_ascii_digit()))
    };
    let after_sn = upper.strip_prefix("SN").unwrap_or(upper);
    if let Some(rest) = after_sn.strip_prefix("74") {
        if rest.chars().next().is_some_and(|c| c.is_ascii_alphanumeric()) {
            return Some(Category::Ttl);
        }
    }
    let after_cmos = upper.strip_prefix("CD").or_else(|| upper.strip_prefix("MC14")).unwrap_or(upper);
    if after_cmos.len() >= 4 && after_cmos.starts_with("40") && after_cmos[2..4].chars().all(|c| c.is_ascii_digit()) {
        return Some(Category::Cmos);
    }
    if upper.contains("555") {
        return Some(Category::Mixed);
    }
    if ["LM78", "LM79", "LM317", "LM337", "LM1117", "LT1086"].iter().any(|p| upper.starts_with(p))
        || (upper.starts_with("78") || upper.starts_with("79")) && upper.len() <= 6
    {
        return Some(Category::Power);
    }
    if ["LM", "TL", "OPA", "AD", "LT", "MC", "NE", "LMV", "TLV", "MCP"].iter().any(|p| letters_then_digits(p)) {
        return Some(Category::Analog);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::candidate::PartKind;
    use crate::library::Category;

    #[test]
    fn device_models_follow_their_type() {
        assert_eq!(guess_category(PartKind::Diode, "1N5819", &[]), Category::Diodes);
        assert_eq!(guess_category(PartKind::Bjt, "BC547", &[]), Category::Transistors);
        assert_eq!(guess_category(PartKind::Mosfet, "IRF540", &[]), Category::Transistors);
        assert_eq!(guess_category(PartKind::Jfet, "J310", &[]), Category::Transistors);
    }

    #[test]
    fn subcircuits_are_guessed_from_name_then_comments() {
        let s = PartKind::Subckt;
        assert_eq!(guess_category(s, "SN74HC00", &[]), Category::Ttl);
        assert_eq!(guess_category(s, "74LS04", &[]), Category::Ttl);
        assert_eq!(guess_category(s, "CD4093", &[]), Category::Cmos);
        assert_eq!(guess_category(s, "4017", &[]), Category::Cmos);
        assert_eq!(guess_category(s, "LM358", &[]), Category::Analog);
        assert_eq!(guess_category(s, "OPA2134", &[]), Category::Analog);
        assert_eq!(guess_category(s, "LM7805", &[]), Category::Power);
        assert_eq!(guess_category(s, "LM317", &[]), Category::Power);
        assert_eq!(guess_category(s, "NE555", &[]), Category::Mixed);
        assert_eq!(guess_category(s, "XYZ1", &["Low-dropout regulator".into()]), Category::Power);
        assert_eq!(guess_category(s, "XYZ2", &["Rail-to-rail op amp".into()]), Category::Analog);
        assert_eq!(guess_category(s, "MYSTERY", &[]), Category::Misc);
    }
}
