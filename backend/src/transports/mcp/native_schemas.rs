//! Offline MCP descriptors from the exact published stock/Atlas schema bytes.
//!
//! The host supplies immutable resources; this adapter opens no files or URLs.
//! Only schema-valued keywords are traversed, so literal values in `const`,
//! `default`, `enum`, examples and annotations remain unchanged.

use std::collections::BTreeSet;

use serde_json::Value;
use sha2::{Digest, Sha256};

use super::{JsonObject, PortError};

pub const AGENT_SCHEMA_SHA256: &str =
    "314ee5f5effca941b3be92cb5cc37150aa17a3ab5dd8646255cebc74767b602d";
pub const ATLAS_SCHEMA_SHA256: &str =
    "ba73d972c87391fe06cd41d68e73bc2d73fc3fcac322889cfb3b8d909c3f3f72";

const DIALECT: &str = "https://json-schema.org/draft/2020-12/schema";
const AGENT_ID: &str = "urn:houseatlas:agent:stock:3";
const ATLAS_ID: &str = "https://houseatlas.invalid/contracts/1.0.0/atlas.schema.json";

#[derive(Clone, Debug)]
pub struct NativeSchemas {
    agent: JsonObject,
    atlas: JsonObject,
}

impl NativeSchemas {
    /// Admit only the pinned stock resource and calendar-amended Atlas resource.
    /// This checks trusted configuration, not application input or authority.
    pub fn from_bytes(agent: &[u8], atlas: &[u8]) -> Result<Self, PortError> {
        Ok(Self {
            agent: resource(agent, AGENT_SCHEMA_SHA256, AGENT_ID)?,
            atlas: resource(atlas, ATLAS_SCHEMA_SHA256, ATLAS_ID)?,
        })
    }

    /// Materialize a published family descriptor with an MCP object root and
    /// its complete transitive definition closure. References resolve locally;
    /// the exact request/result constraints and array ordering are preserved.
    pub fn schema(&self, reference: &str) -> Result<JsonObject, PortError> {
        if !reference.starts_with("#/$defs/family_input_")
            && !reference.starts_with("#/$defs/family_output_")
        {
            return Err(PortError::Unavailable);
        }
        let selected = Definition::resolve(Resource::Agent, reference)?;
        let mut schema = self.definition(&selected)?.clone();
        let mut pending = BTreeSet::new();
        rewrite_schema(&mut schema, Resource::Agent, &mut pending)?;
        let Value::Object(mut root) = schema else {
            return Err(PortError::Unavailable);
        };
        if root.get("type").is_some_and(|kind| kind != "object") {
            return Err(PortError::Unavailable);
        }
        root.insert("type".to_owned(), Value::String("object".to_owned()));
        root.insert("$schema".to_owned(), Value::String(DIALECT.to_owned()));

        let mut definitions = JsonObject::new();
        let mut visited = BTreeSet::new();
        while let Some(definition) = pending.pop_first() {
            if !visited.insert(definition.clone()) {
                continue;
            }
            let mut schema = self.definition(&definition)?.clone();
            rewrite_schema(&mut schema, definition.resource, &mut pending)?;
            definitions.insert(definition.local_name(), schema);
        }
        if root.contains_key("$defs") {
            // The pinned family arms have no local definitions. Never replace
            // a future schema's definitions silently if the pins are updated.
            return Err(PortError::Unavailable);
        }
        root.insert("$defs".to_owned(), Value::Object(definitions));
        Ok(root)
    }

    fn definition(&self, definition: &Definition) -> Result<&Value, PortError> {
        let resource = match definition.resource {
            Resource::Agent => &self.agent,
            Resource::Atlas => &self.atlas,
        };
        resource
            .get("$defs")
            .and_then(Value::as_object)
            .and_then(|definitions| definitions.get(&definition.name))
            .ok_or(PortError::Unavailable)
    }
}

