//! Value bridge into the accepted reader's existing validation pipeline.
//! Maintenance date-only support must first be adopted by its schema/type owners.
use super::*;
use serde_json::Value;

fn merge_summary(raw: &mut Value, summary: &Summary) -> Result<(), WireError> {
    let fields = serde_json::to_value(summary).map_err(|_| WireError::Invalid)?;
    let object = raw.as_object_mut().ok_or(WireError::Invalid)?;
    for (key, value) in fields.as_object().ok_or(WireError::Invalid)? {
        if matches!(key.as_str(), "entityType" | "parent")
            && let Some(existing) = object.get_mut(key).and_then(Value::as_object_mut)
            && let Some(id) = value.get("id")
        {
            existing.insert("id".into(), id.clone());
            continue;
        }
        object.insert(key.clone(), value.clone());
    }
    Ok(())
}

impl Decoded<Page> {
    /// Preserves unknown source fields for the reader's repeated-row comparison.
    pub fn reader_value(&self) -> Result<Value, WireError> {
        let mut value = self.source.clone();
        let source_rows = value.get_mut("items").ok_or(WireError::Invalid)?;
        if source_rows.is_null() && self.value.items.is_empty() {
            *source_rows = Value::Array(Vec::new());
        }
        let rows = source_rows.as_array_mut().ok_or(WireError::Invalid)?;
        if rows.len() != self.value.items.len() {
            return Err(WireError::Invalid);
        }
        for (raw, summary) in rows.iter_mut().zip(&self.value.items) {
            merge_summary(raw, summary)?;
        }
        Ok(value)
    }
}

impl Decoded<Detail> {
    /// Renames native attachment metadata while keeping the stock detail extras.
    pub fn reader_value(&self) -> Result<Value, WireError> {
        let mut value = self.source.clone();
        merge_summary(&mut value, &self.value.summary)?;
        value.as_object_mut().ok_or(WireError::Invalid)?.insert(
            "attachments".into(),
            serde_json::to_value(&self.value.attachments).map_err(|_| WireError::Invalid)?,
        );
        Ok(value)
    }
}

impl Decoded<MaintenanceLog> {
    /// entryId + numeric cost + nullable original calendar dates. This value
    /// requires the additive date alternative; never add fabricated midnight.
    pub fn reader_value(&self) -> Result<Value, WireError> {
        serde_json::to_value(&self.value.entries).map_err(|_| WireError::Invalid)
    }
}
