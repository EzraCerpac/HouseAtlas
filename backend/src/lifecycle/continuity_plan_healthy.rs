//! Generated observation DATA only. No filesystem/SQL/lock/service/recovery runs.
use super::*;

fn identity(device: u64, inode: u64, directory: bool) -> Identity {
    Identity { device, inode, uid: 42, mode: if directory { 0o40700 } else { 0o100600 }, links: 1 }
}
fn image_data(device: u64, inode: u64, bytes: &[u8]) -> Presence {
    Presence::Present(Image { identity: identity(device, inode, false), bytes: bytes.len() as u64, sha256: hash(bytes) })
}
fn fixture() -> EvidenceInput {
    let state = State {
        format: "houseatlas-persistent-server/1".into(),
        configuration_digest: hash(b"generated selected state configuration"),
        atlas_schema: crate::storage::DATABASE_VERSION, access_schema: crate::access::ACCESS_SCHEMA_VERSION,
        access_device: 1, access_inode: 10, atlas_device: 1, atlas_inode: 20,
    };
    let receipt = serde_json::to_vec(&state).unwrap();
    let mut files: BTreeMap<_, _> = FILES.into_iter().map(|f| (f, Presence::Absent)).collect();
    files.insert(FileKind::Access, image_data(1, 10, b"generated access image"));
    files.insert(FileKind::Atlas, image_data(1, 20, b"generated atlas image"));
    files.insert(FileKind::AccessWal, image_data(1, 11, b"generated access WAL"));
    files.insert(FileKind::AtlasJournal, image_data(1, 21, b"generated atlas journal"));
    files.insert(FileKind::Receipt, image_data(1, 30, &receipt));
    let locks = LOCKS.into_iter().enumerate().map(|(n, key)| {
        let id = identity(1, 100 + n as u64, false);
        (key, LockObservation { opened: id.clone(), named: id, exclusive_claimed: true })
    }).collect();
    let baseline = ClosedCut { directory: identity(1, 99, true), files, locks, writers_closed_claimed: true };
    let mut current = baseline.clone(); current.directory.device = 2;
    for value in current.files.values_mut() { if let Presence::Present(i) = value { i.identity.device = 2; } }
    for lock in current.locks.values_mut() { lock.opened.device = 2; lock.named.device = 2; }
    EvidenceInput {
        expected_uid: 42, configuration_sha256: hash(b"generated config bytes"), state_configuration_digest: state.configuration_digest,
        original_receipt: receipt, baseline: Some(HistoricalBaseline { configuration_sha256: hash(b"generated config bytes"), cut: baseline }),
        current, other_state_receipts_present: false, unresolved_operation_present: false,
    }
}
fn observation(plan: &PlanData, published: bool) -> ObservationData {
    ObservationData { database_cut_sha256: plan.database_cut_sha256.clone(), lease_sha256: plan.lease_sha256.clone(),
        receipt_sha256: if published { plan.candidate_receipt_sha256.clone() } else { plan.original_receipt_sha256.clone() },
        receipt_identity: if published { staged(plan).image.identity } else { plan.receipt_identity.clone() } }
}
fn staged(plan: &PlanData) -> StagedReceiptData {
    let id = identity(plan.root.device, 500, false);
    StagedReceiptData { image: Image { identity: id.clone(), bytes: plan.candidate_bytes, sha256: plan.candidate_receipt_sha256.clone() }, named: id, directory: plan.root.clone() }
}
fn events(plan: &PlanData) -> Vec<EventData> {
    vec![
        EventData::Preservation { snapshot_sha256: plan.preservation_sha256.clone(), manifest_sha256: plan.preservation_sha256.clone(), sync_record_sha256: hash(b"recorded file/directory sync data") },
        EventData::Stage { staged: staged(plan), sync_record_sha256: hash(b"recorded staging sync data") },
        EventData::BeginPublication { observation: observation(plan, false), staged: staged(plan) },
        EventData::PublicationObserved { observation: observation(plan, true), directory_sync_record_sha256: hash(b"recorded parent directory sync data") },
        EventData::Complete(observation(plan, true)),
    ]
}

