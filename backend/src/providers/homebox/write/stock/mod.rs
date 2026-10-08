//! Stock.2 / wire3 native HomeBox mapping and injected invocation workflow.
//! Shared wire validation/digests, access, durable admission and HTTP remain peers.
mod entity;
mod evidence;
mod features;
mod fresh;
mod outcome;
mod ports;
mod quantity_activity;
mod quantity_bindings;
mod quantity_dispatch;
mod quantity_installation;
mod quantity_observation;
mod quantity_profile;
pub(crate) mod quantity_queue_original;
mod quantity_source;
pub use quantity_queue_original::{NativeQuantityKnownZeroAdmission, NativeQueuedQuantityOriginal};
mod resources;
mod types;
mod workflow;
pub use fresh::*;
pub use outcome::*;
pub use ports::*;
pub use quantity_activity::*;
pub use quantity_bindings::*;
pub use quantity_dispatch::*;
pub use quantity_installation::*;
pub use quantity_observation::*;
pub use quantity_profile::*;
pub use quantity_source::*;
pub use types::*;
pub use workflow::*;
#[cfg(test)]
mod fresh_healthy;
#[cfg(test)]
mod healthy_examples;
#[cfg(test)]
mod healthy_workflow;
#[cfg(test)]
mod quantity_healthy;
#[cfg(test)]
mod quantity_installation_healthy;

/// Complete supported write-family dispatch. No caller-supplied route or verb.
pub fn map_stock(
    command: &StockCommand,
    preparation: &Preparation,
) -> Result<NativePlan, StockMappingError> {
    for mapper in [entity::map, resources::map, features::map] {
        if let Some(mut plan) = mapper(command, preparation)? {
            for clear in &preparation.native_clear_values {
                if clear.command_id == command.command_id
                    && command.payload.get(&clear.field) == Some(&serde_json::Value::Null)
                    && let Some(expected) = plan
                        .readback
                        .expected
                        .as_object_mut()
                        .and_then(|v| v.get_mut(&clear.field))
                {
                    *expected = clear.native_readback_value.clone();
                }
            }
            return Ok(plan);
        }
    }
    Err(StockMappingError::UnsupportedOperation)
}

#[path = "../../recovery/stock_bridge.rs"]
pub(crate) mod retained_bridge;

#[cfg(test)]
mod quantity_flow_healthy;

mod quantity_evidence;
pub use quantity_evidence::*;
