use super::error::invalid;
use super::*;
use url::Url;

#[derive(Clone, Debug)]
pub struct NativeRoute {
    pub intent: NativeIntent,
    pub verified: bool,
    pub path: String,
}
#[derive(Clone, Debug)]
pub struct NativeNavigation {
    pub scope: SourceScope,
    pub origin: String,
    pub routes: Vec<NativeRoute>,
}
impl NativeNavigation {
    pub(super) fn validate(&mut self, scope: &SourceScope) -> Result<(), ReadError> {
        if self.scope != *scope {
            return Err(ReadError(ErrorCode::WrongScope));
        }
        let u = Url::parse(&self.origin).map_err(|_| invalid())?;
        if !matches!(u.scheme(), "http" | "https")
            || !u.username().is_empty()
            || u.password().is_some()
            || u.query().is_some()
            || u.fragment().is_some()
            || u.path() != "/"
        {
            return Err(invalid());
        }
        for (i, route) in self.routes.iter().enumerate() {
            let path = &route.path;
            let remainder = path.replace("{entityId}", "");
            if !route.verified
                || !path.starts_with('/')
                || path.matches("{entityId}").count() != 1
                || path.contains("//")
                || path.contains("..")
                || !remainder
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'/' | b'_' | b'-'))
                || self.routes[..i].iter().any(|r| r.intent == route.intent)
            {
                return Err(invalid());
            }
        }
        self.origin = u.origin().ascii_serialization();
        Ok(())
    }
    pub(super) fn links(&self, scope: &SourceScope, key: &SourceKey) -> Vec<NativeLink> {
        self.routes
            .iter()
            .map(|route| NativeLink {
                kind: "homebox-native",
                intent: route.intent,
                entity: SourceRef {
                    workspace_id: scope.workspace_id.clone(),
                    home_id: scope.home_id.clone(),
                    key: key.clone(),
                },
                href: format!(
                    "{}{}",
                    self.origin,
                    route.path.replace("{entityId}", key.external_id.as_str())
                ),
                verified_route: true,
            })
            .collect()
    }
}