#[test]
fn missing_baseline_cannot_be_replaced_by_a_current_copy_or_integrity_claim() {
    let mut input = fixture(); input.baseline = None;
    assert_eq!(assess(&input).unwrap_err(), Hold::MissingHistoricalBaseline);
    let mut input = fixture(); input.baseline.as_mut().unwrap().cut = input.current.clone();
    assert_eq!(assess(&input).unwrap_err(), Hold::IdentityChanged);
}
#[test]
fn exact_device_only_observations_produce_plan_data_without_authority() {
    let input = fixture(); let plan = assess(&input).unwrap();
    assert!(!plan.grants_publication_authority());
    assert_eq!(plan.original_receipt_sha256(), hash(&input.original_receipt));
    assert_ne!(plan.original_receipt_sha256(), plan.candidate_receipt_sha256());
    assert!(is_hash(plan.preservation_sha256())); assert!(is_hash(plan.database_cut_sha256())); assert!(is_hash(plan.lease_sha256()));
}
#[test]
fn changed_database_or_sidecar_bytes_and_absence_are_holds() {
    for key in [FileKind::Access, FileKind::Atlas, FileKind::AccessWal, FileKind::AtlasJournal] {
        let mut input = fixture();
        if let Presence::Present(i) = input.current.files.get_mut(&key).unwrap() { i.sha256 = hash(b"new bytes"); }
        assert_eq!(assess(&input).unwrap_err(), Hold::ContentChanged);
    }
    let mut input = fixture(); input.current.files.insert(FileKind::AccessShm, image_data(2, 50, b"new shm"));
    assert_eq!(assess(&input).unwrap_err(), Hold::ContentChanged);
}
#[test]
fn incomplete_inventory_cannot_omit_absent_sidecars() {
    let mut input = fixture(); input.current.files.remove(&FileKind::AtlasShm);
    assert_eq!(assess(&input).unwrap_err(), Hold::IncompleteInventory);
}
#[test]
fn inode_configuration_coupled_receipt_and_unknown_operation_refuse() {
    let mut input = fixture();
    if let Presence::Present(i) = input.current.files.get_mut(&FileKind::Access).unwrap() { i.identity.inode += 1; }
    assert_eq!(assess(&input).unwrap_err(), Hold::IdentityChanged);
    let mut input = fixture(); input.configuration_sha256 = hash(b"different selected config");
    assert_eq!(assess(&input).unwrap_err(), Hold::ConfigurationChanged);
    let mut input = fixture(); input.other_state_receipts_present = true;
    assert_eq!(assess(&input).unwrap_err(), Hold::CoupledReceipts);
    let mut input = fixture(); input.unresolved_operation_present = true;
    assert_eq!(assess(&input).unwrap_err(), Hold::UncertainOutcome);
}
#[test]
fn all_three_original_named_lock_observations_and_closed_writer_claims_are_required() {
    for kind in LOCKS {
        let mut input = fixture(); input.current.locks.get_mut(&kind).unwrap().named.inode += 1;
        assert_eq!(assess(&input).unwrap_err(), Hold::LeaseMismatch);
        let mut input = fixture(); let lock = input.current.locks.get_mut(&kind).unwrap();
        lock.opened.inode += 1000; lock.named.inode += 1000;
        assert_eq!(assess(&input).unwrap_err(), Hold::LeaseMismatch);
        let mut input = fixture(); input.current.locks.get_mut(&kind).unwrap().exclusive_claimed = false;
        assert_eq!(assess(&input).unwrap_err(), Hold::LeaseMismatch);
    }
    let mut input = fixture(); input.current.writers_closed_claimed = false;
    assert_eq!(assess(&input).unwrap_err(), Hold::MissingClosedState);
}
#[test]
fn same_device_requires_no_rebinding_and_unknown_receipt_fields_refuse() {
    let mut input = fixture();
    for key in [FileKind::Access, FileKind::Atlas] { if let Presence::Present(i) = input.current.files.get_mut(&key).unwrap() { i.identity.device = 1; } }
    assert_eq!(assess(&input).unwrap_err(), Hold::NoDeviceChange);
    let mut input = fixture(); let mut value: serde_json::Value = serde_json::from_slice(&input.original_receipt).unwrap();
    value["adoptAnyway"] = serde_json::json!(true); input.original_receipt = serde_json::to_vec(&value).unwrap();
    assert_eq!(assess(&input).unwrap_err(), Hold::UnsupportedReceipt);
}
#[test]
fn journal_data_requires_preservation_stage_and_observed_publication_order() {
    let plan = assess(&fixture()).unwrap(); let mut model = JournalModel::new(plan.clone());
    assert_eq!(model.record(EventData::Complete(observation(&plan, true))), Err(Hold::EventOutOfOrder));
    assert_eq!(model.phase(), Phase::Selected);
    for event in events(&plan) { model.record(event).unwrap(); }
    assert_eq!(model.phase(), Phase::CompleteRecorded);
    assert_eq!(model.rollback_candidate(&observation(&plan, true), plan.original_receipt_sha256()).unwrap(), plan.original_receipt_sha256());
    assert!(!plan.grants_publication_authority());
}
#[test]
fn bad_sync_data_and_changed_precut_observations_cannot_advance() {
    let plan = assess(&fixture()).unwrap(); let mut model = JournalModel::new(plan.clone());
    assert_eq!(model.record(EventData::Preservation { snapshot_sha256: plan.preservation_sha256.clone(), manifest_sha256: "unknown".into(), sync_record_sha256: hash(b"data") }), Err(Hold::InvalidEvidence));
    assert_eq!(model.phase(), Phase::Selected);
    for event in events(&plan).into_iter().take(2) { model.record(event).unwrap(); }
    let mut changed = observation(&plan, false); changed.database_cut_sha256 = hash(b"later database write");
    assert_eq!(model.record(EventData::BeginPublication { observation: changed, staged: staged(&plan) }), Err(Hold::ObservationChanged));
    assert_eq!(model.phase(), Phase::StageRecorded);
}
#[test]
fn interruption_at_every_recorded_phase_stays_held_despite_receipt_readback() {
    let plan = assess(&fixture()).unwrap();
    for count in 0..=5 {
        let mut model = JournalModel::new(plan.clone());
        for event in events(&plan).into_iter().take(count) { model.record(event).unwrap(); }
        model.interrupt();
        assert_eq!(classify(&plan, &observation(&plan, false)), ObservedOutcome::OriginalReceiptOnly);
        assert_eq!(classify(&plan, &observation(&plan, true)), ObservedOutcome::CandidateReceiptOnly);
        assert_eq!(model.record(EventData::Complete(observation(&plan, true))), Err(Hold::UncertainOutcome));
        assert_eq!(model.phase(), Phase::Uncertain);
        assert_eq!(model.rollback_candidate(&observation(&plan, true), plan.original_receipt_sha256()), Err(Hold::UncertainOutcome));
    }
}
#[test]
fn rollback_data_refuses_later_writes_wrong_backup_or_different_original_lease() {
    let plan = assess(&fixture()).unwrap(); let mut model = JournalModel::new(plan.clone());
    for event in events(&plan) { model.record(event).unwrap(); }
    assert_eq!(model.rollback_candidate(&observation(&plan, true), &hash(b"wrong backup")), Err(Hold::OriginalBackupMismatch));
    for lease_changed in [false, true] {
        let mut model = JournalModel::new(plan.clone()); for event in events(&plan) { model.record(event).unwrap(); }
        let mut changed = observation(&plan, true);
        if lease_changed { changed.lease_sha256 = hash(b"other lease"); } else { changed.database_cut_sha256 = hash(b"later WAL write"); }
        assert_eq!(classify(&plan, &changed), ObservedOutcome::Diverged);
        assert_eq!(model.rollback_candidate(&changed, plan.original_receipt_sha256()), Err(Hold::ObservationChanged));
        assert_eq!(model.phase(), Phase::Uncertain);
        assert_eq!(model.rollback_candidate(&observation(&plan, true), plan.original_receipt_sha256()), Err(Hold::UncertainOutcome));
    }
}

