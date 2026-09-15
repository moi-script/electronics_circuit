//! `{placeholder}` templates used by manifests.

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum TemplateError {
    #[error("unclosed '{{' in template")]
    Unclosed,
    #[error("unknown placeholder {{{0}}}")]
    Unknown(String),
}

pub fn placeholders(template: &str) -> Result<Vec<String>, TemplateError> {
    let mut names = Vec::new();
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        let after = &rest[start + 1..];
        let end = after.find('}').ok_or(TemplateError::Unclosed)?;
        names.push(after[..end].to_string());
        rest = &after[end + 1..];
    }
    Ok(names)
}

pub fn render(
    template: &str,
    lookup: impl Fn(&str) -> Option<String>,
) -> Result<String, TemplateError> {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let end = after.find('}').ok_or(TemplateError::Unclosed)?;
        let name = &after[..end];
        let value = lookup(name).ok_or_else(|| TemplateError::Unknown(name.to_string()))?;
        out.push_str(&value);
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn lists_placeholders_in_order() {
        assert_eq!(
            placeholders("{ref} {pin.1} {pin.2} {resistance}").unwrap(),
            vec!["ref", "pin.1", "pin.2", "resistance"]
        );
        assert_eq!(placeholders("no braces").unwrap(), Vec::<String>::new());
    }

    #[test]
    fn unclosed_brace_is_an_error() {
        assert_eq!(placeholders("{ref {pin.1}"), Ok(vec!["ref {pin.1".to_string()]));
        assert_eq!(placeholders("{ref"), Err(TemplateError::Unclosed));
    }

    #[test]
    fn renders_values() {
        let values: BTreeMap<&str, &str> =
            [("ref", "R1"), ("pin.1", "n1"), ("pin.2", "0"), ("resistance", "1e3")].into();
        let out = render("{ref} {pin.1} {pin.2} {resistance}", |k| {
            values.get(k).map(|v| v.to_string())
        })
        .unwrap();
        assert_eq!(out, "R1 n1 0 1e3");
    }

    #[test]
    fn unknown_placeholder_is_an_error() {
        let err = render("{ref} {nope}", |k| (k == "ref").then(|| "R1".to_string()));
        assert_eq!(err, Err(TemplateError::Unknown("nope".into())));
    }
}
