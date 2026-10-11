//! Full-source selector lookup only. Entries reference original opaque grants;
//! an index entry supplies no authority and every retained grant is revalidated.
use crate::access as a;
use std::collections::BTreeMap;

type Key = (String, String, String, String, u8, String);
pub(super) struct GrantIndex(BTreeMap<Key, usize>);
impl GrantIndex {
    pub fn new(grants: &[a::SourceGrant]) -> Self {
        Self(
            grants
                .iter()
                .enumerate()
                .map(|(i, g)| (key(g.reference()), i))
                .collect(),
        )
    }
    pub fn position(&self, reference: &a::SourceRef) -> Option<usize> {
        self.0.get(&key(reference)).copied()
    }
}
fn key(reference: &a::SourceRef) -> Key {
    let kind = match reference.key.source_kind {
        a::SourceKind::HomeboxEntity => 0,
        a::SourceKind::NetworkDevice => 1,
        a::SourceKind::NetworkGroup => 2,
        a::SourceKind::NetworkInterface => 3,
        a::SourceKind::NetworkSegment => 4,
        a::SourceKind::MagicplanRoom => 5,
    };
    (
        reference.workspace_id.as_str().into(),
        reference.home_id.as_str().into(),
        reference.key.source_instance_id.as_str().into(),
        reference.key.collection_id.clone(),
        kind,
        reference.key.external_id.clone(),
    )
}
