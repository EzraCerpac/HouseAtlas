//! Checked transport metadata. Header absence and invalid encoding are distinct.
use crate::access::{AccessError, AccessResult, SESSION_COOKIE};
use axum::http::{HeaderMap, Uri, Version, header};

#[derive(Clone)]
pub(super) struct CheckedHeaders {
    host: Option<String>,
    pub origin: Option<String>,
    pub sec_fetch_site: Option<String>,
    pub referer: Option<String>,
    pub cookie: Option<String>,
    pub authorization: Option<String>,
    pub csrf: Option<String>,
}
fn single(headers: &HeaderMap, name: &str) -> AccessResult<Option<String>> {
    let mut values = headers.get_all(name).iter();
    let value = values.next();
    if values.next().is_some() {
        return Err(AccessError::Forbidden);
    }
    value
        .map(|value| {
            value
                .to_str()
                .map(str::to_owned)
                .map_err(|_| AccessError::Forbidden)
        })
        .transpose()
}
impl CheckedHeaders {
    pub fn read(headers: &HeaderMap, version: Version) -> AccessResult<Self> {
        let values = headers.get_all(header::COOKIE).iter();
        let parts = values
            .map(|value| value.to_str().map_err(|_| AccessError::Forbidden))
            .collect::<AccessResult<Vec<_>>>()?;
        // RFC 9113 permits Cookie splitting for HTTP/2 compression. Preserve all
        // pairs in order with the mandated separator before access token parsing.
        if parts.len() > 1 && version != Version::HTTP_2 {
            return Err(AccessError::Forbidden);
        }
        let cookie = (!parts.is_empty()).then(|| parts.join("; "));
        if let Some(cookie) = &cookie {
            if cookie.len() > 8192 {
                return Err(AccessError::Forbidden);
            }
            let sessions = cookie
                .split(';')
                .filter(|pair| {
                    pair.trim().split_once('=').map_or(pair.trim(), |p| p.0) == SESSION_COOKIE
                })
                .count();
            if sessions > 1 {
                return Err(AccessError::Forbidden);
            }
        }
        Ok(Self {
            host: single(headers, "host")?,
            origin: single(headers, "origin")?,
            sec_fetch_site: single(headers, "sec-fetch-site")?,
            referer: single(headers, "referer")?,
            cookie,
            authorization: single(headers, "authorization")?,
            csrf: single(headers, "x-atlas-csrf")?,
        })
    }
    pub fn check_authority(&self, origin: &str, uri: &Uri) -> AccessResult<()> {
        let expected = origin
            .strip_prefix("https://")
            .ok_or(AccessError::Forbidden)?;
        let host = self.host.as_deref();
        let authority = uri.authority().map(|a| a.as_str());
        if host.or(authority) != Some(expected)
            || host.is_some_and(|host| host != expected)
            || authority.is_some_and(|authority| authority != expected)
            || uri.scheme_str().is_some_and(|scheme| scheme != "https")
        {
            return Err(AccessError::Forbidden);
        }
        Ok(())
    }
}
