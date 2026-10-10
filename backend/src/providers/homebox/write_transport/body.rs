use super::{TransportFault, stock};
use serde::{
    Deserializer,
    de::{MapAccess, Visitor},
};
use serde_json::{Value, value::RawValue};
use sha2::{Digest as _, Sha256};
use std::{collections::BTreeSet, fmt, io::Write};

pub(super) fn digest(bytes: &[u8]) -> stock::Digest {
    stock::Digest::parse(format!("{:x}", Sha256::digest(bytes))).expect("SHA256 lowercase hex")
}

struct BoundedBuffer {
    bytes: Vec<u8>,
    limit: usize,
}
impl Write for BoundedBuffer {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > self.limit - self.bytes.len() {
            return Err(std::io::Error::other("request bound"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Serialize the actual prepared value once; send these bytes unchanged.
pub(super) fn encode(
    body: &stock::NativeBody,
    upload: Option<Vec<u8>>,
    operation_id: uuid::Uuid,
    limit: usize,
) -> Result<(Vec<u8>, Option<String>), TransportFault> {
    let mut out = BoundedBuffer {
        bytes: Vec::new(),
        limit,
    };
    let content_type = match body {
        stock::NativeBody::None => None,
        stock::NativeBody::Json(value) => {
            serde_json::to_writer(&mut out, value).map_err(|_| TransportFault::RequestBound)?;
            Some("application/json".into())
        }
        stock::NativeBody::Multipart {
            file_field,
            stage,
            fields,
        } => {
            let bytes = upload.ok_or(TransportFault::Stage)?;
            if bytes.len() as u64 != stage.byte_size
                || digest(&bytes) != stage.sha256
                || stage.filename.is_empty()
                || stage.filename.len() > 4096
                || stage.filename.contains(['\r', '\n', '\0', '/', '\\'])
                || stage.filename.contains("..")
                || stage.content_type.len() > 256
                || !stage.content_type.contains('/')
                || !stage
                    .content_type
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"/-+._".contains(&b))
            {
                return Err(TransportFault::Stage);
            }
            let boundary = format!(
                "houseatlas-{}-{}",
                operation_id.simple(),
                &stage.sha256.as_str()[..24]
            );
            if bytes
                .windows(boundary.len())
                .any(|v| v == boundary.as_bytes())
                || fields.iter().any(|(_, v)| v.contains(&boundary))
            {
                return Err(TransportFault::Stage);
            }
            // Fixed field names have already passed the route envelope checker.
            for (name, value) in fields {
                write!(out, "--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n")
                    .map_err(|_| TransportFault::RequestBound)?;
            }
            let filename = stage.filename.replace('"', "\\\"");
            write!(out, "--{boundary}\r\nContent-Disposition: form-data; name=\"{file_field}\"; filename=\"{filename}\"\r\nContent-Type: {}\r\n\r\n", stage.content_type)
                .map_err(|_| TransportFault::RequestBound)?;
            out.write_all(&bytes)
                .map_err(|_| TransportFault::RequestBound)?;
            write!(out, "\r\n--{boundary}--\r\n").map_err(|_| TransportFault::RequestBound)?;
            Some(format!("multipart/form-data; boundary={boundary}"))
        }
    };
    Ok((out.bytes, content_type))
}

/// Transport syntax only. Identity/schema/effect correlation remains with the
/// stock evidence/preparation owners. RawValue avoids serde numeric metadata
/// aliases and reconstructs literal keys without duplicate-key replacement.
pub(super) fn json(bytes: &[u8]) -> Result<Value, TransportFault> {
    let raw: &RawValue =
        serde_json::from_slice(bytes).map_err(|_| TransportFault::ResponseFormat)?;
    value(raw, 64).map_err(|_| TransportFault::ResponseFormat)
}
struct Entries;
impl<'de> Visitor<'de> for Entries {
    type Value = Vec<(String, &'de RawValue)>;
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("native object")
    }
    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
        let mut entries = Vec::new();
        let mut keys = BTreeSet::new();
        while let Some((key, raw)) = map.next_entry::<String, &RawValue>()? {
            if !keys.insert(key.clone()) {
                return Err(serde::de::Error::custom("duplicate key"));
            }
            entries.push((key, raw));
        }
        Ok(entries)
    }
}
fn value(raw: &RawValue, remaining: usize) -> Result<Value, serde_json::Error> {
    let token = raw.get().trim_start();
    match token.as_bytes().first() {
        Some(b'{' | b'[') if remaining == 0 => Err(
            <serde_json::Error as serde::de::Error>::custom("depth bound"),
        ),
        Some(b'{') => {
            let mut decoder = serde_json::Deserializer::from_str(token);
            decoder
                .deserialize_map(Entries)?
                .into_iter()
                .map(|(key, raw)| Ok((key, value(raw, remaining - 1)?)))
                .collect::<Result<serde_json::Map<_, _>, _>>()
                .map(Value::Object)
        }
        Some(b'[') => serde_json::from_str::<Vec<&RawValue>>(token)?
            .into_iter()
            .map(|raw| value(raw, remaining - 1))
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        Some(b'"') => serde_json::from_str(token).map(Value::String),
        Some(b't' | b'f') => serde_json::from_str(token).map(Value::Bool),
        Some(b'n') => serde_json::from_str::<()>(token).map(|()| Value::Null),
        _ => serde_json::from_str(token).map(Value::Number),
    }
}
