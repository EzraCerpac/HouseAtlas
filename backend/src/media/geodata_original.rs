//! Native-only immutable geodata framing. No decompression, remote references,
//! coordinate transformation, ZIP extraction, or spatial qualification occurs.
use super::{MAX_BYTES, MediaError, MediaResult, WorkBudget, types::ContentType};
use serde::{
    Deserializer,
    de::{Error as _, MapAccess, Visitor},
};
use serde_json::{Value, value::RawValue};
use std::{collections::BTreeSet, fmt};
fn bad() -> MediaError {
    MediaError::Unsupported
}
fn need(ok: bool) -> MediaResult<()> {
    if ok { Ok(()) } else { Err(bad()) }
}
struct Entries;
impl<'de> Visitor<'de> for Entries {
    type Value = Vec<(String, &'de RawValue)>;
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("unique JSON keys")
    }
    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
        let mut rows = Vec::new();
        let mut seen = BTreeSet::new();
        while let Some((key, value)) = map.next_entry::<String, &'de RawValue>()? {
            if !seen.insert(key.clone()) {
                return Err(M::Error::custom("duplicate key"));
            }
            rows.push((key, value));
        }
        Ok(rows)
    }
}
fn json_value(
    raw: &RawValue,
    depth: usize,
    count: &mut usize,
    budget: &WorkBudget,
) -> MediaResult<Value> {
    budget.check()?;
    need(depth <= 64 && *count < 1_000_000)?;
    *count += 1;
    let text = raw.get().trim_start();
    match text.as_bytes().first() {
        Some(b'{') => {
            let mut d = serde_json::Deserializer::from_str(text);
            let rows = d.deserialize_map(Entries).map_err(|_| bad())?;
            need(rows.len() <= 50_000)?;
            let mut out = serde_json::Map::new();
            for (k, v) in rows {
                need(k.len() <= 4096)?;
                out.insert(k, json_value(v, depth + 1, count, budget)?);
            }
            Ok(Value::Object(out))
        }
        Some(b'[') => {
            let rows: Vec<&RawValue> = serde_json::from_str(text).map_err(|_| bad())?;
            need(rows.len() <= 250_000)?;
            rows.into_iter()
                .map(|v| json_value(v, depth + 1, count, budget))
                .collect::<MediaResult<Vec<_>>>()
                .map(Value::Array)
        }
        _ => serde_json::from_str(text).map_err(|_| bad()),
    }
}
fn city_body(city: &Value) -> MediaResult<()> {
    need(city["type"] == "CityJSON" || city["type"] == "CityJSONFeature")?;
    need(city["CityObjects"].is_object())?;
    let vertices = city["vertices"].as_array().ok_or_else(bad)?;
    need(vertices.iter().all(|p| {
        p.as_array().is_some_and(|a| {
            a.len() == 3 && a.iter().all(|x| x.as_f64().is_some_and(f64::is_finite))
        })
    }))
}
fn geodata_json(bytes: &[u8], kind: ContentType, budget: &WorkBudget) -> MediaResult<()> {
    let raw: &RawValue = serde_json::from_slice(bytes).map_err(|_| bad())?;
    let mut count = 0;
    let v = json_value(raw, 0, &mut count, budget)?;
    match kind {
        ContentType::GeoJson => {
            let typ = v["type"].as_str().ok_or_else(bad)?;
            need(matches!(
                typ,
                "FeatureCollection"
                    | "Feature"
                    | "GeometryCollection"
                    | "Point"
                    | "MultiPoint"
                    | "LineString"
                    | "MultiLineString"
                    | "Polygon"
                    | "MultiPolygon"
            ))?;
            if typ == "FeatureCollection" {
                let rows = v["features"].as_array().ok_or_else(bad)?;
                need(rows.iter().all(|r| {
                    r["type"] == "Feature"
                        && r.as_object().is_some_and(|o| {
                            o.contains_key("geometry") && o.contains_key("properties")
                        })
                }))?;
            } else if typ == "Feature" {
                need(
                    v.as_object().is_some_and(|o| {
                        o.contains_key("geometry") && o.contains_key("properties")
                    }),
                )?;
            } else if typ == "GeometryCollection" {
                need(v["geometries"].is_array())?;
            } else {
                need(v["coordinates"].is_array())?;
            }
        }
        ContentType::CityJson => {
            // Official 3DBAG API pages carry CityJSONFeature objects and one
            // separate CityJSON metadata/quantization record. Their collection
            // envelope is not a GeoJSON FeatureCollection. Retain it unchanged;
            // no vertices, transforms or source counters are reinterpreted.
            if v["type"] == "FeatureCollection" {
                need(v["metadata"]["type"] == "CityJSON")?;
                let features = v["features"].as_array().ok_or_else(bad)?;
                need(features.len() <= 10_000)?;
                for feature in features {
                    budget.check()?;
                    need(feature["type"] == "CityJSONFeature")?;
                    city_body(feature)?;
                }
            } else if v["type"].is_string() {
                city_body(&v)?;
            } else {
                need(v["metadata"]["type"] == "CityJSON")?;
                city_body(&v["feature"])?;
            }
        }
        _ => return Err(bad()),
    }
    budget.check()
}
fn tiff(bytes: &[u8], budget: &WorkBudget) -> MediaResult<()> {
    let little = match bytes.get(..4) {
        Some(b"II\x2a\0") => true,
        Some(b"MM\0\x2a") => false,
        _ => return Err(bad()),
    };
    let number = |at: usize, n: usize| -> MediaResult<u32> {
        let b = bytes
            .get(at..at.checked_add(n).ok_or_else(bad)?)
            .ok_or_else(bad)?;
        match (n, little) {
            (2, true) => Ok(u16::from_le_bytes(b.try_into().map_err(|_| bad())?) as u32),
            (2, false) => Ok(u16::from_be_bytes(b.try_into().map_err(|_| bad())?) as u32),
            (4, true) => Ok(u32::from_le_bytes(b.try_into().map_err(|_| bad())?)),
            (4, false) => Ok(u32::from_be_bytes(b.try_into().map_err(|_| bad())?)),
            _ => Err(bad()),
        }
    };
    let mut at = number(4, 4)? as usize;
    let mut seen = BTreeSet::new();
    let mut first = true;
    while at != 0 {
        budget.check()?;
        need(at >= 8 && seen.len() < 16 && seen.insert(at))?;
        let count = number(at, 2)? as usize;
        need((1..=4096).contains(&count))?;
        let end = at.checked_add(2 + count * 12).ok_or_else(bad)?;
        need(end.checked_add(4).is_some_and(|e| e <= bytes.len()))?;
        let mut tags = BTreeSet::new();
        let mut dims = BTreeSet::new();
        for i in 0..count {
            budget.check()?;
            let e = at + 2 + i * 12;
            let tag = number(e, 2)?;
            need(tags.insert(tag))?;
            let kind = number(e + 2, 2)?;
            let width = match kind {
                1 | 2 | 6 | 7 => 1,
                3 | 8 => 2,
                4 | 9 | 11 | 13 => 4,
                5 | 10 | 12 => 8,
                _ => return Err(bad()),
            };
            let n = number(e + 4, 4)? as usize;
            let size = n.checked_mul(width).ok_or_else(bad)?;
            need(n > 0)?;
            let data = if size <= 4 {
                e + 8
            } else {
                number(e + 8, 4)? as usize
            };
            need(data.checked_add(size).is_some_and(|x| x <= bytes.len()))?;
            if matches!(tag, 256 | 257) {
                need(n == 1 && matches!(kind, 3 | 4) && number(data, width)? > 0)?;
                dims.insert(tag);
            }
        }
        if first {
            need(dims.len() == 2)?;
            first = false;
        }
        at = number(end, 4)? as usize;
    }
    need(!first)
}
/// This admits a bounded download envelope, never a rendered-safe source.
/// Only classic TIFF (not BigTIFF) and JSON-based native families are supported.
pub fn validate(bytes: &[u8], kind: ContentType, budget: &WorkBudget) -> MediaResult<()> {
    budget.check()?;
    if bytes.len() > MAX_BYTES {
        return Err(MediaError::TooLarge);
    }
    need(!bytes.is_empty())?;
    match kind {
        ContentType::GeoTiff => tiff(bytes, budget),
        ContentType::GeoJson | ContentType::CityJson => geodata_json(bytes, kind, budget),
        _ => Err(bad()),
    }
}