#[test]
fn staged_receipt_data_must_pin_same_directory_private_identity_and_no_alias() {
    let plan = assess(&fixture()).unwrap();
    for change in 0..4 {
        let mut model = JournalModel::new(plan.clone()); model.record(events(&plan).remove(0)).unwrap();
        let mut stage = staged(&plan);
        match change {
            0 => stage.named.inode += 1,
            1 => stage.directory.inode += 1,
            2 => { stage.image.identity.device += 1; stage.named.device += 1; }
            _ => { stage.image.identity = plan.receipt_identity.clone(); stage.named = plan.receipt_identity.clone(); }
        }
        assert_eq!(model.record(EventData::Stage { staged: stage, sync_record_sha256: hash(b"data") }), Err(Hold::InvalidEvidence));
        assert_eq!(model.phase(), Phase::PreservationRecorded);
    }
}

#[test]
fn contradictory_post_publication_data_permanently_poison_the_model() {
    let plan = assess(&fixture()).unwrap();
    for count in [3, 4] {
        let mut model = JournalModel::new(plan.clone());
        for event in events(&plan).into_iter().take(count) { model.record(event).unwrap(); }
        let mut changed = observation(&plan, true); changed.receipt_identity.inode += 1;
        let event = if count == 3 { EventData::PublicationObserved { observation: changed, directory_sync_record_sha256: hash(b"sync") } } else { EventData::Complete(changed) };
        assert_eq!(model.record(event), Err(Hold::ObservationChanged));
        assert_eq!(model.phase(), Phase::Uncertain);
        assert_eq!(model.record(EventData::Complete(observation(&plan, true))), Err(Hold::UncertainOutcome));
    }
}
