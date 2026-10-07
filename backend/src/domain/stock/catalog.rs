//! Application routing adapter derived from stock.2 catalogue, not generated schemas.
//! Contract: 0.3.0-at34.stock.2 / wire3 / urn:houseatlas:agent:stock:3.
//! Catalogue SHA256: 55063c5d08f37c7c45f350b29b0aa60d788c34a4dfab154f6b6b69cb6f0ca6ad.
//! Feature-route SHA256: 17f192d5e5cc23e24852b6722bc5648151001d6a10e9be2667804bb898f2637e.

use serde::{Deserialize, Serialize};

pub const STOCK_VERSION: &str = "0.3.0-at34.stock.2";
pub const STOCK_SCHEMA_ID: &str = "urn:houseatlas:agent:stock:3";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Authority {
    Atlas,
    Homebox,
    Network,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Effect {
    Read,
    Write,
    Variant,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Disposition {
    AtlasOwned,
    Native,
    NativeContractRevision,
    MediatedHistory,
    NetworkPassive,
    Unsupported,
    Held,
    AppendOnlyForbidden,
    Feature,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OutputKind {
    AtlasRead,
    AtlasReceipt,
    HomeboxRead,
    History,
    Download,
    NetworkRead,
    StockOutcome,
    FeatureRead,
    LabelVariant,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Method {
    Get,
    Post,
    Put,
    Delete,
    Patch,
    PatchOrPut,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NativeRoute {
    pub method: Method,
    pub path: &'static str,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Operation {
    pub id: OperationId,
    pub authority: Authority,
    pub effect: Effect,
    pub resource_kind: &'static str,
    pub result_resource_kind: &'static str,
    pub permission: &'static str,
    pub family: &'static str,
    pub input_schema: &'static str,
    pub output_schema: &'static str,
    pub disposition: Disposition,
    pub output_kind: OutputKind,
    pub route: Option<NativeRoute>,
}

macro_rules! operations {
    ($( $variant:ident => ($id:literal, $authority:ident, $effect:ident, $kind:literal, $result:literal, $permission:literal, $family:literal, $input:literal, $output:literal, $disposition:ident, $output_kind:ident, $route:expr) ),+ $(,)?) => {
        #[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Deserialize, Serialize)]
        pub enum OperationId { $( #[serde(rename = $id)] $variant ),+ }
        impl OperationId {
            pub const fn as_str(self) -> &'static str { match self { $( Self::$variant => $id ),+ } }
            pub fn parse(id: &str) -> Option<Self> { match id { $( $id => Some(Self::$variant) ),+, _ => None } }
            pub fn operation(self) -> &'static Operation {
                OPERATIONS.iter().find(|op| op.id == self).expect("complete catalogue")
            }
        }
        pub static OPERATIONS: &[Operation] = &[$( Operation {
            id: OperationId::$variant, authority: Authority::$authority, effect: Effect::$effect,
            resource_kind: $kind, result_resource_kind: $result, permission: $permission,
            family: $family, input_schema: $input, output_schema: $output,
            disposition: Disposition::$disposition, output_kind: OutputKind::$output_kind,
            route: $route,
        } ),+];
    };
}

operations! {
    AtlasIdentityGet => ("atlas.identity.get", Atlas, Read, "identity", "identity", "domain:read", "atlas_records", "#/$defs/request_atlas_identity_get", "#/$defs/result_atlas_identity_get", AtlasOwned, AtlasRead, None),
    AtlasIdentityList => ("atlas.identity.list", Atlas, Read, "identity", "identity", "domain:read", "atlas_records", "#/$defs/request_atlas_identity_list", "#/$defs/result_atlas_identity_list", AtlasOwned, AtlasRead, None),
    AtlasIdentityHistory => ("atlas.identity.history", Atlas, Read, "identity", "identity", "domain:read", "atlas_records", "#/$defs/request_atlas_identity_history", "#/$defs/result_atlas_identity_history", AtlasOwned, History, None),
    AtlasIdentityCreate => ("atlas.identity.create", Atlas, Write, "identity", "identity", "atlas:write", "atlas_records", "#/$defs/request_atlas_identity_create", "#/$defs/result_atlas_identity_create", AtlasOwned, AtlasReceipt, None),
    AtlasIdentityReplace => ("atlas.identity.replace", Atlas, Write, "identity", "identity", "atlas:write", "atlas_records", "#/$defs/request_atlas_identity_replace", "#/$defs/result_atlas_identity_replace", AtlasOwned, AtlasReceipt, None),
    AtlasIdentityTombstone => ("atlas.identity.tombstone", Atlas, Write, "identity", "identity", "atlas:write", "atlas_records", "#/$defs/request_atlas_identity_tombstone", "#/$defs/result_atlas_identity_tombstone", AtlasOwned, AtlasReceipt, None),
    AtlasIdentityRestore => ("atlas.identity.restore", Atlas, Write, "identity", "identity", "atlas:write", "atlas_records", "#/$defs/request_atlas_identity_restore", "#/$defs/result_atlas_identity_restore", AtlasOwned, AtlasReceipt, None),
    AtlasBindingGet => ("atlas.binding.get", Atlas, Read, "binding", "binding", "domain:read", "atlas_bindings", "#/$defs/request_atlas_binding_get", "#/$defs/result_atlas_binding_get", AtlasOwned, AtlasRead, None),
    AtlasBindingList => ("atlas.binding.list", Atlas, Read, "binding", "binding", "domain:read", "atlas_bindings", "#/$defs/request_atlas_binding_list", "#/$defs/result_atlas_binding_list", AtlasOwned, AtlasRead, None),
    AtlasBindingHistory => ("atlas.binding.history", Atlas, Read, "binding", "binding", "domain:read", "atlas_bindings", "#/$defs/request_atlas_binding_history", "#/$defs/result_atlas_binding_history", AtlasOwned, History, None),
    AtlasBindingCreate => ("atlas.binding.create", Atlas, Write, "binding", "binding", "atlas:write", "atlas_bindings", "#/$defs/request_atlas_binding_create", "#/$defs/result_atlas_binding_create", AtlasOwned, AtlasReceipt, None),
    AtlasBindingReview => ("atlas.binding.review", Atlas, Write, "binding", "binding", "atlas:write", "atlas_bindings", "#/$defs/request_atlas_binding_review", "#/$defs/result_atlas_binding_review", AtlasOwned, AtlasReceipt, None),
    AtlasBindingTombstone => ("atlas.binding.tombstone", Atlas, Write, "binding", "binding", "atlas:write", "atlas_bindings", "#/$defs/request_atlas_binding_tombstone", "#/$defs/result_atlas_binding_tombstone", AtlasOwned, AtlasReceipt, None),
    AtlasBindingRestore => ("atlas.binding.restore", Atlas, Write, "binding", "binding", "atlas:write", "atlas_bindings", "#/$defs/request_atlas_binding_restore", "#/$defs/result_atlas_binding_restore", AtlasOwned, AtlasReceipt, None),
    AtlasEvidenceGet => ("atlas.evidence.get", Atlas, Read, "evidence", "evidence", "domain:read", "atlas_records", "#/$defs/request_atlas_evidence_get", "#/$defs/result_atlas_evidence_get", AtlasOwned, AtlasRead, None),
    AtlasEvidenceList => ("atlas.evidence.list", Atlas, Read, "evidence", "evidence", "domain:read", "atlas_records", "#/$defs/request_atlas_evidence_list", "#/$defs/result_atlas_evidence_list", AtlasOwned, AtlasRead, None),
    AtlasEvidenceHistory => ("atlas.evidence.history", Atlas, Read, "evidence", "evidence", "domain:read", "atlas_records", "#/$defs/request_atlas_evidence_history", "#/$defs/result_atlas_evidence_history", AtlasOwned, History, None),
    AtlasEvidenceCreate => ("atlas.evidence.create", Atlas, Write, "evidence", "evidence", "atlas:write", "atlas_records", "#/$defs/request_atlas_evidence_create", "#/$defs/result_atlas_evidence_create", AtlasOwned, AtlasReceipt, None),
    AtlasEvidenceTombstone => ("atlas.evidence.tombstone", Atlas, Write, "evidence", "evidence", "atlas:write", "atlas_records", "#/$defs/request_atlas_evidence_tombstone", "#/$defs/result_atlas_evidence_tombstone", AtlasOwned, AtlasReceipt, None),
    AtlasEvidenceRestore => ("atlas.evidence.restore", Atlas, Write, "evidence", "evidence", "atlas:write", "atlas_records", "#/$defs/request_atlas_evidence_restore", "#/$defs/result_atlas_evidence_restore", AtlasOwned, AtlasReceipt, None),
    AtlasLocationSemanticsGet => ("atlas.location-semantics.get", Atlas, Read, "location-semantics", "location-semantics", "domain:read", "atlas_records", "#/$defs/request_atlas_location_semantics_get", "#/$defs/result_atlas_location_semantics_get", AtlasOwned, AtlasRead, None),
    AtlasLocationSemanticsList => ("atlas.location-semantics.list", Atlas, Read, "location-semantics", "location-semantics", "domain:read", "atlas_records", "#/$defs/request_atlas_location_semantics_list", "#/$defs/result_atlas_location_semantics_list", AtlasOwned, AtlasRead, None),
    AtlasLocationSemanticsHistory => ("atlas.location-semantics.history", Atlas, Read, "location-semantics", "location-semantics", "domain:read", "atlas_records", "#/$defs/request_atlas_location_semantics_history", "#/$defs/result_atlas_location_semantics_history", AtlasOwned, History, None),
    AtlasLocationSemanticsCreate => ("atlas.location-semantics.create", Atlas, Write, "location-semantics", "location-semantics", "atlas:write", "atlas_records", "#/$defs/request_atlas_location_semantics_create", "#/$defs/result_atlas_location_semantics_create", AtlasOwned, AtlasReceipt, None),
    AtlasLocationSemanticsReplace => ("atlas.location-semantics.replace", Atlas, Write, "location-semantics", "location-semantics", "atlas:write", "atlas_records", "#/$defs/request_atlas_location_semantics_replace", "#/$defs/result_atlas_location_semantics_replace", AtlasOwned, AtlasReceipt, None),
    AtlasLocationSemanticsTombstone => ("atlas.location-semantics.tombstone", Atlas, Write, "location-semantics", "location-semantics", "atlas:write", "atlas_records", "#/$defs/request_atlas_location_semantics_tombstone", "#/$defs/result_atlas_location_semantics_tombstone", AtlasOwned, AtlasReceipt, None),
    AtlasLocationSemanticsRestore => ("atlas.location-semantics.restore", Atlas, Write, "location-semantics", "location-semantics", "atlas:write", "atlas_records", "#/$defs/request_atlas_location_semantics_restore", "#/$defs/result_atlas_location_semantics_restore", AtlasOwned, AtlasReceipt, None),
    AtlasCircuitGet => ("atlas.circuit.get", Atlas, Read, "circuit", "circuit", "domain:read", "atlas_records", "#/$defs/request_atlas_circuit_get", "#/$defs/result_atlas_circuit_get", AtlasOwned, AtlasRead, None),
    AtlasCircuitList => ("atlas.circuit.list", Atlas, Read, "circuit", "circuit", "domain:read", "atlas_records", "#/$defs/request_atlas_circuit_list", "#/$defs/result_atlas_circuit_list", AtlasOwned, AtlasRead, None),
    AtlasCircuitHistory => ("atlas.circuit.history", Atlas, Read, "circuit", "circuit", "domain:read", "atlas_records", "#/$defs/request_atlas_circuit_history", "#/$defs/result_atlas_circuit_history", AtlasOwned, History, None),
    AtlasCircuitCreate => ("atlas.circuit.create", Atlas, Write, "circuit", "circuit", "atlas:write", "atlas_records", "#/$defs/request_atlas_circuit_create", "#/$defs/result_atlas_circuit_create", AtlasOwned, AtlasReceipt, None),
    AtlasCircuitReplace => ("atlas.circuit.replace", Atlas, Write, "circuit", "circuit", "atlas:write", "atlas_records", "#/$defs/request_atlas_circuit_replace", "#/$defs/result_atlas_circuit_replace", AtlasOwned, AtlasReceipt, None),
    AtlasCircuitTombstone => ("atlas.circuit.tombstone", Atlas, Write, "circuit", "circuit", "atlas:write", "atlas_records", "#/$defs/request_atlas_circuit_tombstone", "#/$defs/result_atlas_circuit_tombstone", AtlasOwned, AtlasReceipt, None),
    AtlasCircuitRestore => ("atlas.circuit.restore", Atlas, Write, "circuit", "circuit", "atlas:write", "atlas_records", "#/$defs/request_atlas_circuit_restore", "#/$defs/result_atlas_circuit_restore", AtlasOwned, AtlasReceipt, None),
    AtlasValveGet => ("atlas.valve.get", Atlas, Read, "valve", "valve", "domain:read", "atlas_records", "#/$defs/request_atlas_valve_get", "#/$defs/result_atlas_valve_get", AtlasOwned, AtlasRead, None),
    AtlasValveList => ("atlas.valve.list", Atlas, Read, "valve", "valve", "domain:read", "atlas_records", "#/$defs/request_atlas_valve_list", "#/$defs/result_atlas_valve_list", AtlasOwned, AtlasRead, None),
    AtlasValveHistory => ("atlas.valve.history", Atlas, Read, "valve", "valve", "domain:read", "atlas_records", "#/$defs/request_atlas_valve_history", "#/$defs/result_atlas_valve_history", AtlasOwned, History, None),
    AtlasValveCreate => ("atlas.valve.create", Atlas, Write, "valve", "valve", "atlas:write", "atlas_records", "#/$defs/request_atlas_valve_create", "#/$defs/result_atlas_valve_create", AtlasOwned, AtlasReceipt, None),
    AtlasValveReplace => ("atlas.valve.replace", Atlas, Write, "valve", "valve", "atlas:write", "atlas_records", "#/$defs/request_atlas_valve_replace", "#/$defs/result_atlas_valve_replace", AtlasOwned, AtlasReceipt, None),
    AtlasValveTombstone => ("atlas.valve.tombstone", Atlas, Write, "valve", "valve", "atlas:write", "atlas_records", "#/$defs/request_atlas_valve_tombstone", "#/$defs/result_atlas_valve_tombstone", AtlasOwned, AtlasReceipt, None),
    AtlasValveRestore => ("atlas.valve.restore", Atlas, Write, "valve", "valve", "atlas:write", "atlas_records", "#/$defs/request_atlas_valve_restore", "#/$defs/result_atlas_valve_restore", AtlasOwned, AtlasReceipt, None),
    AtlasRelationGet => ("atlas.relation.get", Atlas, Read, "relation", "relation", "domain:read", "atlas_records", "#/$defs/request_atlas_relation_get", "#/$defs/result_atlas_relation_get", AtlasOwned, AtlasRead, None),
    AtlasRelationList => ("atlas.relation.list", Atlas, Read, "relation", "relation", "domain:read", "atlas_records", "#/$defs/request_atlas_relation_list", "#/$defs/result_atlas_relation_list", AtlasOwned, AtlasRead, None),
    AtlasRelationHistory => ("atlas.relation.history", Atlas, Read, "relation", "relation", "domain:read", "atlas_records", "#/$defs/request_atlas_relation_history", "#/$defs/result_atlas_relation_history", AtlasOwned, History, None),
    AtlasRelationCreate => ("atlas.relation.create", Atlas, Write, "relation", "relation", "atlas:write", "atlas_records", "#/$defs/request_atlas_relation_create", "#/$defs/result_atlas_relation_create", AtlasOwned, AtlasReceipt, None),
    AtlasRelationReplace => ("atlas.relation.replace", Atlas, Write, "relation", "relation", "atlas:write", "atlas_records", "#/$defs/request_atlas_relation_replace", "#/$defs/result_atlas_relation_replace", AtlasOwned, AtlasReceipt, None),
    AtlasRelationTombstone => ("atlas.relation.tombstone", Atlas, Write, "relation", "relation", "atlas:write", "atlas_records", "#/$defs/request_atlas_relation_tombstone", "#/$defs/result_atlas_relation_tombstone", AtlasOwned, AtlasReceipt, None),
    AtlasRelationRestore => ("atlas.relation.restore", Atlas, Write, "relation", "relation", "atlas:write", "atlas_records", "#/$defs/request_atlas_relation_restore", "#/$defs/result_atlas_relation_restore", AtlasOwned, AtlasReceipt, None),
    AtlasGeometryGet => ("atlas.geometry.get", Atlas, Read, "geometry", "geometry", "domain:read", "atlas_media_geometry", "#/$defs/request_atlas_geometry_get", "#/$defs/result_atlas_geometry_get", AtlasOwned, AtlasRead, None),
    AtlasGeometryList => ("atlas.geometry.list", Atlas, Read, "geometry", "geometry", "domain:read", "atlas_media_geometry", "#/$defs/request_atlas_geometry_list", "#/$defs/result_atlas_geometry_list", AtlasOwned, AtlasRead, None),
    AtlasGeometryHistory => ("atlas.geometry.history", Atlas, Read, "geometry", "geometry", "domain:read", "atlas_media_geometry", "#/$defs/request_atlas_geometry_history", "#/$defs/result_atlas_geometry_history", AtlasOwned, History, None),
    AtlasGeometryCreate => ("atlas.geometry.create", Atlas, Write, "geometry", "geometry", "atlas:write", "atlas_media_geometry", "#/$defs/request_atlas_geometry_create", "#/$defs/result_atlas_geometry_create", AtlasOwned, AtlasReceipt, None),
    AtlasGeometryTombstone => ("atlas.geometry.tombstone", Atlas, Write, "geometry", "geometry", "atlas:write", "atlas_media_geometry", "#/$defs/request_atlas_geometry_tombstone", "#/$defs/result_atlas_geometry_tombstone", AtlasOwned, AtlasReceipt, None),
    AtlasGeometryRestore => ("atlas.geometry.restore", Atlas, Write, "geometry", "geometry", "atlas:write", "atlas_media_geometry", "#/$defs/request_atlas_geometry_restore", "#/$defs/result_atlas_geometry_restore", AtlasOwned, AtlasReceipt, None),
    AtlasAssetGet => ("atlas.asset.get", Atlas, Read, "asset", "asset", "domain:read", "atlas_media_geometry", "#/$defs/request_atlas_asset_get", "#/$defs/result_atlas_asset_get", AtlasOwned, AtlasRead, None),
    AtlasAssetList => ("atlas.asset.list", Atlas, Read, "asset", "asset", "domain:read", "atlas_media_geometry", "#/$defs/request_atlas_asset_list", "#/$defs/result_atlas_asset_list", AtlasOwned, AtlasRead, None),
    AtlasAssetHistory => ("atlas.asset.history", Atlas, Read, "asset", "asset", "domain:read", "atlas_media_geometry", "#/$defs/request_atlas_asset_history", "#/$defs/result_atlas_asset_history", AtlasOwned, History, None),
    AtlasAssetCreate => ("atlas.asset.create", Atlas, Write, "asset", "asset", "atlas:write", "atlas_media_geometry", "#/$defs/request_atlas_asset_create", "#/$defs/result_atlas_asset_create", AtlasOwned, AtlasReceipt, None),
    AtlasAssetReview => ("atlas.asset.review", Atlas, Write, "asset", "asset", "atlas:media-policy:write", "atlas_media_geometry", "#/$defs/request_atlas_asset_review", "#/$defs/result_atlas_asset_review", AtlasOwned, AtlasReceipt, None),
    AtlasAssetTombstone => ("atlas.asset.tombstone", Atlas, Write, "asset", "asset", "atlas:write", "atlas_media_geometry", "#/$defs/request_atlas_asset_tombstone", "#/$defs/result_atlas_asset_tombstone", AtlasOwned, AtlasReceipt, None),
    AtlasAssetRestore => ("atlas.asset.restore", Atlas, Write, "asset", "asset", "atlas:write", "atlas_media_geometry", "#/$defs/request_atlas_asset_restore", "#/$defs/result_atlas_asset_restore", AtlasOwned, AtlasReceipt, None),
    AtlasReconciliationGet => ("atlas.reconciliation.get", Atlas, Read, "reconciliation", "reconciliation", "domain:read", "atlas_records", "#/$defs/request_atlas_reconciliation_get", "#/$defs/result_atlas_reconciliation_get", AtlasOwned, AtlasRead, None),
    AtlasReconciliationList => ("atlas.reconciliation.list", Atlas, Read, "reconciliation", "reconciliation", "domain:read", "atlas_records", "#/$defs/request_atlas_reconciliation_list", "#/$defs/result_atlas_reconciliation_list", AtlasOwned, AtlasRead, None),
    AtlasReconciliationHistory => ("atlas.reconciliation.history", Atlas, Read, "reconciliation", "reconciliation", "domain:read", "atlas_records", "#/$defs/request_atlas_reconciliation_history", "#/$defs/result_atlas_reconciliation_history", AtlasOwned, History, None),
    AtlasReconciliationCreate => ("atlas.reconciliation.create", Atlas, Write, "reconciliation", "reconciliation", "atlas:write", "atlas_records", "#/$defs/request_atlas_reconciliation_create", "#/$defs/result_atlas_reconciliation_create", AtlasOwned, AtlasReceipt, None),
    AtlasReconciliationTombstone => ("atlas.reconciliation.tombstone", Atlas, Write, "reconciliation", "reconciliation", "atlas:write", "atlas_records", "#/$defs/request_atlas_reconciliation_tombstone", "#/$defs/result_atlas_reconciliation_tombstone", AtlasOwned, AtlasReceipt, None),
    AtlasReconciliationRestore => ("atlas.reconciliation.restore", Atlas, Write, "reconciliation", "reconciliation", "atlas:write", "atlas_records", "#/$defs/request_atlas_reconciliation_restore", "#/$defs/result_atlas_reconciliation_restore", AtlasOwned, AtlasReceipt, None),
    AtlasBindingRemap => ("atlas.binding.remap", Atlas, Write, "binding", "binding", "atlas:write", "atlas_bindings", "#/$defs/request_atlas_binding_remap", "#/$defs/result_atlas_binding_remap", AtlasOwned, AtlasReceipt, None),
    AtlasAssetDownload => ("atlas.asset.download", Atlas, Read, "asset", "asset", "domain:read", "atlas_media_geometry", "#/$defs/request_atlas_asset_download", "#/$defs/result_atlas_asset_download", AtlasOwned, Download, None),
    HomeboxEntityGet => ("homebox.entity.get", Homebox, Read, "entity", "entity", "domain:read", "homebox_entities_locations", "#/$defs/request_homebox_entity_get", "#/$defs/result_homebox_entity_get", Native, HomeboxRead, Some(NativeRoute { method: Method::Get, path: "/api/v1/entities/{id}" })),
    HomeboxEntityList => ("homebox.entity.list", Homebox, Read, "entity", "entity", "domain:read", "homebox_entities_locations", "#/$defs/request_homebox_entity_list", "#/$defs/result_homebox_entity_list", Native, HomeboxRead, Some(NativeRoute { method: Method::Get, path: "/api/v1/entities" })),
    HomeboxEntityHistory => ("homebox.entity.history", Homebox, Read, "entity", "entity", "domain:read", "homebox_entities_locations", "#/$defs/request_homebox_entity_history", "#/$defs/result_homebox_entity_history", Unsupported, History, None),
    HomeboxEntityCreate => ("homebox.entity.create", Homebox, Write, "entity", "entity", "homebox:entity:write", "homebox_entities_locations", "#/$defs/request_homebox_entity_create", "#/$defs/result_homebox_entity_create", Native, StockOutcome, Some(NativeRoute { method: Method::Post, path: "/api/v1/entities" })),
    HomeboxEntityUpdate => ("homebox.entity.update", Homebox, Write, "entity", "entity", "homebox:entity:write", "homebox_entities_locations", "#/$defs/request_homebox_entity_update", "#/$defs/result_homebox_entity_update", Native, StockOutcome, Some(NativeRoute { method: Method::Put, path: "/api/v1/entities/{id}" })),
    HomeboxEntityArchive => ("homebox.entity.archive", Homebox, Write, "entity", "entity", "homebox:entity:write", "homebox_entities_locations", "#/$defs/request_homebox_entity_archive", "#/$defs/result_homebox_entity_archive", Native, StockOutcome, Some(NativeRoute { method: Method::Put, path: "/api/v1/entities/{id}" })),
    HomeboxEntityUnarchive => ("homebox.entity.unarchive", Homebox, Write, "entity", "entity", "homebox:entity:write", "homebox_entities_locations", "#/$defs/request_homebox_entity_unarchive", "#/$defs/result_homebox_entity_unarchive", Native, StockOutcome, Some(NativeRoute { method: Method::Put, path: "/api/v1/entities/{id}" })),
    HomeboxEntityReparent => ("homebox.entity.reparent", Homebox, Write, "entity", "entity", "homebox:entity:write", "homebox_entities_locations", "#/$defs/request_homebox_entity_reparent", "#/$defs/result_homebox_entity_reparent", Native, StockOutcome, Some(NativeRoute { method: Method::PatchOrPut, path: "/api/v1/entities/{id}" })),
    HomeboxEntityDelete => ("homebox.entity.delete", Homebox, Write, "entity", "entity", "homebox:entity:write", "homebox_entities_locations", "#/$defs/request_homebox_entity_delete", "#/$defs/result_homebox_entity_delete", Native, StockOutcome, Some(NativeRoute { method: Method::Delete, path: "/api/v1/entities/{id}" })),
    HomeboxEntityRestoreDeleted => ("homebox.entity.restore-deleted", Homebox, Write, "entity", "entity", "homebox:entity:write", "homebox_entities_locations", "#/$defs/request_homebox_entity_restore_deleted", "#/$defs/result_homebox_entity_restore_deleted", Unsupported, StockOutcome, None),
    HomeboxEntityDuplicate => ("homebox.entity.duplicate", Homebox, Write, "entity", "entity", "homebox:entity:write", "homebox_entities_locations", "#/$defs/request_homebox_entity_duplicate", "#/$defs/result_homebox_entity_duplicate", Native, StockOutcome, Some(NativeRoute { method: Method::Post, path: "/api/v1/entities/{id}/duplicate" })),
    HomeboxLocationGet => ("homebox.location.get", Homebox, Read, "entity", "entity", "domain:read", "homebox_entities_locations", "#/$defs/request_homebox_location_get", "#/$defs/result_homebox_location_get", Native, HomeboxRead, Some(NativeRoute { method: Method::Get, path: "/api/v1/entities/{id}" })),
    HomeboxLocationList => ("homebox.location.list", Homebox, Read, "entity", "entity", "domain:read", "homebox_entities_locations", "#/$defs/request_homebox_location_list", "#/$defs/result_homebox_location_list", Native, HomeboxRead, Some(NativeRoute { method: Method::Get, path: "/api/v1/entities" })),
    HomeboxLocationHistory => ("homebox.location.history", Homebox, Read, "entity", "entity", "domain:read", "homebox_entities_locations", "#/$defs/request_homebox_location_history", "#/$defs/result_homebox_location_history", Unsupported, History, None),
    HomeboxLocationCreate => ("homebox.location.create", Homebox, Write, "entity", "entity", "homebox:entity:write", "homebox_entities_locations", "#/$defs/request_homebox_location_create", "#/$defs/result_homebox_location_create", Native, StockOutcome, Some(NativeRoute { method: Method::Post, path: "/api/v1/entities" })),
    HomeboxLocationUpdate => ("homebox.location.update", Homebox, Write, "entity", "entity", "homebox:entity:write", "homebox_entities_locations", "#/$defs/request_homebox_location_update", "#/$defs/result_homebox_location_update", Native, StockOutcome, Some(NativeRoute { method: Method::Put, path: "/api/v1/entities/{id}" })),
    HomeboxLocationArchive => ("homebox.location.archive", Homebox, Write, "entity", "entity", "homebox:entity:write", "homebox_entities_locations", "#/$defs/request_homebox_location_archive", "#/$defs/result_homebox_location_archive", Native, StockOutcome, Some(NativeRoute { method: Method::Put, path: "/api/v1/entities/{id}" })),
    HomeboxLocationUnarchive => ("homebox.location.unarchive", Homebox, Write, "entity", "entity", "homebox:entity:write", "homebox_entities_locations", "#/$defs/request_homebox_location_unarchive", "#/$defs/result_homebox_location_unarchive", Native, StockOutcome, Some(NativeRoute { method: Method::Put, path: "/api/v1/entities/{id}" })),
    HomeboxLocationReparent => ("homebox.location.reparent", Homebox, Write, "entity", "entity", "homebox:entity:write", "homebox_entities_locations", "#/$defs/request_homebox_location_reparent", "#/$defs/result_homebox_location_reparent", Native, StockOutcome, Some(NativeRoute { method: Method::PatchOrPut, path: "/api/v1/entities/{id}" })),
    HomeboxLocationDelete => ("homebox.location.delete", Homebox, Write, "entity", "entity", "homebox:entity:write", "homebox_entities_locations", "#/$defs/request_homebox_location_delete", "#/$defs/result_homebox_location_delete", Native, StockOutcome, Some(NativeRoute { method: Method::Delete, path: "/api/v1/entities/{id}" })),
    HomeboxLocationRestoreDeleted => ("homebox.location.restore-deleted", Homebox, Write, "entity", "entity", "homebox:entity:write", "homebox_entities_locations", "#/$defs/request_homebox_location_restore_deleted", "#/$defs/result_homebox_location_restore_deleted", Unsupported, StockOutcome, None),
    HomeboxLocationDuplicate => ("homebox.location.duplicate", Homebox, Write, "entity", "entity", "homebox:entity:write", "homebox_entities_locations", "#/$defs/request_homebox_location_duplicate", "#/$defs/result_homebox_location_duplicate", Native, StockOutcome, Some(NativeRoute { method: Method::Post, path: "/api/v1/entities/{id}/duplicate" })),
    HomeboxEntityChildrenSync => ("homebox.entity.children.sync", Homebox, Write, "entity", "entity", "homebox:entity:write", "homebox_entities_locations", "#/$defs/request_homebox_entity_children_sync", "#/$defs/result_homebox_entity_children_sync", NativeContractRevision, StockOutcome, Some(NativeRoute { method: Method::Put, path: "/api/v1/entities/{id}" })),
    HomeboxEntityMediatedHistory => ("homebox.entity.mediated-history", Homebox, Read, "entity", "entity", "domain:read", "homebox_entities_locations", "#/$defs/request_homebox_entity_mediated_history", "#/$defs/result_homebox_entity_mediated_history", MediatedHistory, History, None),
    HomeboxLocationChildrenSync => ("homebox.location.children.sync", Homebox, Write, "entity", "entity", "homebox:entity:write", "homebox_entities_locations", "#/$defs/request_homebox_location_children_sync", "#/$defs/result_homebox_location_children_sync", NativeContractRevision, StockOutcome, Some(NativeRoute { method: Method::Put, path: "/api/v1/entities/{id}" })),
    HomeboxLocationMediatedHistory => ("homebox.location.mediated-history", Homebox, Read, "entity", "entity", "domain:read", "homebox_entities_locations", "#/$defs/request_homebox_location_mediated_history", "#/$defs/result_homebox_location_mediated_history", MediatedHistory, History, None),
    HomeboxEntityQuantitySet => ("homebox.entity.quantity.set", Homebox, Write, "entity", "entity", "homebox:entity:write", "homebox_entities_locations", "#/$defs/request_homebox_entity_quantity_set", "#/$defs/result_homebox_entity_quantity_set", Native, StockOutcome, Some(NativeRoute { method: Method::Patch, path: "/api/v1/entities/{id}" })),
    HomeboxEntityTypeSet => ("homebox.entity.type.set", Homebox, Write, "entity", "entity", "homebox:entity:write", "homebox_entities_locations", "#/$defs/request_homebox_entity_type_set", "#/$defs/result_homebox_entity_type_set", Native, StockOutcome, Some(NativeRoute { method: Method::Patch, path: "/api/v1/entities/{id}" })),
    HomeboxLocationTree => ("homebox.location.tree", Homebox, Read, "entity", "entity", "domain:read", "homebox_entities_locations", "#/$defs/request_homebox_location_tree", "#/$defs/result_homebox_location_tree", Native, HomeboxRead, Some(NativeRoute { method: Method::Get, path: "/api/v1/entities/tree" })),
    HomeboxEntityPath => ("homebox.entity.path", Homebox, Read, "entity", "entity", "domain:read", "homebox_entities_locations", "#/$defs/request_homebox_entity_path", "#/$defs/result_homebox_entity_path", Native, HomeboxRead, Some(NativeRoute { method: Method::Get, path: "/api/v1/entities/{id}/path" })),
    HomeboxTagList => ("homebox.tag.list", Homebox, Read, "tag", "tag", "domain:read", "homebox_tags_fields", "#/$defs/request_homebox_tag_list", "#/$defs/result_homebox_tag_list", Native, HomeboxRead, Some(NativeRoute { method: Method::Get, path: "/api/v1/tags" })),
    HomeboxTagGet => ("homebox.tag.get", Homebox, Read, "tag", "tag", "domain:read", "homebox_tags_fields", "#/$defs/request_homebox_tag_get", "#/$defs/result_homebox_tag_get", Native, HomeboxRead, Some(NativeRoute { method: Method::Get, path: "/api/v1/tags/{id}" })),
    HomeboxTagCreate => ("homebox.tag.create", Homebox, Write, "tag", "tag", "homebox:tag:write", "homebox_tags_fields", "#/$defs/request_homebox_tag_create", "#/$defs/result_homebox_tag_create", Native, StockOutcome, Some(NativeRoute { method: Method::Post, path: "/api/v1/tags" })),
    HomeboxTagUpdate => ("homebox.tag.update", Homebox, Write, "tag", "tag", "homebox:tag:write", "homebox_tags_fields", "#/$defs/request_homebox_tag_update", "#/$defs/result_homebox_tag_update", Native, StockOutcome, Some(NativeRoute { method: Method::Put, path: "/api/v1/tags/{id}" })),
    HomeboxTagDelete => ("homebox.tag.delete", Homebox, Write, "tag", "tag", "homebox:tag:write", "homebox_tags_fields", "#/$defs/request_homebox_tag_delete", "#/$defs/result_homebox_tag_delete", Native, StockOutcome, Some(NativeRoute { method: Method::Delete, path: "/api/v1/tags/{id}" })),
    HomeboxEntityTagsGet => ("homebox.entity.tags.get", Homebox, Read, "entity", "entity", "domain:read", "homebox_tags_fields", "#/$defs/request_homebox_entity_tags_get", "#/$defs/result_homebox_entity_tags_get", Native, HomeboxRead, Some(NativeRoute { method: Method::Get, path: "/api/v1/entities/{id}" })),
    HomeboxEntityTagsSet => ("homebox.entity.tags.set", Homebox, Write, "entity", "entity", "homebox:entity:write", "homebox_tags_fields", "#/$defs/request_homebox_entity_tags_set", "#/$defs/result_homebox_entity_tags_set", Native, StockOutcome, Some(NativeRoute { method: Method::Patch, path: "/api/v1/entities/{id}" })),
    HomeboxEntityTagsAdd => ("homebox.entity.tags.add", Homebox, Write, "entity", "entity", "homebox:entity:write", "homebox_tags_fields", "#/$defs/request_homebox_entity_tags_add", "#/$defs/result_homebox_entity_tags_add", Native, StockOutcome, Some(NativeRoute { method: Method::Patch, path: "/api/v1/entities/{id}" })),
    HomeboxEntityTagsRemove => ("homebox.entity.tags.remove", Homebox, Write, "entity", "entity", "homebox:entity:write", "homebox_tags_fields", "#/$defs/request_homebox_entity_tags_remove", "#/$defs/result_homebox_entity_tags_remove", Native, StockOutcome, Some(NativeRoute { method: Method::Patch, path: "/api/v1/entities/{id}" })),
    HomeboxFieldList => ("homebox.field.list", Homebox, Read, "field", "field", "domain:read", "homebox_tags_fields", "#/$defs/request_homebox_field_list", "#/$defs/result_homebox_field_list", Native, HomeboxRead, Some(NativeRoute { method: Method::Get, path: "/api/v1/entities/{id}" })),
    HomeboxFieldGet => ("homebox.field.get", Homebox, Read, "field", "field", "domain:read", "homebox_tags_fields", "#/$defs/request_homebox_field_get", "#/$defs/result_homebox_field_get", Native, HomeboxRead, Some(NativeRoute { method: Method::Get, path: "/api/v1/entities/{id}" })),
    HomeboxFieldCreate => ("homebox.field.create", Homebox, Write, "field", "field", "homebox:field:write", "homebox_tags_fields", "#/$defs/request_homebox_field_create", "#/$defs/result_homebox_field_create", Native, StockOutcome, Some(NativeRoute { method: Method::Put, path: "/api/v1/entities/{id}" })),
    HomeboxFieldUpdate => ("homebox.field.update", Homebox, Write, "field", "field", "homebox:field:write", "homebox_tags_fields", "#/$defs/request_homebox_field_update", "#/$defs/result_homebox_field_update", Native, StockOutcome, Some(NativeRoute { method: Method::Put, path: "/api/v1/entities/{id}" })),
    HomeboxFieldDelete => ("homebox.field.delete", Homebox, Write, "field", "field", "homebox:field:write", "homebox_tags_fields", "#/$defs/request_homebox_field_delete", "#/$defs/result_homebox_field_delete", Native, StockOutcome, Some(NativeRoute { method: Method::Put, path: "/api/v1/entities/{id}" })),
    HomeboxEntityFieldNames => ("homebox.entity.field-names", Homebox, Read, "entity", "entity", "domain:read", "homebox_tags_fields", "#/$defs/request_homebox_entity_field_names", "#/$defs/result_homebox_entity_field_names", Native, HomeboxRead, Some(NativeRoute { method: Method::Get, path: "/api/v1/entities/fields" })),
    HomeboxEntityFieldValues => ("homebox.entity.field-values", Homebox, Read, "entity", "entity", "domain:read", "homebox_tags_fields", "#/$defs/request_homebox_entity_field_values", "#/$defs/result_homebox_entity_field_values", Native, HomeboxRead, Some(NativeRoute { method: Method::Get, path: "/api/v1/entities/fields/values" })),
    HomeboxFileList => ("homebox.file.list", Homebox, Read, "attachment", "attachment", "domain:read", "homebox_files_links", "#/$defs/request_homebox_file_list", "#/$defs/result_homebox_file_list", Native, HomeboxRead, Some(NativeRoute { method: Method::Get, path: "/api/v1/entities/{id}" })),
    HomeboxFileGet => ("homebox.file.get", Homebox, Read, "attachment", "attachment", "domain:read", "homebox_files_links", "#/$defs/request_homebox_file_get", "#/$defs/result_homebox_file_get", Native, HomeboxRead, Some(NativeRoute { method: Method::Get, path: "/api/v1/entities/{id}" })),
    HomeboxFileUpload => ("homebox.file.upload", Homebox, Write, "attachment", "attachment", "homebox:attachment:write", "homebox_files_links", "#/$defs/request_homebox_file_upload", "#/$defs/result_homebox_file_upload", Native, StockOutcome, Some(NativeRoute { method: Method::Post, path: "/api/v1/entities/{id}/attachments" })),
    HomeboxFileUpdate => ("homebox.file.update", Homebox, Write, "attachment", "attachment", "homebox:attachment:write", "homebox_files_links", "#/$defs/request_homebox_file_update", "#/$defs/result_homebox_file_update", Native, StockOutcome, Some(NativeRoute { method: Method::Put, path: "/api/v1/entities/{id}/attachments/{attachment_id}" })),
    HomeboxFileDownload => ("homebox.file.download", Homebox, Read, "attachment", "attachment", "domain:read", "homebox_files_links", "#/$defs/request_homebox_file_download", "#/$defs/result_homebox_file_download", Native, Download, Some(NativeRoute { method: Method::Get, path: "/api/v1/entities/{id}/attachments/{attachment_id}" })),
    HomeboxFileDelete => ("homebox.file.delete", Homebox, Write, "attachment", "attachment", "homebox:attachment:write", "homebox_files_links", "#/$defs/request_homebox_file_delete", "#/$defs/result_homebox_file_delete", Native, StockOutcome, Some(NativeRoute { method: Method::Delete, path: "/api/v1/entities/{id}/attachments/{attachment_id}" })),
    HomeboxFileReplaceBytes => ("homebox.file.replace-bytes", Homebox, Write, "attachment", "attachment", "homebox:attachment:write", "homebox_files_links", "#/$defs/request_homebox_file_replace_bytes", "#/$defs/result_homebox_file_replace_bytes", Unsupported, StockOutcome, None),
    HomeboxFileRestoreDeleted => ("homebox.file.restore-deleted", Homebox, Write, "attachment", "attachment", "homebox:attachment:write", "homebox_files_links", "#/$defs/request_homebox_file_restore_deleted", "#/$defs/result_homebox_file_restore_deleted", Unsupported, StockOutcome, None),
    HomeboxDocumentLinkList => ("homebox.document-link.list", Homebox, Read, "attachment", "attachment", "domain:read", "homebox_files_links", "#/$defs/request_homebox_document_link_list", "#/$defs/result_homebox_document_link_list", Native, HomeboxRead, Some(NativeRoute { method: Method::Get, path: "/api/v1/entities/{id}" })),
    HomeboxDocumentLinkGet => ("homebox.document-link.get", Homebox, Read, "attachment", "attachment", "domain:read", "homebox_files_links", "#/$defs/request_homebox_document_link_get", "#/$defs/result_homebox_document_link_get", Native, HomeboxRead, Some(NativeRoute { method: Method::Get, path: "/api/v1/entities/{id}" })),
    HomeboxDocumentLinkCreate => ("homebox.document-link.create", Homebox, Write, "attachment", "attachment", "homebox:attachment:write", "homebox_files_links", "#/$defs/request_homebox_document_link_create", "#/$defs/result_homebox_document_link_create", Native, StockOutcome, Some(NativeRoute { method: Method::Post, path: "/api/v1/entities/{id}/attachments/external" })),
    HomeboxDocumentLinkUpdate => ("homebox.document-link.update", Homebox, Write, "attachment", "attachment", "homebox:attachment:write", "homebox_files_links", "#/$defs/request_homebox_document_link_update", "#/$defs/result_homebox_document_link_update", Native, StockOutcome, Some(NativeRoute { method: Method::Put, path: "/api/v1/entities/{id}/attachments/{attachment_id}" })),
    HomeboxDocumentLinkDelete => ("homebox.document-link.delete", Homebox, Write, "attachment", "attachment", "homebox:attachment:write", "homebox_files_links", "#/$defs/request_homebox_document_link_delete", "#/$defs/result_homebox_document_link_delete", Native, StockOutcome, Some(NativeRoute { method: Method::Delete, path: "/api/v1/entities/{id}/attachments/{attachment_id}" })),
    HomeboxDocumentLinkRetarget => ("homebox.document-link.retarget", Homebox, Write, "attachment", "attachment", "homebox:attachment:write", "homebox_files_links", "#/$defs/request_homebox_document_link_retarget", "#/$defs/result_homebox_document_link_retarget", Unsupported, StockOutcome, None),
    HomeboxMaintenanceList => ("homebox.maintenance.list", Homebox, Read, "maintenance", "maintenance", "domain:read", "homebox_maintenance", "#/$defs/request_homebox_maintenance_list", "#/$defs/result_homebox_maintenance_list", Native, HomeboxRead, Some(NativeRoute { method: Method::Get, path: "/api/v1/entities/{id}/maintenance" })),
    HomeboxMaintenanceGet => ("homebox.maintenance.get", Homebox, Read, "maintenance", "maintenance", "domain:read", "homebox_maintenance", "#/$defs/request_homebox_maintenance_get", "#/$defs/result_homebox_maintenance_get", Native, HomeboxRead, Some(NativeRoute { method: Method::Get, path: "/api/v1/entities/{id}/maintenance" })),
    HomeboxMaintenanceCreate => ("homebox.maintenance.create", Homebox, Write, "maintenance", "maintenance", "homebox:maintenance:write", "homebox_maintenance", "#/$defs/request_homebox_maintenance_create", "#/$defs/result_homebox_maintenance_create", Native, StockOutcome, Some(NativeRoute { method: Method::Post, path: "/api/v1/entities/{id}/maintenance" })),
    HomeboxMaintenanceUpdate => ("homebox.maintenance.update", Homebox, Write, "maintenance", "maintenance", "homebox:maintenance:write", "homebox_maintenance", "#/$defs/request_homebox_maintenance_update", "#/$defs/result_homebox_maintenance_update", Native, StockOutcome, Some(NativeRoute { method: Method::Put, path: "/api/v1/maintenance/{id}" })),
    HomeboxMaintenanceSchedule => ("homebox.maintenance.schedule", Homebox, Write, "maintenance", "maintenance", "homebox:maintenance:write", "homebox_maintenance", "#/$defs/request_homebox_maintenance_schedule", "#/$defs/result_homebox_maintenance_schedule", Native, StockOutcome, Some(NativeRoute { method: Method::Put, path: "/api/v1/maintenance/{id}" })),
    HomeboxMaintenanceComplete => ("homebox.maintenance.complete", Homebox, Write, "maintenance", "maintenance", "homebox:maintenance:write", "homebox_maintenance", "#/$defs/request_homebox_maintenance_complete", "#/$defs/result_homebox_maintenance_complete", Native, StockOutcome, Some(NativeRoute { method: Method::Put, path: "/api/v1/maintenance/{id}" })),
    HomeboxMaintenanceReopen => ("homebox.maintenance.reopen", Homebox, Write, "maintenance", "maintenance", "homebox:maintenance:write", "homebox_maintenance", "#/$defs/request_homebox_maintenance_reopen", "#/$defs/result_homebox_maintenance_reopen", Native, StockOutcome, Some(NativeRoute { method: Method::Put, path: "/api/v1/maintenance/{id}" })),
    HomeboxMaintenanceDelete => ("homebox.maintenance.delete", Homebox, Write, "maintenance", "maintenance", "homebox:maintenance:write", "homebox_maintenance", "#/$defs/request_homebox_maintenance_delete", "#/$defs/result_homebox_maintenance_delete", Native, StockOutcome, Some(NativeRoute { method: Method::Delete, path: "/api/v1/maintenance/{id}" })),
    HomeboxMaintenanceAttachmentUpload => ("homebox.maintenance.attachment-upload", Homebox, Write, "maintenance", "maintenance", "homebox:maintenance:write", "homebox_maintenance", "#/$defs/request_homebox_maintenance_attachment_upload", "#/$defs/result_homebox_maintenance_attachment_upload", Unsupported, StockOutcome, None),
    HomeboxMaintenanceAttachmentDelete => ("homebox.maintenance.attachment-delete", Homebox, Write, "maintenance", "maintenance", "homebox:maintenance:write", "homebox_maintenance", "#/$defs/request_homebox_maintenance_attachment_delete", "#/$defs/result_homebox_maintenance_attachment_delete", Unsupported, StockOutcome, None),
    HomeboxEntityTypeList => ("homebox.entity-type.list", Homebox, Read, "entity-type", "entity-type", "domain:read", "homebox_templates_types", "#/$defs/request_homebox_entity_type_list", "#/$defs/result_homebox_entity_type_list", Native, HomeboxRead, Some(NativeRoute { method: Method::Get, path: "/api/v1/entity-types" })),
    HomeboxEntityTypeCreate => ("homebox.entity-type.create", Homebox, Write, "entity-type", "entity-type", "homebox:entity-type:write", "homebox_templates_types", "#/$defs/request_homebox_entity_type_create", "#/$defs/result_homebox_entity_type_create", Native, StockOutcome, Some(NativeRoute { method: Method::Post, path: "/api/v1/entity-types" })),
    HomeboxEntityTypeUpdate => ("homebox.entity-type.update", Homebox, Write, "entity-type", "entity-type", "homebox:entity-type:write", "homebox_templates_types", "#/$defs/request_homebox_entity_type_update", "#/$defs/result_homebox_entity_type_update", Native, StockOutcome, Some(NativeRoute { method: Method::Put, path: "/api/v1/entity-types/{id}" })),
    HomeboxEntityTypeDelete => ("homebox.entity-type.delete", Homebox, Write, "entity-type", "entity-type", "homebox:entity-type:write", "homebox_templates_types", "#/$defs/request_homebox_entity_type_delete", "#/$defs/result_homebox_entity_type_delete", Native, StockOutcome, Some(NativeRoute { method: Method::Delete, path: "/api/v1/entity-types/{id}" })),
    HomeboxTemplateList => ("homebox.template.list", Homebox, Read, "template", "template", "domain:read", "homebox_templates_types", "#/$defs/request_homebox_template_list", "#/$defs/result_homebox_template_list", Native, HomeboxRead, Some(NativeRoute { method: Method::Get, path: "/api/v1/templates" })),
    HomeboxTemplateGet => ("homebox.template.get", Homebox, Read, "template", "template", "domain:read", "homebox_templates_types", "#/$defs/request_homebox_template_get", "#/$defs/result_homebox_template_get", Native, HomeboxRead, Some(NativeRoute { method: Method::Get, path: "/api/v1/templates/{id}" })),
    HomeboxTemplateCreate => ("homebox.template.create", Homebox, Write, "template", "template", "homebox:template:write", "homebox_templates_types", "#/$defs/request_homebox_template_create", "#/$defs/result_homebox_template_create", Native, StockOutcome, Some(NativeRoute { method: Method::Post, path: "/api/v1/templates" })),
    HomeboxTemplateUpdate => ("homebox.template.update", Homebox, Write, "template", "template", "homebox:template:write", "homebox_templates_types", "#/$defs/request_homebox_template_update", "#/$defs/result_homebox_template_update", Native, StockOutcome, Some(NativeRoute { method: Method::Put, path: "/api/v1/templates/{id}" })),
    HomeboxTemplateDelete => ("homebox.template.delete", Homebox, Write, "template", "template", "homebox:template:write", "homebox_templates_types", "#/$defs/request_homebox_template_delete", "#/$defs/result_homebox_template_delete", Native, StockOutcome, Some(NativeRoute { method: Method::Delete, path: "/api/v1/templates/{id}" })),
    HomeboxTemplateCreateItem => ("homebox.template.create-item", Homebox, Write, "template", "entity", "homebox:template:write", "homebox_templates_types", "#/$defs/request_homebox_template_create_item", "#/$defs/result_homebox_template_create_item", Native, StockOutcome, Some(NativeRoute { method: Method::Post, path: "/api/v1/templates/{id}/create-item" })),
    AtlasBindingReassignIdentity => ("atlas.binding.reassign-identity", Atlas, Write, "binding", "binding", "atlas:write", "atlas_bindings", "#/$defs/request_atlas_binding_reassign_identity", "#/$defs/result_atlas_binding_reassign_identity", Held, AtlasReceipt, None),
    AtlasAssetHardPurge => ("atlas.asset.hard-purge", Atlas, Write, "asset", "asset", "atlas:write", "atlas_media_geometry", "#/$defs/request_atlas_asset_hard_purge", "#/$defs/result_atlas_asset_hard_purge", Held, AtlasReceipt, None),
    AtlasEvidenceReplace => ("atlas.evidence.replace", Atlas, Write, "evidence", "evidence", "atlas:write", "atlas_records", "#/$defs/request_atlas_evidence_replace", "#/$defs/result_atlas_evidence_replace", AppendOnlyForbidden, AtlasReceipt, None),
    AtlasGeometryReplace => ("atlas.geometry.replace", Atlas, Write, "geometry", "geometry", "atlas:write", "atlas_media_geometry", "#/$defs/request_atlas_geometry_replace", "#/$defs/result_atlas_geometry_replace", AppendOnlyForbidden, AtlasReceipt, None),
    AtlasReconciliationReplace => ("atlas.reconciliation.replace", Atlas, Write, "reconciliation", "reconciliation", "atlas:write", "atlas_records", "#/$defs/request_atlas_reconciliation_replace", "#/$defs/result_atlas_reconciliation_replace", AppendOnlyForbidden, AtlasReceipt, None),
    NetworkInventoryGet => ("network.inventory.get", Network, Read, "network", "network", "domain:read", "network_queries", "#/$defs/request_network_inventory_get", "#/$defs/result_network_inventory_get", NetworkPassive, NetworkRead, None),
    NetworkSnapshotGet => ("network.snapshot.get", Network, Read, "network", "network", "domain:read", "network_queries", "#/$defs/request_network_snapshot_get", "#/$defs/result_network_snapshot_get", NetworkPassive, NetworkRead, None),
    NetworkHistoryGet => ("network.history.get", Network, Read, "network", "network", "domain:read", "network_queries", "#/$defs/request_network_history_get", "#/$defs/result_network_history_get", NetworkPassive, NetworkRead, None),
    AtlasBatchExecute => ("atlas.batch.execute", Atlas, Write, "batch", "batch", "atlas:write", "atlas_records", "#/$defs/request_atlas_batch_execute", "#/$defs/result_atlas_batch_execute", AtlasOwned, AtlasReceipt, None),
    HomeboxBulkExecute => ("homebox.bulk.execute", Homebox, Write, "collection", "collection", "homebox:collection:write", "homebox_product_features", "#/$defs/request_homebox_bulk_execute", "#/$defs/stockOutcome", Feature, StockOutcome, None),
    HomeboxImportCsv => ("homebox.import.csv", Homebox, Write, "collection", "collection", "homebox:collection:write", "homebox_product_features", "#/$defs/request_homebox_import_csv", "#/$defs/stockOutcome", Feature, StockOutcome, None),
    HomeboxExportCreate => ("homebox.export.create", Homebox, Read, "collection", "collection", "homebox:collection:read", "homebox_product_features", "#/$defs/request_homebox_export_create", "#/$defs/featureRead", Feature, FeatureRead, None),
    HomeboxQueryRead => ("homebox.query.read", Homebox, Read, "collection", "collection", "homebox:collection:read", "homebox_product_features", "#/$defs/request_homebox_query_read", "#/$defs/featureRead", Feature, FeatureRead, None),
    HomeboxLabelOutput => ("homebox.label.output", Homebox, Variant, "collection", "collection", "domain:read", "homebox_product_features", "#/$defs/request_homebox_label_output", "#/$defs/labelOutput", Feature, LabelVariant, None),
    HomeboxQrcodeRender => ("homebox.qrcode.render", Homebox, Read, "collection", "collection", "domain:read", "homebox_product_features", "#/$defs/request_homebox_qrcode_render", "#/$defs/featureRead", Feature, FeatureRead, None),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FeatureScope {
    Collection,
    ResourceSet,
    Source,
    ExternalLookup,
    ResolvedResourceSet,
    BoundedContent,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FeatureRoute {
    pub id: OperationId,
    pub variant: &'static str,
    pub native: NativeRoute,
    pub scope: FeatureScope,
}

pub static FEATURE_ROUTES: &[FeatureRoute] = &[
    FeatureRoute {
        id: OperationId::HomeboxBulkExecute,
        variant: "create-missing-thumbnails",
        native: NativeRoute {
            method: Method::Post,
            path: "/api/v1/actions/create-missing-thumbnails",
        },
        scope: FeatureScope::Collection,
    },
    FeatureRoute {
        id: OperationId::HomeboxBulkExecute,
        variant: "ensure-asset-ids",
        native: NativeRoute {
            method: Method::Post,
            path: "/api/v1/actions/ensure-asset-ids",
        },
        scope: FeatureScope::Collection,
    },
    FeatureRoute {
        id: OperationId::HomeboxBulkExecute,
        variant: "ensure-import-refs",
        native: NativeRoute {
            method: Method::Post,
            path: "/api/v1/actions/ensure-import-refs",
        },
        scope: FeatureScope::Collection,
    },
    FeatureRoute {
        id: OperationId::HomeboxBulkExecute,
        variant: "set-primary-photos",
        native: NativeRoute {
            method: Method::Post,
            path: "/api/v1/actions/set-primary-photos",
        },
        scope: FeatureScope::Collection,
    },
    FeatureRoute {
        id: OperationId::HomeboxBulkExecute,
        variant: "wipe-inventory",
        native: NativeRoute {
            method: Method::Post,
            path: "/api/v1/actions/wipe-inventory",
        },
        scope: FeatureScope::Collection,
    },
    FeatureRoute {
        id: OperationId::HomeboxBulkExecute,
        variant: "zero-item-time-fields",
        native: NativeRoute {
            method: Method::Post,
            path: "/api/v1/actions/zero-item-time-fields",
        },
        scope: FeatureScope::Collection,
    },
    FeatureRoute {
        id: OperationId::HomeboxImportCsv,
        variant: "csv",
        native: NativeRoute {
            method: Method::Post,
            path: "/api/v1/entities/import",
        },
        scope: FeatureScope::Collection,
    },
    FeatureRoute {
        id: OperationId::HomeboxExportCreate,
        variant: "inventory-csv",
        native: NativeRoute {
            method: Method::Get,
            path: "/api/v1/entities/export",
        },
        scope: FeatureScope::Collection,
    },
    FeatureRoute {
        id: OperationId::HomeboxExportCreate,
        variant: "bill-of-materials-csv",
        native: NativeRoute {
            method: Method::Get,
            path: "/api/v1/reporting/bill-of-materials",
        },
        scope: FeatureScope::Collection,
    },
    FeatureRoute {
        id: OperationId::HomeboxQueryRead,
        variant: "asset-lookup",
        native: NativeRoute {
            method: Method::Get,
            path: "/api/v1/assets/{id}",
        },
        scope: FeatureScope::ResourceSet,
    },
    FeatureRoute {
        id: OperationId::HomeboxQueryRead,
        variant: "currency",
        native: NativeRoute {
            method: Method::Get,
            path: "/api/v1/currency",
        },
        scope: FeatureScope::Source,
    },
    FeatureRoute {
        id: OperationId::HomeboxQueryRead,
        variant: "statistics",
        native: NativeRoute {
            method: Method::Get,
            path: "/api/v1/groups/statistics",
        },
        scope: FeatureScope::Collection,
    },
    FeatureRoute {
        id: OperationId::HomeboxQueryRead,
        variant: "statistics-locations",
        native: NativeRoute {
            method: Method::Get,
            path: "/api/v1/groups/statistics/locations",
        },
        scope: FeatureScope::Collection,
    },
    FeatureRoute {
        id: OperationId::HomeboxQueryRead,
        variant: "statistics-purchase-price",
        native: NativeRoute {
            method: Method::Get,
            path: "/api/v1/groups/statistics/purchase-price",
        },
        scope: FeatureScope::Collection,
    },
    FeatureRoute {
        id: OperationId::HomeboxQueryRead,
        variant: "statistics-tags",
        native: NativeRoute {
            method: Method::Get,
            path: "/api/v1/groups/statistics/tags",
        },
        scope: FeatureScope::Collection,
    },
    FeatureRoute {
        id: OperationId::HomeboxQueryRead,
        variant: "maintenance",
        native: NativeRoute {
            method: Method::Get,
            path: "/api/v1/maintenance",
        },
        scope: FeatureScope::Collection,
    },
    FeatureRoute {
        id: OperationId::HomeboxQueryRead,
        variant: "barcode-product",
        native: NativeRoute {
            method: Method::Get,
            path: "/api/v1/products/search-from-barcode",
        },
        scope: FeatureScope::ExternalLookup,
    },
    FeatureRoute {
        id: OperationId::HomeboxLabelOutput,
        variant: "asset",
        native: NativeRoute {
            method: Method::Get,
            path: "/api/v1/labelmaker/asset/{id}",
        },
        scope: FeatureScope::ResolvedResourceSet,
    },
    FeatureRoute {
        id: OperationId::HomeboxLabelOutput,
        variant: "item",
        native: NativeRoute {
            method: Method::Get,
            path: "/api/v1/labelmaker/item/{id}",
        },
        scope: FeatureScope::ResolvedResourceSet,
    },
    FeatureRoute {
        id: OperationId::HomeboxLabelOutput,
        variant: "location",
        native: NativeRoute {
            method: Method::Get,
            path: "/api/v1/labelmaker/location/{id}",
        },
        scope: FeatureScope::ResolvedResourceSet,
    },
    FeatureRoute {
        id: OperationId::HomeboxQrcodeRender,
        variant: "bounded-content",
        native: NativeRoute {
            method: Method::Get,
            path: "/api/v1/qrcode",
        },
        scope: FeatureScope::BoundedContent,
    },
];
