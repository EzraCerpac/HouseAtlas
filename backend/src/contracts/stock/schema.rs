//! Stock wire3 draft2020-12 validation using embedded resources only. The
//! synthetic file URLs are resolution identities, never filesystem reads.

use std::{collections::BTreeMap, sync::OnceLock};

use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::{StockError, catalog};

pub const AGENT_URI: &str = "urn:houseatlas:agent:stock:3";
pub const ATLAS_URI: &str = "https://houseatlas.invalid/contracts/1.0.0/atlas.schema.json";
pub const WITNESS_URI: &str =
    "file:///houseatlas/contracts/stock-wire3/presence/witness.v1.schema.json";
pub const QUALIFICATION_URI: &str =
    "file:///houseatlas/contracts/stock-wire3/presence/qualification.v1.schema.json";
const ATLAS_FILE_URI: &str = "file:///houseatlas/packages/contracts/schemas/atlas.schema.json";
const DIALECT: &str = "https://json-schema.org/draft/2020-12/schema";
const VALIDATOR_BASE: &str = "urn:houseatlas:stock:validator";

const ATLAS_BYTES: &[u8] =
    include_bytes!("../../../../packages/contracts/schemas/atlas.schema.json");
const AGENT_BYTES: &[u8] =
    include_bytes!("../../../../contracts/stock-wire3/agent/agent.schema.json");
const WITNESS_BYTES: &[u8] =
    include_bytes!("../../../../contracts/stock-wire3/presence/witness.v1.schema.json");
const QUALIFICATION_BYTES: &[u8] =
    include_bytes!("../../../../contracts/stock-wire3/presence/qualification.v1.schema.json");

type ValidatorSlot = OnceLock<Result<jsonschema::Validator, String>>;

struct Schemas {
    registry: jsonschema::Registry<'static>,
    validators: BTreeMap<String, ValidatorSlot>,
    aliases: BTreeMap<String, String>,
    agent_definitions: usize,
    atlas_definitions: usize,
}

static SCHEMAS: OnceLock<Result<Schemas, String>> = OnceLock::new();

/// Successful compilation reports structural coverage, not runtime admission
/// or a qualification of invalid, adversarial, provider, or storage behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaCounts {
    pub agent_definitions: usize,
    pub atlas_definitions: usize,
    pub operation_inputs: usize,
    pub operation_outputs: usize,
    pub family_inputs: usize,
    pub family_outputs: usize,
    pub presence_schemas: usize,
}

fn parse_embedded(bytes: &[u8], label: &str) -> Result<Value, String> {
    let schema =
        super::super::json_value::parse(bytes).map_err(|error| format!("{label}: {error}"))?;
    super::super::ensure_numbers_supported(&schema)
        .map_err(|error| format!("{label}: unsupported schema numeric processing: {error}"))?;
    Ok(schema)
}

fn check_resource_map() -> Result<(), String> {
    let map = parse_embedded(
        include_bytes!("../../../../contracts/stock-wire3/resource-map.json"),
        "stock resource map",
    )?;
    if map["format"] != "houseatlas-offline-schema-resources/1"
        || map["networkResolution"] != false
        || map["dialect"] != DIALECT
    {
        return Err("embedded stock resource map does not specify local draft2020-12".to_owned());
    }
    let resources = map["resources"]
        .as_array()
        .ok_or_else(|| "stock schema resources must be an array".to_owned())?;
    let expected = [
        (
            "packages/contracts/schemas/atlas.schema.json",
            Some(ATLAS_URI),
            ATLAS_BYTES,
        ),
        (
            "contracts/stock-wire3/agent/agent.schema.json",
            Some(AGENT_URI),
            AGENT_BYTES,
        ),
        (
            "contracts/stock-wire3/presence/witness.v1.schema.json",
            None,
            WITNESS_BYTES,
        ),
        (
            "contracts/stock-wire3/presence/qualification.v1.schema.json",
            None,
            QUALIFICATION_BYTES,
        ),
    ];
    if resources.len() != expected.len() {
        return Err("stock schema resource map must contain exactly four resources".to_owned());
    }
    for (path, uri, bytes) in expected {
        let resource = resources
            .iter()
            .find(|resource| resource["path"] == path)
            .ok_or_else(|| format!("missing embedded schema resource {path}"))?;
        if resource.get("uri").and_then(Value::as_str) != uri {
            return Err(format!(
                "embedded schema resource identity differs for {path}"
            ));
        }
        let actual = format!("{:x}", Sha256::digest(bytes));
        if resource.get("sha256").and_then(Value::as_str) != Some(actual.as_str()) {
            return Err(format!("embedded schema digest differs for {path}"));
        }
    }
    let metadata = map["metadataSchemaResources"]
        .as_array()
        .ok_or_else(|| "stock metadata schema resources must be an array".to_owned())?;
    for path in [
        "contracts/stock-wire3/agent/operation-catalog.json",
        "contracts/stock-wire3/agent/tool-families.json",
    ] {
        let item = metadata
            .iter()
            .find(|item| item["path"] == path)
            .ok_or_else(|| format!("missing metadata fragment resource {path}"))?;
        if item["fragmentBaseUri"] != AGENT_URI
            || item["schemaPath"] != "contracts/stock-wire3/agent/agent.schema.json"
            || item["fields"] != json!(["inputSchema", "outputSchema"])
        {
            return Err(format!(
                "unsupported metadata fragment resolution for {path}"
            ));
        }
    }
    Ok(())
}

