//! Explicit healthy content examples only. Synthetic authority metadata is NOT
//! a live authority export. The native AT11/atomic AT07 seam is compile-only.
pub use houseatlas_backend::{access, contracts, domain, providers, storage};
#[path = "../component.rs"]
pub mod presence;

use contracts::stock as wire;
use presence::*;
use providers::network as net;
use serde_json::{Value, json};
use std::{cell::Cell, error::Error, future::Future, pin::Pin};
use storage as s;

const AT: &str = "2026-01-02T12:00:00Z";
const NOW: &str = "2026-01-02T12:01:00Z";
const PLAN: &str =
    include_str!("../../../../../packages/contracts/fixtures/plan-free.snapshot.json");
const STOCK: &str = include_str!("../../../contracts/stock/examples/healthy.json");
const INVENTORY: &[u8] =
    include_bytes!("../../../../../adapters/network/fixtures/inventory.wire.json");
const REVIEW: &str = include_str!("../../../../../adapters/network/fixtures/link-review.json");

fn id(n: u64) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn hash(value: &impl serde::Serialize) -> Result<String, Box<dyn Error>> {
    Ok(contracts::semantics::canonical_digest(
        &serde_json::to_value(value)?,
    )?)
}
fn convert<T: serde::de::DeserializeOwned>(
    value: &impl serde::Serialize,
) -> Result<T, Box<dyn Error>> {
    Ok(serde_json::from_value(serde_json::to_value(value)?)?)
}
fn authority(
    registration: &s::SourceRegistration,
) -> Result<wire::PresenceAuthority, Box<dyn Error>> {
    let stock: Value = serde_json::from_str(STOCK)?;
    let mut value: wire::PresenceAuthority =
        serde_json::from_value(stock["presenceQualifications"][0]["authority"].clone())?;
    value.source_registration_sha256 = hash(registration)?;
    Ok(value)
}

/// Fixture-only authority over this one synthetic home. No access credentials
/// or grants are issued; actual NativeSemantics owns all shape/graph checks.
struct SyntheticStorageAuthority;
impl s::Authorization for SyntheticStorageAuthority {
    type Principal = s::VerifiedActor;
    fn authorize(
        &self,
        principal: &s::VerifiedActor,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        assert_eq!(request.scope.workspace_id, principal.workspace_id);
        assert_eq!(request.scope.home_id, principal.home_id);
        assert_eq!(request.capability, s::Capability::PublishCache);
        Ok(principal.clone())
    }
}
struct SyntheticRuntime(Cell<u64>);
impl s::Runtime for SyntheticRuntime {
    fn now(&self) -> s::Result<String> {
        Ok(AT.into())
    }
    fn new_id(&self) -> s::Result<String> {
        let next = self.0.get();
        self.0.set(next + 1);
        Ok(id(next))
    }
    fn verify_available_asset(&self, _: &s::Record) -> s::Result<s::AssetProof> {
        unreachable!("healthy presence examples have no assets")
    }
}

struct SavedNetworkRow(net::SidecarRow);
impl net::DurableNetworkSidecar for SavedNetworkRow {
    type Receipt = ();
    fn stage(
        &mut self,
        _: &net::SourceRegistration,
        _: &net::SidecarRow,
    ) -> Result<(), net::NetworkError> {
        unreachable!("synthetic row is prepared separately")
    }
    fn load(
        &self,
        source: &net::SourceRegistration,
        generation_id: &str,
    ) -> Result<net::SidecarRow, net::NetworkError> {
        assert_eq!(self.0.partition_key, net::partition_key(&source.scope)?);
        assert_eq!(self.0.generation_id, generation_id);
        Ok(self.0.clone())
    }
}
struct SyntheticInventory(net::SourceScope);
impl net::InventoryTransport for SyntheticInventory {
    fn get_inventory(
        &self,
        request: net::InventoryGet,
        _: net::Limits,
    ) -> Pin<Box<dyn Future<Output = Result<net::InventoryResponse, net::NetworkError>> + Send + '_>>
    {
        assert_eq!(
            (request.method(), request.path()),
            ("GET", "/api/inventory")
        );
        Box::pin(async {
            Ok(net::InventoryResponse {
                status: 200,
                source: Some(self.0.clone()),
                body: INVENTORY.to_vec(),
                source_snapshot_at: None,
                redirected: false,
                location: None,
                url: None,
            })
        })
    }
}

