//! Read-point enrichment only. Documentary devices and reviewed room placement stay intact.
use super::*;
use crate::{
    config::atlas_device_links::{DeviceLink, Manifest},
    providers::network as n,
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

fn invalid() -> HttpFailure {
    failure(StatusCode::SERVICE_UNAVAILABLE)
}
fn need(ok: bool) -> Result<(), HttpFailure> {
    if ok { Ok(()) } else { Err(invalid()) }
}
fn key(scope: &n::SourceScope) -> (String, String, String, String) {
    (
        scope.workspace_id.clone(),
        scope.home_id.clone(),
        scope.source_instance_id.clone(),
        scope.collection_id.clone(),
    )
}
/// Duplicate accepted identities on either side withhold every affected device.
fn selected<'a>(
    manifest: &'a Manifest,
    sha: &str,
    network: &Value,
    scope: &d::Scope,
) -> Result<Vec<&'a DeviceLink>, HttpFailure> {
    let Some(devices) = network["devices"].as_array() else {
        return Ok(vec![]);
    };
    need(devices.len() <= 512)?;
    let ids: BTreeSet<_> = devices.iter().filter_map(|d| d["id"].as_str()).collect();
    need(ids.len() == devices.len())?;
    let links: Vec<_> = manifest
        .links
        .iter()
        .filter(|l| {
            l.scene_original_sha256 == sha
                && l.review_status == "accepted"
                && l.source.scope.workspace_id == scope.workspace_id
                && l.source.scope.home_id == scope.home_id
        })
        .collect();
    Ok(links
        .iter()
        .copied()
        .filter(|l| {
            ids.contains(l.documentary_device_id.as_str())
                && links
                    .iter()
                    .filter(|other| other.documentary_device_id == l.documentary_device_id)
                    .count()
                    == 1
                && links
                    .iter()
                    .filter(|other| {
                        key(&other.source.scope) == key(&l.source.scope)
                            && other.source.external_id == l.source.external_id
                    })
                    .count()
                    == 1
        })
        .collect())
}
fn facts(facet: &n::NetworkFacet, id: &str) -> Result<Value, HttpFailure> {
    let rows: Vec<_> = facet
        .devices
        .iter()
        .filter(|d| d.external_id == id)
        .collect();
    need(rows.len() <= 1)?;
    if rows.is_empty() {
        return Ok(
            json!({"status":"absent","addresses":null,"observedState":null,"lastSeenAt":null,
            "sourceSnapshotAt":facet.source_snapshot_at,"retrievedAt":facet.cache.last_successful_fetch_at,"freshness":"unknown"}),
        );
    }
    let device = rows[0];
    let mut addresses = BTreeSet::new();
    for interface in &facet.interfaces {
        if interface.value["deviceId"] == id {
            for a in interface.value["addresses"]
                .as_array()
                .ok_or_else(invalid)?
            {
                let a = a.as_str().ok_or_else(invalid)?;
                need(a.encode_utf16().count() <= 200)?;
                addresses.insert(a.to_owned());
                need(addresses.len() <= 32)?;
            }
        }
    }
    let interface_ids: BTreeSet<_> = facet
        .interfaces
        .iter()
        .filter(|i| i.value["deviceId"] == id)
        .map(|i| i.external_id.as_str())
        .collect();
    let observations: Vec<_> = facet
        .observations
        .iter()
        .filter(|o| {
            let device = o.observation.value["deviceId"].as_str();
            let interface = o.observation.value["interfaceId"].as_str();
            // A contradictory device/interface attribution is not a device fact.
            if let (Some(device), Some(interface)) = (device, interface) {
                if !facet
                    .interfaces
                    .iter()
                    .any(|i| i.external_id == interface && i.value["deviceId"] == device)
                {
                    return false;
                }
            }
            device == Some(id)
                || (device.is_none() && interface.is_some_and(|i| interface_ids.contains(i)))
        })
        .collect();
    need(observations.len() <= 64)?;
    let stale = facet.status == n::FacetStatus::Stale;
    let freshness = if observations.is_empty() {
        "unknown"
    } else if observations
        .iter()
        .any(|o| o.freshness == n::ObservationFreshness::Invalidated)
    {
        "invalidated"
    } else if stale
        || observations
            .iter()
            .any(|o| o.freshness == n::ObservationFreshness::Stale)
    {
        "stale"
    } else {
        "recent"
    };
    // Only an explicit source lastSeenAt is a last-seen fact. Observation time is not one.
    let seen: BTreeSet<_> = observations
        .iter()
        .filter(|o| o.freshness != n::ObservationFreshness::Invalidated)
        .filter_map(|o| o.observation.value["value"]["lastSeenAt"].as_str())
        .filter(|v| chrono::DateTime::parse_from_rfc3339(v).is_ok())
        .collect();
    let state: Vec<_> = observations.iter().map(|o| json!({"id":o.observation.external_id,
        "kind":o.observation.value["kind"],"value":o.observation.value["value"],
        "factAt":o.observation.fact_at,"sourceSnapshotAt":o.observation.source_snapshot_at,
        "retrievedAt":o.observation.retrieved_at,"vantage":o.observation.vantage,"invalidatedAt":o.observation.value["invalidatedAt"],
        "freshness":if stale && o.freshness == n::ObservationFreshness::Recent { n::ObservationFreshness::Stale } else { o.freshness }})).collect();
    let result = json!({"status":if stale || freshness == "stale" || freshness == "invalidated" {"stale"} else if state.is_empty() {"unknown"} else {"available"},
        "addresses":addresses,"observedState":if state.is_empty() {Value::Null} else {json!(state)},
        "lastSeenAt":if seen.len() == 1 {seen.first().copied()} else {None},
        "sourceSnapshotAt":device.source_snapshot_at,"retrievedAt":device.retrieved_at,"freshness":freshness});
    need(serde_json::to_vec(&result).map_err(|_| invalid())?.len() <= 64 * 1024)?;
    Ok(result)
}
/// Called only after native scene/original/room qualification; retains that read's
/// outer authority. The cached owner independently captures and releases its exact
/// existing partition/member authority, then both owners revalidate before release.
pub(super) struct Enrichment<'h> {
    pub value: Value,
    reads: Vec<providers::network::CachedRead<'h>>,
    selection: &'h crate::config::atlas_device_links::ServerAtlasDeviceLinksSelection,
}
impl Enrichment<'_> {
    pub fn revalidate(&self) -> Result<(), HttpFailure> {
        for read in &self.reads {
            read.revalidate()?;
        }
        self.selection
            .read()
            .map_err(|_| failure(StatusCode::CONFLICT))?;
        Ok(())
    }
}
pub(super) fn read<'h>(
    host: &'h Host,
    headers: &CheckedHeaders,
    uri: &Uri,
    method: &Method,
    scope: &d::Scope,
    sha: &str,
    network: &Value,
) -> Result<Option<Enrichment<'h>>, HttpFailure> {
    let Some(selection) = &host.atlas_device_links else {
        return Ok(None);
    };
    let manifest = selection
        .read()
        .map_err(|_| failure(StatusCode::CONFLICT))?;
    let links = selected(&manifest, sha, network, scope)?;
    let mut reads = BTreeMap::new();
    for link in &links {
        let k = key(&link.source.scope);
        if !reads.contains_key(&k) {
            need(reads.len() < 8)?;
            let read = providers::network::read_cached(
                host,
                headers,
                uri,
                method,
                scope,
                &link.source.scope.source_instance_id,
                &link.source.scope.collection_id,
            )?;
            reads.insert(k, read);
        }
    }
    let mut devices = Vec::new();
    let mut addresses = 0;
    for link in links {
        let facet = &reads
            .get(&key(&link.source.scope))
            .ok_or_else(invalid)?
            .facet;
        if matches!(
            facet.status,
            n::FacetStatus::Unavailable | n::FacetStatus::Revoked
        ) {
            continue; // No captured inventory is not evidence of device absence.
        }
        let live = facts(facet, &link.source.external_id)?;
        addresses += live["addresses"].as_array().map_or(0, Vec::len);
        need(addresses <= 16_384)?;
        let mut live = live;
        live["source"] = json!({"workspaceId":link.source.scope.workspace_id,"homeId":link.source.scope.home_id,
            "sourceInstanceId":link.source.scope.source_instance_id,"collectionId":link.source.scope.collection_id,
            "sourceKind":"network-device","externalId":link.source.external_id});
        need(serde_json::to_vec(&live).map_err(|_| invalid())?.len() <= 64 * 1024)?;
        devices.push(json!({"id":link.documentary_device_id,"liveFacts":live}));
    }
    let result = json!({"schema":"houseatlas.network-overlay-live-facts.v2", "sceneOriginalSha256":sha,"devices":devices});
    need(serde_json::to_vec(&result).map_err(|_| invalid())?.len() <= 512 * 1024)?;
    Ok(Some(Enrichment {
        value: result,
        reads: reads.into_values().collect(),
        selection,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::atlas_device_links::ServerAtlasDeviceLinksSelection;
    use std::{fs, os::unix::fs::PermissionsExt};
    const AT: &str = "2026-01-02T12:00:00Z";
    fn id(n: u32) -> String {
        format!("00000000-0000-4000-8000-{n:012}")
    }
    fn scope() -> d::Scope {
        d::Scope {
            workspace_id: id(1),
            home_id: id(2),
        }
    }
    fn packet() -> Value {
        json!({"profile":"houseatlas.atlas-device-links.v1","links":[{
        "sceneOriginalSha256":"a".repeat(64),"documentaryDeviceId":"documentary-a",
        "source":{"workspaceId":id(1),"homeId":id(2),"sourceInstanceId":id(12),"collectionId":"inventory","sourceKind":"network-device","externalId":"device-a"},
        "reviewStatus":"accepted","reviewer":"Synthetic owner","reviewedAt":AT,"evidenceReference":"synthetic:review"}]})
    }
    fn manifest(v: &Value) -> Manifest {
        Manifest::parse(
            &serde_json::to_vec(v)
                .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed")),
        )
        .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"))
    }
    fn facet() -> n::NetworkFacet {
        let source = n::SourceRegistration {
            scope: n::SourceScope {
                workspace_id: id(1),
                home_id: id(2),
                source_instance_id: id(12),
                collection_id: "inventory".into(),
            },
            owner: "network".into(),
            partition_mode: n::PartitionMode::ExclusiveHome,
            allowed_external_ids: vec![],
        };
        let mut wire: Value = serde_json::from_str(include_str!(
            "../../../adapters/network/fixtures/inventory.wire.json"
        ))
        .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"));
        wire["inventory"]["interfaces"][0]["addresses"] = json!(["192.0.2.1"]);
        wire["observations"] = json!([{"id":"observation-a","collectorId":"synthetic","kind":"source-state","vantagePoint":"synthetic","timestamp":AT,"deviceId":"device-a","value":{"state":"observed","lastSeenAt":AT}}]);
        let bytes = serde_json::to_vec(&wire)
            .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"));
        let generation = n::project_capture(
            &source,
            n::NetworkCapture {
                source: &source.scope,
                document: &bytes,
                retrieved_at: AT,
                source_snapshot_at: Some(AT),
            },
            &serde_json::from_str(include_str!(
                "../../../adapters/network/fixtures/link-review.json"
            ))
            .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed")),
            n::Limits::default(),
        )
        .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"));
        let mut state = n::RetainedState::empty(source.scope.clone());
        state.cache.status = n::CacheStatus::Fresh;
        state.cache.last_successful_fetch_at = Some(AT.into());
        state.cache.last_attempt_at = Some(AT.into());
        state.cache.generation_id = Some(id(90));
        state.generation = Some(generation);
        n::build_facet(&source, &state, AT, 60_000)
            .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"))
    }
    #[test]
    fn healthy_network_overlay_live_facts() {
        let network = json!({"devices":[{"id":"documentary-a"},{"id":"unjoined"}]});
        let mut p = packet();
        let m = manifest(&p);
        let selected = selected(&m, &"a".repeat(64), &network, &scope())
            .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"));
        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].documentary_device_id, "documentary-a");
        let mut f = facet();
        let live = facts(&f, "device-a")
            .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"));
        assert_eq!(live["status"], "available");
        assert_eq!(live["addresses"], json!(["192.0.2.1"]));
        assert_eq!(live["lastSeenAt"], AT);
        assert_eq!(live["observedState"][0]["factAt"], AT);
        assert_eq!(live["retrievedAt"], AT);
        assert_eq!(
            facts(&f, "missing")
                .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"))["status"],
            "absent"
        );
        f.status = n::FacetStatus::Stale;
        assert_eq!(
            facts(&f, "device-a")
                .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"))["status"],
            "stale"
        );
        assert_eq!(
            facts(&f, "device-a")
                .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"))["observedState"]
                [0]["freshness"],
            "stale"
        );
        let mut invalidated = f.clone();
        invalidated.observations[0].freshness = n::ObservationFreshness::Invalidated;
        invalidated.observations[0].observation.value["invalidatedAt"] = json!(AT);
        assert_eq!(
            facts(&invalidated, "device-a").ok().unwrap()["lastSeenAt"],
            Value::Null
        );
        assert_eq!(
            facts(&invalidated, "device-a").ok().unwrap()["freshness"],
            "invalidated"
        );
        let mut too_many = f.clone();
        too_many.observations = vec![too_many.observations[0].clone(); 65];
        assert!(facts(&too_many, "device-a").is_err());
        let mut contradictory = facet();
        contradictory.observations[0].observation.value["deviceId"] = json!("device-b");
        contradictory.observations[0].observation.value["interfaceId"] = json!("interface-a");
        assert_eq!(
            facts(&contradictory, "device-a").ok().unwrap()["observedState"],
            Value::Null
        );
        assert_eq!(
            facts(&contradictory, "device-b").ok().unwrap()["observedState"],
            Value::Null
        );
        f.observations.clear();
        assert_eq!(
            facts(&f, "device-a")
                .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"))["freshness"],
            "unknown"
        );
        f.interfaces[0].value["addresses"] =
            json!((0..33).map(|v| format!("192.0.2.{v}")).collect::<Vec<_>>());
        assert!(facts(&f, "device-a").is_err());
        p["links"][0]["reviewStatus"] = json!("unreviewed");
        p["links"][0]["reviewer"] = Value::Null;
        p["links"][0]["reviewedAt"] = Value::Null;
        assert!(
            super::selected(&manifest(&p), &"a".repeat(64), &network, &scope())
                .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"))
                .is_empty()
        );
        p = packet();
        let mut duplicate = p["links"][0].clone();
        duplicate["source"]["externalId"] = json!("device-b");
        p["links"]
            .as_array_mut()
            .unwrap_or_else(|| panic!("Synthetic Network overlay fixture failed"))
            .push(duplicate);
        assert!(
            super::selected(&manifest(&p), &"a".repeat(64), &network, &scope())
                .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"))
                .is_empty()
        );
        p = packet();
        let mut duplicate = p["links"][0].clone();
        duplicate["documentaryDeviceId"] = json!("unjoined");
        p["links"]
            .as_array_mut()
            .unwrap_or_else(|| panic!("Synthetic Network overlay fixture failed"))
            .push(duplicate);
        assert!(
            super::selected(&manifest(&p), &"a".repeat(64), &network, &scope())
                .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"))
                .is_empty()
        );
        assert!(
            super::selected(&m, &"b".repeat(64), &network, &scope())
                .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"))
                .is_empty()
        );
        assert!(
            super::selected(
                &m,
                &"a".repeat(64),
                &json!({"devices":vec![json!({"id":"x"});513]}),
                &scope()
            )
            .is_err()
        );
    }
    #[test]
    fn healthy_network_overlay_private_file_fences() {
        use sha2::{Digest, Sha256};
        let root = tempfile::Builder::new()
            .permissions(fs::Permissions::from_mode(0o700))
            .tempdir()
            .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"));
        let path = fs::canonicalize(root.path())
            .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"))
            .join("review.json");
        let bytes = serde_json::to_vec(&packet())
            .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"));
        fs::write(&path, &bytes)
            .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"));
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"));
        let sha = format!("{:x}", Sha256::digest(&bytes));
        let selection = ServerAtlasDeviceLinksSelection::read_pinned(&path, &sha)
            .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"));
        assert!(ServerAtlasDeviceLinksSelection::read_pinned(&path, &"b".repeat(64)).is_err());
        assert_eq!(
            selection
                .read()
                .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"))
                .links
                .len(),
            1
        );
        let mut changed = packet();
        changed["links"][0]["reviewer"] = json!("Different synthetic owner");
        fs::write(
            &path,
            serde_json::to_vec(&changed)
                .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed")),
        )
        .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"));
        assert!(selection.read().is_err());
        let mut missing_reviewer = packet();
        missing_reviewer["links"][0]
            .as_object_mut()
            .unwrap()
            .remove("reviewer");
        assert!(Manifest::parse(&serde_json::to_vec(&missing_reviewer).unwrap()).is_err());
        assert!(
            Manifest::parse(
                br#"{"profile":"houseatlas.atlas-device-links.v1","links":[],"extra":true}"#
            )
            .is_err()
        );
        assert!(
            Manifest::parse(
                br#"{"profile":"houseatlas.atlas-device-links.v1","links":[],"links":[]}"#
            )
            .is_err()
        );
        assert!(
            ServerAtlasDeviceLinksSelection::from_arguments(&["serve".into()])
                .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"))
                .1
                .is_none()
        );
    }
    #[tokio::test]
    async fn healthy_network_overlay_unauthorized() {
        use axum::{body::Body, extract::ConnectInfo, http::Request};
        use tower::ServiceExt;
        let root = tempfile::tempdir_in("/tmp")
            .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"));
        let core =
            crate::lifecycle::prepare(&root.path().join("fixture"), "https://127.0.0.1:48743")
                .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"));
        let scope = core.home.scope.clone();
        let host = Host::new(
            core,
            "https://127.0.0.1:48743".into(),
            Arc::new(BTreeMap::new()),
            vec![],
        )
        .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"));
        let app = router(host);
        for path in [
            format!(
                "/api/atlas/scene/v1/workspaces/{}/homes/{}/buildings/{}/current?networkLiveFacts=2",
                scope.workspace_id,
                scope.home_id,
                id(3)
            ),
            format!(
                "/api/atlas/providers/network/workspaces/{}/homes/{}/sources/{}/cached?collection=inventory",
                scope.workspace_id,
                scope.home_id,
                id(12)
            ),
        ] {
            let mut request = Request::builder()
                .uri(path)
                .header("host", "127.0.0.1:48743")
                .header("sec-fetch-site", "same-origin")
                .header("origin", "https://127.0.0.1:48743")
                .body(Body::empty())
                .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"));
            request.extensions_mut().insert(ConnectInfo(
                "127.0.0.1:50123"
                    .parse::<std::net::SocketAddr>()
                    .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed")),
            ));
            let response = app
                .clone()
                .oneshot(request)
                .await
                .unwrap_or_else(|_| panic!("Synthetic Network overlay fixture failed"));
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        }
    }
}
