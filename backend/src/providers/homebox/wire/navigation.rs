use super::Summary;
use crate::providers::homebox::read::{NativeIntent, NativeRoute};

/// Official Nuxt page files establish candidates, not verified target routes.
/// A missing type remains unknown. Maintenance has no location page upstream.
pub fn native_route_candidates(summary: &Summary) -> Vec<NativeRoute> {
    let Some(kind) = summary.entity_type.as_ref() else {
        return Vec::new();
    };
    let base = if kind.is_location { "location" } else { "item" };
    let mut result = vec![
        NativeRoute {
            intent: NativeIntent::View,
            verified: false,
            path: format!("/{base}/{{entityId}}"),
        },
        NativeRoute {
            intent: NativeIntent::Edit,
            verified: false,
            path: format!("/{base}/{{entityId}}/edit"),
        },
    ];
    if !kind.is_location {
        result.push(NativeRoute {
            intent: NativeIntent::Maintenance,
            verified: false,
            path: "/item/{entityId}/maintenance".into(),
        });
    }
    result
}