fn exercise_content(
    original: Option<&s::Record>,
    candidate: &s::Record,
    identity: &s::Record,
    operation: s::Operation,
    current: &CurrentPresenceRead,
    age: &ConfiguredCacheAge,
    trigger: wire::PresenceTrigger,
) -> Result<(), Box<dyn Error>> {
    let authority = authority(&current.registration)?;
    let capture = CapturedPresenceContent::from_current_read(
        original,
        candidate,
        identity,
        operation,
        current,
        &authority,
        (NOW, age),
    )?
    .expect("healthy claim has new observation");
    capture.revalidate_content(current, &authority, (NOW, age))?;
    let qualified = capture.qualification();
    assert_eq!(qualified.observed_at, AT);
    let final_revision = original.map_or(1, |row| row.revision + 1);
    let mut final_record = candidate.clone();
    final_record.revision = final_revision;
    final_record.updated_at = NOW.into();
    final_record.last_audit_id = id(98001);
    let audit = s::Audit {
        schema_version: 1,
        audit_id: final_record.last_audit_id.clone(),
        workspace_id: candidate.workspace_id.clone(),
        home_id: candidate.home_id.clone(),
        record: candidate.reference(),
        operation,
        previous_revision: original.map(|r| r.revision),
        result_revision: final_revision,
        actor_id: id(50),
        at: NOW.into(),
        reason: "Synthetic presence content example".into(),
        mutation_id: id(98002),
        before_digest: original.map(hash).transpose()?,
        after_digest: hash(&final_record)?,
    };
    let witness = capture.witness_content(&final_record, &audit)?;
    assert_eq!(witness.trigger, trigger);
    assert_eq!(witness.admitted_at, audit.at);
    assert_eq!(witness.observed_at, AT);
    assert_eq!(
        wire::decode_presence_witness(&wire::encode_presence_witness(&witness)?)?,
        witness
    );
    assert_eq!(
        wire::decode_presence_qualification(&wire::encode_presence_qualification(qualified)?)?,
        *qualified
    );
    assert_eq!(final_record.payload, candidate.payload);
    println!(
        "PASS healthy typed content {:?} / {:?}; no witness persisted",
        qualified.source.source_kind, trigger
    );
    Ok(())
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn Error>> {
    let snapshot: s::Snapshot = serde_json::from_str(PLAN)?;
    let scratch = tempfile::tempdir()?;
    let principal = s::VerifiedActor {
        workspace_id: id(1),
        home_id: id(2),
        actor_id: id(50),
    };
    let mut store = s::AtlasStore::open(
        scratch.path().join("healthy.sqlite"),
        domain::native_semantics::NativeSemantics::native(),
        SyntheticStorageAuthority,
        SyntheticRuntime(Cell::new(97000)),
        s::StoreOptions {
            allow_synthetic_bootstrap: true,
            ..s::StoreOptions::default()
        },
    )?;
    store.initialize_synthetic(&snapshot)?;
    let hb_registration: s::SourceRegistration =
        serde_json::from_value(snapshot.sources[0].clone())?;
    let prepared = store.prepare_cache_publication(
        &principal,
        &hb_registration.scope(),
        &hb_registration.partition(),
    )?;
    let mut cache: s::CacheStatus = serde_json::from_value(snapshot.caches[0].clone())?;
    cache.generation_id = Some(prepared.fence().reserved_generation_id().into());
    store.publish_prepared_generation(
        &principal,
        prepared.into_parts().1,
        &cache,
        &snapshot
            .homebox_entities
            .iter()
            .filter(|row| row["homeId"] == id(2))
            .cloned()
            .collect::<Vec<_>>(),
        &[],
    )?;
    let current = read_current_store::<_, _, _, SavedNetworkRow>(
        &mut store,
        &principal,
        &hb_registration,
        None,
    )?;
    assert_eq!(current.publication.cache_epoch, 1);
    let age = ConfiguredCacheAge::Homebox {
        stale_after_ms: 300_000,
    };
    let mut candidate = snapshot
        .records
        .iter()
        .find(|row| {
            row.record_type == s::RecordType::Binding
                && row.payload["source"]["externalId"] == id(500)
        })
        .expect("fixture binding")
        .clone();
    let identity = snapshot
        .records
        .iter()
        .find(|row| {
            row.record_type == s::RecordType::Identity
                && row.record_id == candidate.payload["atlasId"]
        })
        .expect("fixture identity");
    candidate.record_id = id(98100);
    let original = candidate.clone();
    exercise_content(
        None,
        &candidate,
        identity,
        s::Operation::Create,
        &current,
        &age,
        wire::PresenceTrigger::CreatePresent,
    )?;
    let mut unresolved = original.clone();
    unresolved.payload["sourceState"] = json!("unresolved");
    exercise_content(
        Some(&unresolved),
        &candidate,
        identity,
        s::Operation::Replace,
        &current,
        &age,
        wire::PresenceTrigger::NonpresentToPresent,
    )?;
    let mut tombstone = original.clone();
    tombstone.lifecycle = s::Lifecycle::Tombstoned;
    exercise_content(
        Some(&tombstone),
        &candidate,
        identity,
        s::Operation::Restore,
        &current,
        &age,
        wire::PresenceTrigger::RestoreActivePresent,
    )?;
    let mut added = candidate.clone();
    added.payload["evidenceIds"]
        .as_array_mut()
        .unwrap()
        .push(json!(id(102)));
    exercise_content(
        Some(&original),
        &added,
        identity,
        s::Operation::Replace,
        &current,
        &age,
        wire::PresenceTrigger::PresentEvidenceIdsReplaced,
    )?;
    let mut reordered = added.clone();
    reordered.payload["evidenceIds"]
        .as_array_mut()
        .unwrap()
        .reverse();
    let requirement = current_presence_requirement(&PresenceChange {
        original: Some(&added),
        candidate: &reordered,
        identity,
        operation: s::Operation::Replace,
    })?;
    assert_eq!(requirement, domain::PresenceRequirement::NoNewObservation);
    let mut reviewed = original.clone();
    reviewed.payload["reviewStatus"] = json!("proposed");
    assert_eq!(
        current_presence_requirement(&PresenceChange {
            original: Some(&reviewed),
            candidate: &original,
            identity,
            operation: s::Operation::Replace
        })?,
        domain::PresenceRequirement::NoNewObservation
    );
    println!(
        "PASS retained observation: evidence reorder and review-only change require no new facts"
    );

    let item_binding = snapshot
        .records
        .iter()
        .find(|row| {
            row.record_type == s::RecordType::Binding
                && row.payload["source"]["externalId"] == id(501)
        })
        .expect("fixture item binding");
    let item_identity = snapshot
        .records
        .iter()
        .find(|row| {
            row.record_type == s::RecordType::Identity
                && row.record_id == item_binding.payload["atlasId"]
        })
        .expect("fixture item identity");
    exercise_content(
        None,
        item_binding,
        item_identity,
        s::Operation::Create,
        &current,
        &age,
        wire::PresenceTrigger::CreatePresent,
    )?;

    let registration: s::SourceRegistration = serde_json::from_value(snapshot.sources[2].clone())?;
    let network_registration: net::SourceRegistration = convert(&registration)?;
    let review: net::LinkReview = serde_json::from_str(REVIEW)?;
    let prepared = store.prepare_cache_publication(
        &principal,
        &registration.scope(),
        &registration.partition(),
    )?;
    let mut provider = net::NetworkProvider::new(
        network_registration.clone(),
        review.clone(),
        net::Limits::default(),
    )?;
    let transport = SyntheticInventory(network_registration.scope.clone());
    let outcome = provider
        .prepare_refresh(
            &net::RetainedState::empty(network_registration.scope.clone()),
            prepared.fence().baseline_cache_epoch().value(),
            prepared.fence().reserved_generation_id(),
            &transport,
            || AT.into(),
        )
        .await?;
    let net::RefreshOutcome::Complete(proposal) = outcome else {
        panic!("healthy complete proposal")
    };
    let saved = SavedNetworkRow(net::stage_row(&network_registration, &proposal)?);
    let cache: s::CacheStatus = convert(&proposal.state().cache)?;
    let generation = proposal.state().generation.as_ref().unwrap();
    let relations: Vec<Value> = convert(&generation.network_relations)?;
    store.publish_prepared_generation(
        &principal,
        prepared.into_parts().1,
        &cache,
        &[],
        &relations,
    )?;
    let current = read_current_store(
        &mut store,
        &principal,
        &registration,
        Some((&saved, &review)),
    )?;
    let age = ConfiguredCacheAge::Network {
        stale_after_ms: 300_000,
    };
    for (kind, member) in [
        ("network-device", &generation.inventory.devices[0]),
        ("network-group", &generation.inventory.groups[0]),
    ] {
        let mut binding = candidate.clone();
        binding.payload["source"] = json!({"sourceInstanceId": registration.source_instance_id,
            "collectionId": registration.collection_id, "sourceKind": kind, "externalId": member.external_id});
        let qualification = CapturedPresenceContent::from_current_read(
            None,
            &binding,
            identity,
            s::Operation::Create,
            &current,
            &authority(&registration)?,
            (NOW, &age),
        )?
        .unwrap();
        let wire::PresenceObservation::NetworkInventory {
            member_sha256,
            verified_generation_sha256,
            source_snapshot_at,
            ..
        } = &qualification.qualification().observation
        else {
            panic!("Network arm")
        };
        assert_eq!(*member_sha256, hash(member)?);
        assert_eq!(*verified_generation_sha256, saved.0.sha256);
        assert_eq!(*source_snapshot_at, None);
        exercise_content(
            None,
            &binding,
            identity,
            s::Operation::Create,
            &current,
            &age,
            wire::PresenceTrigger::CreatePresent,
        )?;
    }
    store.close()?;
    println!(
        "PASS actual native cache publication/read mapping and 7 healthy witness-content cases; atomic admission held"
    );
    Ok(())
}
