use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

/// Matches the published qualified HomeBox source key, without normalizing the
/// opaque, case-sensitive collection ID. Shared generated types can replace
/// these local seam types when AT51 publishes them.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntityRef {
    pub workspace_id: Uuid,
    pub home_id: Uuid,
    pub key: HomeBoxEntityKey,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HomeBoxEntityKey {
    pub source_instance_id: Uuid,
    pub collection_id: String,
    pub source_kind: HomeBoxSourceKind,
    pub external_id: Uuid,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum HomeBoxSourceKind {
    #[serde(rename = "homebox-entity")]
    Entity,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PartitionScope {
    pub workspace_id: Uuid,
    pub home_id: Uuid,
    pub source_instance_id: Uuid,
    pub collection_id: String,
}

impl EntityRef {
    pub fn partition(&self) -> PartitionScope {
        PartitionScope {
            workspace_id: self.workspace_id,
            home_id: self.home_id,
            source_instance_id: self.key.source_instance_id,
            collection_id: self.key.collection_id.clone(),
        }
    }

    fn validate(&self) -> Result<(), MappingError> {
        let length = self.key.collection_id.chars().count();
        if !(1..=4096).contains(&length) {
            return Err(MappingError::InvalidCollection);
        }
        Ok(())
    }
}

/// Narrow semantic inputs, not a complete stock provider command contract.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "field", content = "value", rename_all = "camelCase")]
pub enum EntityChange {
    Name(String),
    Archived(bool),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EntityField {
    Name,
    Archived,
}

impl EntityChange {
    pub fn field(&self) -> EntityField {
        match self {
            Self::Name(_) => EntityField::Name,
            Self::Archived(_) => EntityField::Archived,
        }
    }

    fn value(&self) -> Result<Value, MappingError> {
        match self {
            Self::Name(value) if (1..=4096).contains(&value.chars().count()) => {
                Ok(Value::String(value.clone()))
            }
            Self::Name(_) => Err(MappingError::InvalidName),
            Self::Archived(value) => Ok(Value::Bool(*value)),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriteCommand {
    pub operation_id: Uuid,
    pub target: EntityRef,
    pub change: EntityChange,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum WriteMethod {
    Post,
    Put,
    Patch,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CatalogQualification {
    SyntheticOnly,
    /// This label must come from the reviewed catalog owner, not a request.
    ReviewedWire3,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogIdentity {
    pub contract_version: String,
    pub provider_version: String,
    pub qualification: CatalogQualification,
}

/// No origin, headers, tenant, query or credential overrides are accepted.
/// The transport owns the source binding and bounded I/O policy.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StockRequest {
    pub scope: PartitionScope,
    pub method: WriteMethod,
    pub path: RelativePath,
    pub body: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadbackRequest {
    pub target: EntityRef,
    pub path: RelativePath,
    pub field: FieldName,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MappedWrite {
    pub catalog: CatalogIdentity,
    pub request: StockRequest,
    pub readback: ReadbackRequest,
    pub expected_value: Value,
}

/// The catalog owner must establish that this exact operation accepts a
/// single-field body. Full-object replacement routes must not be registered.
/// This is a trusted application input, never a browser-supplied capability.
#[derive(Clone, Debug)]
pub struct SingleFieldOperation {
    pub field: EntityField,
    pub method: WriteMethod,
    pub write_route: EntityRoute,
    pub body_field: FieldName,
    pub readback_route: EntityRoute,
    pub readback_field: FieldName,
}

#[derive(Clone, Debug)]
pub struct CatalogMapper {
    identity: CatalogIdentity,
    operations: Vec<SingleFieldOperation>,
}

impl CatalogMapper {
    pub fn identity(&self) -> &CatalogIdentity {
        &self.identity
    }

    /// An empty catalog is valid and enables no operations. No stock write
    /// route or payload is inferred from the published GET-only fixtures.
    pub fn new(
        identity: CatalogIdentity,
        operations: Vec<SingleFieldOperation>,
    ) -> Result<Self, MappingError> {
        if identity.contract_version.is_empty() || identity.provider_version.is_empty() {
            return Err(MappingError::MissingCatalogIdentity);
        }
        for (index, operation) in operations.iter().enumerate() {
            if operations[..index]
                .iter()
                .any(|other| other.field == operation.field)
            {
                return Err(MappingError::DuplicateOperation);
            }
        }
        Ok(Self {
            identity,
            operations,
        })
    }

    pub fn map(&self, command: &WriteCommand) -> Result<MappedWrite, MappingError> {
        command.target.validate()?;
        let expected_value = command.change.value()?;
        let operation = self
            .operations
            .iter()
            .find(|entry| entry.field == command.change.field())
            .ok_or(MappingError::MissingExactOperation)?;
        let body = json!({ operation.body_field.as_str(): expected_value });
        // This serializer is only a wire encoder. It is not RFC 8785 receipt
        // canonicalization and is never used to create an Atlas audit digest.
        let body = serde_json::to_vec(&body).map_err(|_| MappingError::Encoding)?;
        Ok(MappedWrite {
            catalog: self.identity.clone(),
            request: StockRequest {
                scope: command.target.partition(),
                method: operation.method,
                path: operation
                    .write_route
                    .resolve(command.target.key.external_id)?,
                body,
            },
            readback: ReadbackRequest {
                target: command.target.clone(),
                path: operation
                    .readback_route
                    .resolve(command.target.key.external_id)?,
                field: operation.readback_field.clone(),
            },
            expected_value,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MappingError {
    InvalidCollection,
    InvalidName,
    InvalidRoute,
    InvalidField,
    MissingCatalogIdentity,
    DuplicateOperation,
    MissingExactOperation,
    Encoding,
}

/// Conservative relative API paths: templates and queries are excluded after
/// resolution, including when loading persisted activity through serde.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct RelativePath(String);

impl RelativePath {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for RelativePath {
    type Error = &'static str;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        if valid_path(&value) {
            Ok(Self(value))
        } else {
            Err("invalid relative provider path")
        }
    }
}

impl From<RelativePath> for String {
    fn from(value: RelativePath) -> Self {
        value.0
    }
}

fn valid_path(value: &str) -> bool {
    value.starts_with("/api/v1/")
        && value.len() <= 4096
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-' | b'_'))
        && !value.contains("//")
        && !value.ends_with('/')
}

#[derive(Clone, Debug)]
pub struct EntityRoute(String);

impl EntityRoute {
    pub fn new(template: impl Into<String>) -> Result<Self, MappingError> {
        let template = template.into();
        if template.matches("{entityId}").count() != 1 {
            return Err(MappingError::InvalidRoute);
        }
        let example = template.replace("{entityId}", &Uuid::nil().to_string());
        if !valid_path(&example) || !template.split('/').any(|segment| segment == "{entityId}") {
            return Err(MappingError::InvalidRoute);
        }
        Ok(Self(template))
    }

    fn resolve(&self, entity_id: Uuid) -> Result<RelativePath, MappingError> {
        RelativePath::try_from(self.0.replace("{entityId}", &entity_id.to_string()))
            .map_err(|_| MappingError::InvalidRoute)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct FieldName(String);

impl FieldName {
    pub fn new(value: impl Into<String>) -> Result<Self, MappingError> {
        Self::try_from(value.into()).map_err(|_| MappingError::InvalidField)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for FieldName {
    type Error = &'static str;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        if !value.is_empty()
            && value.len() <= 128
            && value.bytes().all(|byte| byte.is_ascii_alphanumeric())
            && value.as_bytes()[0].is_ascii_alphabetic()
        {
            Ok(Self(value))
        } else {
            Err("invalid catalog field name")
        }
    }
}

impl From<FieldName> for String {
    fn from(value: FieldName) -> Self {
        value.0
    }
}