fn resource(bytes: &[u8], expected_hash: &str, expected_id: &str) -> Result<JsonObject, PortError> {
    if format!("{:x}", Sha256::digest(bytes)) != expected_hash {
        return Err(PortError::Unavailable);
    }
    let value: Value = serde_json::from_slice(bytes).map_err(|_| PortError::Unavailable)?;
    let Value::Object(root) = value else {
        return Err(PortError::Unavailable);
    };
    if root.get("$id").and_then(Value::as_str) != Some(expected_id)
        || root.get("$schema").and_then(Value::as_str) != Some(DIALECT)
        || !root.get("$defs").is_some_and(Value::is_object)
    {
        return Err(PortError::Unavailable);
    }
    Ok(root)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Resource {
    Agent,
    Atlas,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Definition {
    resource: Resource,
    name: String,
}

impl Definition {
    fn resolve(current: Resource, reference: &str) -> Result<Self, PortError> {
        // Both pinned resources use a root $id and only definition references.
        // Match those identities exactly; never consult a network retriever.
        let (base, fragment) = reference.split_once('#').ok_or(PortError::Unavailable)?;
        let resource = match base {
            "" => current,
            AGENT_ID => Resource::Agent,
            ATLAS_ID => Resource::Atlas,
            _ => return Err(PortError::Unavailable),
        };
        let token = fragment
            .strip_prefix("/$defs/")
            .ok_or(PortError::Unavailable)?;
        if token.is_empty() || token.contains('/') {
            return Err(PortError::Unavailable);
        }
        // Published names need no URI percent decoding. Preserve JSON Pointer
        // escaping without admitting a different URI/reference interpretation.
        if token.contains('%') {
            return Err(PortError::Unavailable);
        }
        let name = token.replace("~1", "/").replace("~0", "~");
        if pointer_token(&name) != token {
            return Err(PortError::Unavailable);
        }
        Ok(Self { resource, name })
    }

    fn local_name(&self) -> String {
        let prefix = match self.resource {
            Resource::Agent => "agent__",
            Resource::Atlas => "atlas__",
        };
        format!("{prefix}{}", self.name)
    }

    fn local_reference(&self) -> String {
        format!("#/$defs/{}", pointer_token(&self.local_name()))
    }
}

fn pointer_token(value: &str) -> String {
    value.replace('~', "~0").replace('/', "~1")
}

fn rewrite_schema(
    value: &mut Value,
    resource: Resource,
    pending: &mut BTreeSet<Definition>,
) -> Result<(), PortError> {
    if value.is_boolean() {
        return Ok(());
    }
    let schema = value.as_object_mut().ok_or(PortError::Unavailable)?;
    // There are no nested resource IDs or dynamic/anchor refs in these pinned
    // schemas. Their introduction requires an explicit resolver/pin revision.
    if ["$id", "$anchor", "$dynamicAnchor", "$dynamicRef"]
        .iter()
        .any(|key| schema.contains_key(*key))
    {
        return Err(PortError::Unavailable);
    }
    if let Some(reference) = schema.get_mut("$ref") {
        let definition =
            Definition::resolve(resource, reference.as_str().ok_or(PortError::Unavailable)?)?;
        *reference = Value::String(definition.local_reference());
        pending.insert(definition);
    }
    for key in [
        "$defs",
        "properties",
        "patternProperties",
        "dependentSchemas",
    ] {
        if let Some(children) = schema.get_mut(key) {
            for child in children
                .as_object_mut()
                .ok_or(PortError::Unavailable)?
                .values_mut()
            {
                rewrite_schema(child, resource, pending)?;
            }
        }
    }
    for key in ["allOf", "anyOf", "oneOf", "prefixItems"] {
        if let Some(children) = schema.get_mut(key) {
            for child in children.as_array_mut().ok_or(PortError::Unavailable)? {
                rewrite_schema(child, resource, pending)?;
            }
        }
    }
    for key in [
        "additionalProperties",
        "unevaluatedProperties",
        "propertyNames",
        "items",
        "contains",
        "unevaluatedItems",
        "not",
        "if",
        "then",
        "else",
        "contentSchema",
    ] {
        if let Some(child) = schema.get_mut(key) {
            rewrite_schema(child, resource, pending)?;
        }
    }
    Ok(())
}
