use super::error::invalid;
use super::types::text;
use super::*;
use serde::de::{DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::{Map, Value};
use std::{collections::BTreeMap, fmt};
use url::Url;

// serde_json::Value alone silently replaces duplicate keys. Inspect every map,
// including unknown extension fields, before decoding the typed synthetic dialect.
struct JsonSeed(usize);
impl<'de> DeserializeSeed<'de> for JsonSeed {
    type Value = Value;
    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<Value, D::Error> {
        if self.0 > 64 {
            return Err(serde::de::Error::custom("nesting limit"));
        }
        // Read lexical containers explicitly: arbitrary_precision numbers use a
        // private Serde map representation, which must never be confused with an
        // actual JSON extension object. RawValue retains that distinction.
        let raw = <&serde_json::value::RawValue>::deserialize(d)?;
        let token = raw.get();
        let mut decoder = serde_json::Deserializer::from_str(token);
        let value = match token.as_bytes().first() {
            Some(b'{') => decoder.deserialize_map(self),
            Some(b'[') => decoder.deserialize_seq(self),
            _ => serde_json::from_str::<Value>(token),
        }
        .map_err(serde::de::Error::custom)?;
        if let Value::Number(n) = &value
            && n.as_f64().is_none_or(|n| !n.is_finite())
        {
            return Err(serde::de::Error::custom("nonfinite number"));
        }
        Ok(value)
    }
}
impl<'de> Visitor<'de> for JsonSeed {
    type Value = Value;
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("bounded JSON metadata")
    }
    fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<Value, E> {
        Ok(Value::Bool(v))
    }
    fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Value, E> {
        Ok(v.into())
    }
    fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Value, E> {
        Ok(v.into())
    }
    fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<Value, E> {
        serde_json::Number::from_f64(v)
            .map(Value::Number)
            .ok_or_else(|| E::custom("nonfinite number"))
    }
    fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Value, E> {
        Ok(Value::String(v.into()))
    }
    fn visit_string<E: serde::de::Error>(self, v: String) -> Result<Value, E> {
        Ok(Value::String(v))
    }
    fn visit_unit<E: serde::de::Error>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> Result<Value, A::Error> {
        let mut rows = Vec::new();
        while let Some(v) = a.next_element_seed(JsonSeed(self.0 + 1))? {
            rows.push(v);
        }
        Ok(Value::Array(rows))
    }
    fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Value, A::Error> {
        let mut map = Map::new();
        while let Some(k) = a.next_key::<String>()? {
            if map.contains_key(&k) {
                return Err(serde::de::Error::custom("duplicate key"));
            }
            map.insert(k, a.next_value_seed(JsonSeed(self.0 + 1))?);
        }
        Ok(Value::Object(map))
    }
}
pub(super) fn parse(bytes: &[u8]) -> Result<Value, ReadError> {
    std::str::from_utf8(bytes).map_err(|_| invalid())?;
    let mut d = serde_json::Deserializer::from_slice(bytes);
    let value = JsonSeed(0).deserialize(&mut d).map_err(|_| invalid())?;
    d.end().map_err(|_| invalid())?;
    Ok(value)
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireEntity {
    pub id: Uuid,
    pub name: String,
    pub archived: bool,
    pub updated_at: Timestamp,
    pub entity_type: Option<EntityType>,
    pub parent: Option<Parent>,
}
impl WireEntity {
    pub(super) fn validate(&self, projected: bool) -> Result<(), ReadError> {
        text(
            &self.name,
            usize::from(projected),
            if projected { 4096 } else { 16384 },
        )?;
        if let Some(t) = &self.entity_type {
            text(
                &t.name,
                usize::from(projected),
                if projected { 4096 } else { 16384 },
            )?;
        }
        Ok(())
    }
}
pub(super) struct WirePage {
    pub items: Vec<Value>,
    pub page: u64,
    pub page_size: u64,
    pub total: u64,
}
pub(super) fn page(value: Value) -> Result<WirePage, ReadError> {
    #[derive(Deserialize)]
    struct Integer(#[serde(deserialize_with = "super::types::deserialize_integral_u64")] u64);
    let integer = |key: &str| -> Result<u64, ReadError> {
        let value = value.get(key).ok_or_else(invalid)?;
        if !value.is_number() {
            return Err(invalid());
        }
        serde_json::from_value::<Integer>(value.clone())
            .map(|v| v.0)
            .map_err(|_| invalid())
    };
    Ok(WirePage {
        items: value["items"].as_array().ok_or_else(invalid)?.clone(),
        page: integer("page")?,
        page_size: integer("pageSize")?,
        total: integer("total")?,
    })
}

/// Normalize only UUID fields; collection IDs remain opaque and case-sensitive.
pub(super) fn wire(mut value: Value) -> Result<(WireEntity, Value), ReadError> {
    let obj = value.as_object_mut().ok_or_else(invalid)?;
    for key in ["id", "entityType", "parent"] {
        if key == "id" {
            normalize_uuid(obj.get_mut(key).ok_or_else(invalid)?)?;
        } else {
            let nested = obj.entry(key).or_insert(Value::Null);
            if !nested.is_null() {
                normalize_uuid(
                    nested
                        .as_object_mut()
                        .ok_or_else(invalid)?
                        .get_mut("id")
                        .ok_or_else(invalid)?,
                )?;
            }
        }
    }
    let row: WireEntity = serde_json::from_value(value.clone()).map_err(|_| invalid())?;
    row.validate(false)?;
    Ok((row, value))
}
fn normalize_uuid(v: &mut Value) -> Result<(), ReadError> {
    *v = Value::String(
        Uuid::parse(v.as_str().ok_or_else(invalid)?)?
            .as_str()
            .to_owned(),
    );
    Ok(())
}
fn exact_fields(v: &Value, fields: &[&str]) -> Result<(), ReadError> {
    let obj = v.as_object().ok_or_else(invalid)?;
    if obj.len() != fields.len() || fields.iter().any(|k| !obj.contains_key(*k)) {
        return Err(invalid());
    }
    Ok(())
}
fn optional_text(s: &Option<String>) -> Result<(), ReadError> {
    if let Some(s) = s {
        text(s, 0, 16384)?;
    }
    Ok(())
}
fn optional_number(n: Option<f64>) -> Result<(), ReadError> {
    if n.is_some_and(|v| !v.is_finite()) {
        return Err(invalid());
    }
    Ok(())
}
fn reference_url(value: &str) -> Result<Url, ReadError> {
    // URL parsing normalizes scheme case; the published ^https?:// pattern
    // applies to the original serialized reference, which is preserved here.
    if !value.starts_with("http://") && !value.starts_with("https://") {
        return Err(invalid());
    }
    // Validate the original RFC 3986 URI, including character classes and
    // percent-encoded octets, before WHATWG parsing can repair its spelling.
    // Borrowed Uri parsing neither normalizes the reference nor retrieves it.
    fluent_uri::Uri::parse(value).map_err(|_| invalid())?;
    Url::parse(value).map_err(|_| invalid())
}
pub(super) fn validate_attachment(a: &Attachment) -> Result<(), ReadError> {
    match a {
        Attachment::StoredFile {
            title,
            content_type,
            proxy_ref,
            ..
        } => {
            text(title, 0, 16384)?;
            if let Some(c) = content_type {
                text(c, 1, 4096)?;
            }
            if proxy_ref.is_some() {
                return Err(invalid());
            }
        }
        Attachment::ExternalLink {
            title,
            url,
            archived,
            ..
        } => {
            text(title, 0, 16384)?;
            let u = reference_url(url)?;
            if *archived
                || !matches!(u.scheme(), "http" | "https")
                || !u.username().is_empty()
                || u.password().is_some()
            {
                return Err(invalid());
            }
        }
    }
    Ok(())
}
pub(super) fn validate_maintenance(m: &Maintenance) -> Result<(), ReadError> {
    text(&m.name, 0, 16384)?;
    text(&m.description, 0, 16384)?;
    if let Some(cost) = &m.cost {
        // Use the same lexical envelope as the native projection contract:
        // token bytes, exponent and decimal shift. Keep the original Number.
        serde_json::from_value::<crate::contracts::JsonNumber>(Value::Number(cost.clone()))
            .map_err(|_| invalid())?;
    }
    // Retain the existing finite-number admission rule, without replacing the
    // stored decimal by the rounded/underflowed f64 used for that check.
    if m.cost
        .as_ref()
        .is_some_and(|n| n.as_f64().is_none_or(|n| !n.is_finite()))
    {
        return Err(invalid());
    }
    Ok(())
}
fn attachments(value: Value) -> Result<Vec<Attachment>, ReadError> {
    let mut result = BTreeMap::new();
    for raw in value.as_array().ok_or_else(invalid)? {
        let mut raw = raw.clone();
        let stored = raw["kind"] == "stored-file";
        exact_fields(
            &raw,
            if stored {
                &[
                    "attachmentId",
                    "kind",
                    "title",
                    "contentType",
                    "byteSize",
                    "proxyRef",
                ]
            } else {
                &["attachmentId", "kind", "title", "url", "archived"]
            },
        )?;
        // A provider cannot mint an Atlas media capability. Preserve metadata only.
        if stored {
            if !raw["byteSize"].is_null() && !raw["byteSize"].is_number() {
                return Err(invalid());
            }
            raw["proxyRef"] = Value::Null;
        }
        let a: Attachment = serde_json::from_value(raw).map_err(|_| invalid())?;
        validate_attachment(&a)?;
        if let Some(prior) = result.insert(a.id().clone(), a.clone())
            && prior != a
        {
            return Err(invalid());
        }
    }
    Ok(result.into_values().collect())
}
fn maintenance(value: Value) -> Result<Vec<Maintenance>, ReadError> {
    let mut result = BTreeMap::new();
    for raw in value.as_array().ok_or_else(invalid)? {
        exact_fields(
            raw,
            &[
                "entryId",
                "name",
                "description",
                "scheduledDate",
                "completedDate",
                "cost",
            ],
        )?;
        let m: Maintenance = serde_json::from_value(raw.clone()).map_err(|_| invalid())?;
        validate_maintenance(&m)?;
        if let Some(prior) = result.insert(m.entry_id.clone(), m.clone())
            && prior != m
        {
            return Err(invalid());
        }
    }
    Ok(result.into_values().collect())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptionalDetail {
    description: Option<String>,
    quantity: Option<f64>,
    manufacturer: Option<String>,
    model_number: Option<String>,
    serial_number: Option<String>,
    notes: Option<String>,
}
pub(super) fn projection(
    raw: Value,
    row: WireEntity,
    entries: Value,
    scope: &SourceScope,
    retrieved_at: Timestamp,
    navigation: Option<&NativeNavigation>,
) -> Result<Projection, ReadError> {
    row.validate(true)?;
    let extra: OptionalDetail = serde_json::from_value(raw.clone()).map_err(|_| invalid())?;
    let source = SourceKey {
        source_instance_id: scope.source_instance_id.clone(),
        collection_id: scope.collection_id.clone(),
        source_kind: "homebox-entity",
        external_id: row.id.clone(),
    };
    let p = Projection {
        schema_version: 1,
        workspace_id: scope.workspace_id.clone(),
        home_id: scope.home_id.clone(),
        native_links: navigation
            .map(|n| n.links(scope, &source))
            .unwrap_or_default(),
        source,
        source_updated_at: Some(row.updated_at),
        retrieved_at,
        entity: Entity {
            id: row.id,
            name: row.name,
            description: extra.description.unwrap_or_default(),
            entity_type: row.entity_type,
            parent: row.parent,
            archived: row.archived,
            quantity: extra.quantity,
            manufacturer: extra.manufacturer,
            model_number: extra.model_number,
            serial_number: extra.serial_number,
            notes: extra.notes,
        },
        attachments: attachments(raw.get("attachments").ok_or_else(invalid)?.clone())?,
        maintenance: maintenance(entries)?,
    };
    validate_projection(&p, scope)?;
    Ok(p)
}
pub(super) fn validate_projection(p: &Projection, scope: &SourceScope) -> Result<(), ReadError> {
    if p.workspace_id != scope.workspace_id
        || p.home_id != scope.home_id
        || p.source.source_instance_id != scope.source_instance_id
        || p.source.collection_id != scope.collection_id
        || p.source.source_kind != "homebox-entity"
    {
        return Err(ReadError(ErrorCode::WrongScope));
    }
    if p.schema_version != 1 || p.entity.id != p.source.external_id {
        return Err(invalid());
    }
    text(&p.entity.name, 1, 4096)?;
    text(&p.entity.description, 0, 16384)?;
    if let Some(t) = &p.entity.entity_type {
        text(&t.name, 1, 4096)?;
    }
    optional_number(p.entity.quantity)?;
    for s in [
        &p.entity.manufacturer,
        &p.entity.model_number,
        &p.entity.serial_number,
        &p.entity.notes,
    ] {
        optional_text(s)?;
    }
    let mut seen = BTreeMap::new();
    for a in &p.attachments {
        validate_attachment(a)?;
        if seen.insert(a.id(), ()).is_some() {
            return Err(invalid());
        }
    }
    let mut seen = BTreeMap::new();
    for m in &p.maintenance {
        validate_maintenance(m)?;
        if seen.insert(&m.entry_id, ()).is_some() {
            return Err(invalid());
        }
    }
    for link in &p.native_links {
        if link.kind != "homebox-native"
            || link.entity.workspace_id != p.workspace_id
            || link.entity.home_id != p.home_id
            || link.entity.key != p.source
            || !link.verified_route
        {
            return Err(invalid());
        }
        let url = reference_url(&link.href)?;
        if !matches!(url.scheme(), "http" | "https")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(invalid());
        }
    }
    Ok(())
}
