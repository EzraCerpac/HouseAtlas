//! Endpoint bridges after the reader's bounded intake. No transport or fencing.
use super::decode::WireEntity;
use super::{ErrorCode, Limits, NativeNavigation, ReadError, SourceScope, Uuid};
use crate::providers::homebox::wire::{self, DecodeLimits, PageRequest, WireError};
use serde_json::Value;

fn read_error(error: WireError) -> ReadError {
    ReadError(match error {
        WireError::Invalid => ErrorCode::InvalidSchema,
        WireError::Limit => ErrorCode::SizeLimit,
        WireError::WrongEntity => ErrorCode::WrongScope,
        WireError::Pagination => ErrorCode::Pagination,
    })
}
fn decode_limits(limits: Limits) -> DecodeLimits {
    DecodeLimits {
        max_response_bytes: limits.max_response_bytes,
        max_entries: limits.max_pages * limits.max_page_size,
        max_text_chars: 16_384,
    }
}
pub(super) fn page(
    bytes: &[u8],
    page: u64,
    is_location: bool,
    parents: &[Uuid],
    limits: Limits,
) -> Result<Value, ReadError> {
    wire::decode_page(
        bytes,
        &PageRequest {
            page,
            page_size: limits.max_page_size as u64,
            is_location,
            parent_ids: parents.to_vec(),
        },
        decode_limits(limits),
    )
    .and_then(|decoded| decoded.reader_value())
    .map_err(read_error)
}
pub(super) fn detail(bytes: &[u8], id: &Uuid, limits: Limits) -> Result<Value, ReadError> {
    wire::decode_detail(bytes, id, decode_limits(limits))
        .and_then(|decoded| decoded.reader_value())
        .map_err(read_error)
}
pub(super) fn maintenance(bytes: &[u8], id: &Uuid, limits: Limits) -> Result<Value, ReadError> {
    wire::decode_maintenance(bytes, id, decode_limits(limits))
        .and_then(|decoded| decoded.reader_value())
        .map_err(read_error)
}

/// Independently qualified routes for each native entity type. Source-derived
/// route candidates alone cannot construct a verified navigation configuration.
#[derive(Clone, Debug, Default)]
pub struct StockNavigation {
    pub locations: Option<NativeNavigation>,
    pub items: Option<NativeNavigation>,
}
impl StockNavigation {
    pub(super) fn validate(&mut self, scope: &SourceScope) -> Result<(), ReadError> {
        for (is_location, navigation) in [(true, &mut self.locations), (false, &mut self.items)] {
            let Some(n) = navigation else { continue };
            n.validate(scope)?;
            if n.routes.iter().any(|route| {
                !matches!(
                    (is_location, route.intent, route.path.as_str()),
                    (true, super::NativeIntent::View, "/location/{entityId}")
                        | (true, super::NativeIntent::Edit, "/location/{entityId}/edit")
                        | (false, super::NativeIntent::View, "/item/{entityId}")
                        | (false, super::NativeIntent::Edit, "/item/{entityId}/edit")
                        | (
                            false,
                            super::NativeIntent::Maintenance,
                            "/item/{entityId}/maintenance"
                        )
                )
            }) {
                return Err(ReadError(ErrorCode::InvalidSchema));
            }
        }
        Ok(())
    }
    pub(super) fn for_entity(&self, row: &WireEntity) -> Option<&NativeNavigation> {
        match row.entity_type.as_ref()?.is_location {
            true => self.locations.as_ref(),
            false => self.items.as_ref(),
        }
    }
}
