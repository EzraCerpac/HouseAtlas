//! Ordinary offline Reader -> SQLite -> strict image/reopen numeric checkpoint.
//! Mount actual Reader92, native contracts and Storage in a task-owned harness.
//! Transport, principal and clock below are synthetic; no live I/O or controls.
use houseatlas_at07_checkpoint::{
    http::contracts::NativeContracts, providers::homebox::read as reader, storage as s,
};
use rusqlite::{Connection, OpenFlags};
use serde_json::{Value, json};
use std::{cell::Cell, collections::VecDeque, fs, path::PathBuf, rc::Rc};

type Check<T> = Result<T, Box<dyn std::error::Error>>;
const TIME: &str = "2026-10-07T12:00:00Z";
const COSTS: [&str; 7] = [
    "9007199254740993",
    "1e-1000",
    "0.123456789012345678901234567890",
    "12.50",
    "1.25e+06",
    "0",
    "-0.00",
];
fn id(n: u64) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
#[derive(Clone)]
struct SyntheticAuthority;
impl s::Authorization for SyntheticAuthority {
    type Principal = s::VerifiedActor;
    fn authorize(
        &self,
        principal: &s::VerifiedActor,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        assert_eq!(request.scope.workspace_id, principal.workspace_id);
        assert_eq!(request.scope.home_id, principal.home_id);
        assert!(request.mutation.is_none());
        Ok(principal.clone())
    }
}
#[derive(Clone)]
struct SyntheticClock(Rc<Cell<u64>>);
impl s::Runtime for SyntheticClock {
    fn now(&self) -> s::Result<String> {
        Ok(TIME.into())
    }
    fn new_id(&self) -> s::Result<String> {
        let next = self.0.get();
        self.0.set(next + 1);
        Ok(id(next))
    }
    fn verify_available_asset(&self, _: &s::Record) -> s::Result<s::AssetProof> {
        Err(s::Error::new(
            "checkpoint-error",
            "No asset in this fixture",
        ))
    }
}
struct ReaderClock;
impl reader::Clock for ReaderClock {
    fn now(&self) -> reader::Timestamp {
        reader::Timestamp::parse(TIME).unwrap()
    }
}
struct Chunks(VecDeque<Vec<u8>>);
impl reader::Body for Chunks {
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, reader::ReadError> {
        Ok(self.0.pop_front())
    }
}
struct StockFixture {
    scope: reader::SourceScope,
    item: Value,
    maintenance: Value,
}
impl reader::Transport for StockFixture {
    type Body = Chunks;
    async fn get(
        &mut self,
        request: reader::GetRequest,
    ) -> Result<reader::GetResponse<Chunks>, reader::ReadError> {
        assert_eq!(request.scope(), &self.scope);
        let body = if request.path() == "/api/v1/entities" {
            let locations = request
                .query()
                .iter()
                .any(|(key, value)| key == "isLocation" && value == "true");
            let rows = if locations {
                vec![]
            } else {
                vec![self.item.clone()]
            };
            json!({"items":rows,"page":1,"pageSize":100,"total":rows.len()})
        } else if request.path().ends_with("/maintenance") {
            assert_eq!(request.query(), &[("status".into(), "both".into())]);
            self.maintenance.clone()
        } else {
            assert_eq!(request.path(), format!("/api/v1/entities/{}", id(2)));
            self.item.clone()
        };
        Ok(reader::GetResponse {
            status: 200,
            scope: self.scope.clone(),
            redirected: false,
            body: Chunks(
                serde_json::to_vec(&body)
                    .unwrap()
                    .chunks(7)
                    .map(Vec::from)
                    .collect(),
            ),
        })
    }
}
fn exact_costs(row: &Value) {
    for (i, cost) in COSTS.iter().enumerate() {
        assert_eq!(
            row["maintenance"][i]["cost"].as_number().unwrap().as_str(),
            *cost
        );
    }
}
#[tokio::main(flavor = "current_thread")]
async fn main() -> Check<()> {
    let out = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("Fresh output directory required")?,
    );
    let old_database = PathBuf::from(
        std::env::args()
            .nth(2)
            .ok_or("Published healthy legacy database required")?,
    );
    let fixtures = PathBuf::from(std::env::var("HOUSEATLAS_READER_FIXTURES")?);
    fs::create_dir(&out)?;
    let old_bytes = fs::read(&old_database)?;
    // Validate the untouched pre-change healthy JCS image, with no migration.
    type Store = s::AtlasStore<NativeContracts, SyntheticAuthority, SyntheticClock>;
    Store::validate_existing_recovery_image(&old_database, &NativeContracts, &mut || Ok(()))?;
    assert_eq!(fs::read(&old_database)?, old_bytes);
    let registration: reader::SourceRegistration = serde_json::from_value(json!({
        "workspaceId":id(1),"homeId":id(2),"sourceInstanceId":id(3),
        "collectionId":"synthetic-cost/Σ","owner":"homebox",
        "partitionMode":"exclusive-home","allowedExternalIds":[]
    }))?;
    let item = serde_json::from_slice(&fs::read(fixtures.join("item.detail.json"))?)?;
    let template: Value = serde_json::from_slice(&fs::read(fixtures.join("maintenance.json"))?)?;
    let maintenance = Value::Array(
        COSTS
            .iter()
            .enumerate()
            .map(|(i, cost)| {
                let mut entry = template[i % 3].clone();
                entry["id"] = json!(id(301 + i as u64));
                entry["cost"] = json!(cost);
                entry
            })
            .collect(),
    );
    let mut reader = reader::HomeBoxReader::new_stock(
        registration.clone(),
        StockFixture {
            scope: registration.scope(),
            item,
            maintenance,
        },
        ReaderClock,
        reader::Limits::default(),
        None,
    )?;
    let principal = s::VerifiedActor {
        workspace_id: id(1),
        home_id: id(2),
        actor_id: id(50),
    };
    let scope = s::Scope {
        workspace_id: id(1),
        home_id: id(2),
    };
    let partition = s::SourcePartition {
        workspace_id: id(1),
        home_id: id(2),
        source_instance_id: id(3),
        collection_id: registration.collection_id.clone(),
    };
    let runtime = SyntheticClock(Rc::new(Cell::new(20_000)));
    let path = out.join("projection-numbers.sqlite");
    let mut store = Store::open(
        &path,
        NativeContracts,
        SyntheticAuthority,
        runtime.clone(),
        s::StoreOptions::default(),
    )?;
    let durable = s::SourceRegistration {
        workspace_id: id(1),
        home_id: id(2),
        source_instance_id: id(3),
        collection_id: registration.collection_id.clone(),
        owner: s::SourceOwner::Homebox,
        partition_mode: s::PartitionMode::ExclusiveHome,
        allowed_external_ids: vec![],
    };
    store.register_source(&principal, &durable)?;
    let prepared = reader.prepare_publication(&mut store, &principal)?;
    let staged = prepared
        .fetch(&mut reader)
        .await
        .map_err(|error| error.to_string())?;
    let original = serde_json::to_value(&staged.generation().entities()[0])?;
    exact_costs(&original);
    staged.commit(&mut store)?;
    let state = store.read_cache_for_publication(&principal, &scope, &partition)?;
    assert_eq!(state.homebox_entities, vec![original.clone()]);
    exact_costs(&state.homebox_entities[0]);
    // The separate synthetic bootstrap entry also writes projection bodies.
    let snapshot = store.read_snapshot(&principal, &scope)?;
    let mut bootstrapped = Store::open(
        out.join("bootstrap.sqlite"),
        NativeContracts,
        SyntheticAuthority,
        runtime.clone(),
        s::StoreOptions {
            allow_synthetic_bootstrap: true,
            ..Default::default()
        },
    )?;
    bootstrapped.initialize_synthetic(&snapshot)?;
    let bootstrap = bootstrapped.read_cache_for_publication(&principal, &scope, &partition)?;
    assert_eq!(bootstrap.homebox_entities, vec![original.clone()]);
    bootstrapped.close()?;
    let image_path = out.join("recovery.sqlite");
    let image = store.backup_recovery_to(&image_path, &mut || Ok(()))?;
    let image_bytes = fs::read(&image_path)?;
    Store::validate_existing_recovery_image(&image_path, &NativeContracts, &mut || Ok(()))?;
    assert_eq!(fs::read(&image_path)?, image_bytes);
    store.close()?;
    let mut reopened = Store::open(
        &path,
        NativeContracts,
        SyntheticAuthority,
        runtime.clone(),
        s::StoreOptions::default(),
    )?;
    assert_eq!(
        reopened.read_cache_for_publication(&principal, &scope, &partition)?,
        state
    );
    reopened.close()?;
    let restored_path = out.join("restored.sqlite");
    fs::copy(&image_path, &restored_path)?;
    let mut restored = Store::open_existing_recovery_image(
        &restored_path,
        NativeContracts,
        SyntheticAuthority,
        runtime,
        s::StoreOptions::default(),
        &image,
        &mut || Ok(()),
    )?;
    assert_eq!(
        restored.read_cache_for_publication(&principal, &scope, &partition)?,
        state
    );
    // Actual Reader retained::previous reconstruction on the same reopened Store.
    let prepared = reader.prepare_publication(&mut restored, &principal)?;
    let retained = serde_json::to_value(&prepared.previous().entities()[0])?;
    exact_costs(&retained);
    assert_eq!(retained, original);
    drop(prepared);
    restored.close()?;
    assert_eq!(fs::read(&image_path)?, image_bytes);
    let db = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let body: String = db.query_row("SELECT body FROM projections", [], |r| r.get(0))?;
    exact_costs(&serde_json::from_str(&body)?);
    let evidence = json!({"costTokens":COSTS,"reader":"actual Reader92 stock decoder/publication/retained reconstruction", "nativeContracts":"actual native shape/full graph semantics", "storage":"bootstrap registration, original prepared fence commit, SQL body, authorized read, ordinary reopen, strict read-only image validation and strict image reopen pass", "legacyCompatibility":"untouched pre-change healthy JCS database validates with exact original bytes", "imageProfile":image.database_schema,"fixtureAuthority":"synthetic principal/clock/transport only; no production authorization claim", "heldControls":"unrun", "projection":original});
    fs::write(
        out.join("healthy-evidence.json"),
        serde_json::to_vec_pretty(&evidence)?,
    )?;
    println!("{evidence}");
    Ok(())
}
