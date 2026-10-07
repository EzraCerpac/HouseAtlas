//! Single UTF-8 query field, preserving opaque selector data exactly once.
use super::{HttpFailure, failure};
use axum::http::{StatusCode, Uri};

// SourceRef contains two bounded opaque strings. JSON may use six ASCII bytes
// per scalar for escaped controls; these bounds also cover its fixed fields.
pub(super) const SOURCE_JSON_BYTES: usize = 64 * 1024;
pub(super) const SOURCE_QUERY_BYTES: usize = 3 * SOURCE_JSON_BYTES + "source=".len();

pub(super) fn one_utf8(
    uri: &Uri,
    name: &str,
    maximum_query: usize,
    maximum_value: usize,
) -> Result<String, HttpFailure> {
    let invalid = || failure(StatusCode::UNPROCESSABLE_ENTITY);
    let query = uri.query().ok_or_else(invalid)?;
    if query.len() > maximum_query {
        return Err(failure(StatusCode::PAYLOAD_TOO_LARGE));
    }
    let (key, value) = query.split_once('=').ok_or_else(invalid)?;
    if key != name || query.contains('&') {
        return Err(invalid());
    }
    let bytes = value.as_bytes();
    for (index, byte) in bytes.iter().enumerate() {
        if *byte == b'%'
            && !bytes
                .get(index + 1..index + 3)
                .is_some_and(|pair| pair.iter().all(u8::is_ascii_hexdigit))
        {
            return Err(invalid());
        }
    }
    // A literal plus is form-query space; percent-encoded plus stays plus.
    let value = value.replace('+', " ");
    let value = percent_encoding::percent_decode_str(&value)
        .decode_utf8()
        .map_err(|_| invalid())?;
    if value.len() > maximum_value {
        return Err(failure(StatusCode::PAYLOAD_TOO_LARGE));
    }
    Ok(value.into_owned())
}