fn add_definitions(
    schema: &Value,
    uri: &str,
    short_fragments: bool,
    validators: &mut BTreeMap<String, ValidatorSlot>,
    aliases: &mut BTreeMap<String, String>,
) -> Result<usize, String> {
    let definitions = schema["$defs"]
        .as_object()
        .ok_or_else(|| format!("embedded schema {uri} requires $defs"))?;
    for name in definitions.keys() {
        let escaped = name.replace('~', "~0").replace('/', "~1");
        let fragment = format!("#/$defs/{escaped}");
        let reference = format!("{uri}{fragment}");
        validators.insert(reference.clone(), OnceLock::new());
        if short_fragments {
            aliases.insert(fragment, reference);
        }
    }
    Ok(definitions.len())
}

fn compile_resources() -> Result<Schemas, String> {
    check_resource_map()?;
    let atlas = parse_embedded(ATLAS_BYTES, "frozen Atlas schema")?;
    let agent = parse_embedded(AGENT_BYTES, "stock agent schema")?;
    let witness = parse_embedded(WITNESS_BYTES, "source-presence witness schema")?;
    let qualification =
        parse_embedded(QUALIFICATION_BYTES, "source-presence qualification schema")?;
    if atlas["$id"] != ATLAS_URI || agent["$id"] != AGENT_URI {
        return Err("embedded Atlas/stock schema canonical identity differs".to_owned());
    }
    for (label, schema) in [
        (ATLAS_URI, &atlas),
        (AGENT_URI, &agent),
        (WITNESS_URI, &witness),
        (QUALIFICATION_URI, &qualification),
    ] {
        if schema["$schema"] != DIALECT {
            return Err(format!("embedded schema {label} does not use draft2020-12"));
        }
    }
    if witness.get("$id").is_some() || qualification.get("$id").is_some() {
        return Err("presence schemas must retain their file-URL reference bases".to_owned());
    }

    let mut validators = BTreeMap::new();
    let mut aliases = BTreeMap::new();
    let agent_definitions =
        add_definitions(&agent, AGENT_URI, true, &mut validators, &mut aliases)?;
    let atlas_definitions =
        add_definitions(&atlas, ATLAS_URI, false, &mut validators, &mut aliases)?;
    for uri in [ATLAS_URI, AGENT_URI, WITNESS_URI, QUALIFICATION_URI] {
        validators.insert(uri.to_owned(), OnceLock::new());
    }
    aliases.insert("#".to_owned(), AGENT_URI.to_owned());
    aliases.insert(
        "contracts/stock-wire3/agent/agent.schema.json".to_owned(),
        AGENT_URI.to_owned(),
    );
    aliases.insert(
        "contracts/stock-wire3/presence/witness.v1.schema.json".to_owned(),
        WITNESS_URI.to_owned(),
    );
    aliases.insert(
        "contracts/stock-wire3/presence/qualification.v1.schema.json".to_owned(),
        QUALIFICATION_URI.to_owned(),
    );

    // Registry's default retriever rejects every missing resource. All file
    // URIs are in-memory identities; the Atlas file URI aliases frozen bytes.
    let registry = jsonschema::Registry::new()
        .draft(jsonschema::Draft::Draft202012)
        .add(ATLAS_URI, atlas.clone())
        .map_err(|error| error.to_string())?
        .add(ATLAS_FILE_URI, atlas)
        .map_err(|error| error.to_string())?
        .add(AGENT_URI, agent)
        .map_err(|error| error.to_string())?
        .add(WITNESS_URI, witness)
        .map_err(|error| error.to_string())?
        .add(QUALIFICATION_URI, qualification)
        .map_err(|error| error.to_string())?
        .prepare()
        .map_err(|error| error.to_string())?;
    let schemas = Schemas {
        registry,
        validators,
        aliases,
        agent_definitions,
        atlas_definitions,
    };
    for operation in catalog::operations().map_err(|error| error.to_string())? {
        for reference in [&operation.input_schema, &operation.output_schema] {
            if schemas.resolve(reference).is_none() {
                return Err(format!(
                    "catalog operation {} references unknown schema {reference}",
                    operation.id
                ));
            }
        }
    }
    for family in catalog::families().map_err(|error| error.to_string())? {
        for reference in [&family.input_schema, &family.output_schema] {
            if schemas.resolve(reference).is_none() {
                return Err(format!(
                    "tool family {} references unknown schema {reference}",
                    family.name
                ));
            }
        }
    }
    Ok(schemas)
}

