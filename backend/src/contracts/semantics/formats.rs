//! Published Ajv-formats 3.0.1 full URI admissibility.
//!
//! The URI expression is copied from ajv-formats 3.0.1 src/formats.ts, lines
//! 228-234; copyright 2020 Evgeny Poberezkin, MIT. The complete license is
//! retained in licenses/ajv-formats-MIT.txt. Date-time format compatibility is
//! implemented in timestamps.rs. These predicates do not rewrite wire strings.

use std::sync::OnceLock;

use regex::{Regex, RegexBuilder};

// Preserve the source grammar, including its decimal-octet spelling rules and
// empty authority/port cases. This is a schema format, not URL route approval.
const URI_PATTERN: &str = r"^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$";

static URI: OnceLock<Regex> = OnceLock::new();

pub(in crate::contracts) fn published_uri_format(value: &str) -> bool {
    // Source NOT_URI_FRAGMENT is /\/|:/, without flags or state.
    if !value.contains('/') && !value.contains(':') {
        return false;
    }
    URI.get_or_init(|| {
        // ECMAScript /i without /u cannot fold non-ASCII code units into ASCII.
        // This all-ASCII expression therefore uses ASCII case folding and \d.
        // Both engines' non-multiline ^/$ require exact input beginning/end;
        // see ECMA-262 CompileAssertion/Canonicalize and regex 1.13.1 builders.rs.
        RegexBuilder::new(URI_PATTERN)
            .case_insensitive(true)
            .unicode(false)
            .multi_line(false)
            .build()
            .expect("pinned ajv-formats 3.0.1 URI expression")
    })
    .is_match(value)
}