impl Schemas {
    fn resolve<'a>(&'a self, reference: &'a str) -> Option<&'a str> {
        if self.validators.contains_key(reference) {
            Some(reference)
        } else {
            self.aliases.get(reference).map(String::as_str)
        }
    }

    fn validator(&self, reference: &str) -> Result<&jsonschema::Validator, StockError> {
        let canonical = self
            .resolve(reference)
            .ok_or_else(|| StockError::UnknownSchema(reference.to_owned()))?;
        let slot = self
            .validators
            .get(canonical)
            .ok_or_else(|| StockError::setup(format!("missing embedded validator {canonical}")))?;
        slot.get_or_init(|| {
            let root = json!({ "$schema": DIALECT, "$ref": canonical });
            super::super::ensure_numbers_supported(&root).map_err(str::to_owned)?;
            jsonschema::options()
                .with_draft(jsonschema::Draft::Draft202012)
                .with_registry(&self.registry)
                // The wrapper has its own base so it cannot shadow the agent
                // resource whose definitions its absolute $ref selects.
                .with_base_uri(VALIDATOR_BASE)
                .offline()
                .should_validate_formats(true)
                .should_ignore_unknown_formats(false)
                .with_format("date", super::super::semantics::published_date_format)
                .with_format(
                    "date-time",
                    super::super::semantics::published_date_time_format,
                )
                .with_format("uri", super::super::semantics::published_uri_format)
                .build(&root)
                .map_err(|error| format!("{canonical}: {error}"))
        })
        .as_ref()
        .map_err(|error| StockError::setup(error.clone()))
    }
}

fn schemas() -> Result<&'static Schemas, StockError> {
    SCHEMAS
        .get_or_init(compile_resources)
        .as_ref()
        .map_err(|error| StockError::setup(error.clone()))
}

/// Prepare the embedded resource registry and resolve every catalog/family
/// schema pointer. No instance validation or runtime capability admission occurs.
pub fn initialize() -> Result<(), StockError> {
    schemas().map(|_| ())
}

/// Validate an immutable JSON value against a known embedded stock fragment or
/// resource identity. Numeric processing bounds are checked before validation.
pub fn validate(local_schema_ref: &str, value: &Value) -> Result<(), StockError> {
    super::super::ensure_numbers_supported(value)
        .map_err(|error| StockError::invalid(format!("unsupported numeric processing: {error}")))?;
    schemas()?
        .validator(local_schema_ref)?
        .validate(value)
        .map_err(|error| StockError::invalid(error.to_string()))
}

/// Shape validation of persisted witness or trusted qualification data only.
/// Successful validation does not establish source membership or freshness.
pub fn validate_presence(witness: bool, value: &Value) -> Result<(), StockError> {
    validate(
        if witness {
            WITNESS_URI
        } else {
            QUALIFICATION_URI
        },
        value,
    )
}

/// Compile every embedded definition and both presence schemas. Catalog and
/// family input/output references are included in these definitions.
pub fn compile_all() -> Result<SchemaCounts, StockError> {
    let schemas = schemas()?;
    for reference in schemas.validators.keys() {
        schemas.validator(reference)?;
    }
    let operations = catalog::operations()?;
    let families = catalog::families()?;
    Ok(SchemaCounts {
        agent_definitions: schemas.agent_definitions,
        atlas_definitions: schemas.atlas_definitions,
        operation_inputs: operations.len(),
        operation_outputs: operations.len(),
        family_inputs: families.len(),
        family_outputs: families.len(),
        presence_schemas: 2,
    })
}
