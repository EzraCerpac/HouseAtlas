//! Positive offline numeric adoption through the actual native stock reader.
//! No provider, store write, grant, listener or stopped control is exercised.
use super::*;
use serde_json::{Value, json};
use std::collections::VecDeque;

const COSTS: [&str; 7] = [
    "9007199254740993",
    "1e-1000",
    "0.123456789012345678901234567890",
    "12.50",
    "1.25e+06",
    "0",
    "-0.00",
];

fn uuid(n: u64) -> Uuid {
    Uuid::parse(&format!("00000000-0000-4000-8000-{n:012}")).unwrap()
}
struct FixedClock;
impl Clock for FixedClock {
    fn now(&self) -> Timestamp {
        Timestamp::parse("2026-10-07T10:00:00.000Z").unwrap()
    }
}
struct Chunks(VecDeque<Vec<u8>>);
impl Body for Chunks {
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, ReadError> {
        Ok(self.0.pop_front())
    }
}
struct StockFixture {
    scope: SourceScope,
}
impl Transport for StockFixture {
    type Body = Chunks;
    async fn get(&mut self, request: GetRequest) -> Result<GetResponse<Chunks>, ReadError> {
        assert_eq!(request.scope(), &self.scope);
        let item: Value =
            serde_json::from_slice(include_bytes!("../wire/fixtures/item.detail.json")).unwrap();
        let value = if request.path() == "/api/v1/entities" {
            let locations = request
                .query()
                .iter()
                .any(|(key, value)| key == "isLocation" && value == "true");
            let rows = if locations { vec![] } else { vec![item] };
            json!({"items":rows,"page":1,"pageSize":100,"total":rows.len()})
        } else if request.path().ends_with("/maintenance") {
            assert_eq!(request.query(), &[("status".into(), "both".into())]);
            let source: Value =
                serde_json::from_slice(include_bytes!("../wire/fixtures/maintenance.json"))
                    .unwrap();
            Value::Array(
                COSTS
                    .iter()
                    .enumerate()
                    .map(|(i, cost)| {
                        let mut entry = source[i % 3].clone();
                        entry["id"] = json!(uuid(301 + i as u64));
                        entry["cost"] = json!(cost);
                        entry
                    })
                    .collect(),
            )
        } else {
            assert_eq!(
                request.path(),
                format!("/api/v1/entities/{}", uuid(2).as_str())
            );
            item
        };
        Ok(GetResponse {
            status: 200,
            scope: self.scope.clone(),
            redirected: false,
            body: Chunks(
                serde_json::to_vec(&value)
                    .unwrap()
                    .chunks(7)
                    .map(|c| c.to_vec())
                    .collect(),
            ),
        })
    }
}

#[tokio::test(flavor = "current_thread")]
async fn healthy_stock_cost_tokens_survive_projection_contract_and_previous_generation() {
    let registration = SourceRegistration {
        workspace_id: uuid(1),
        home_id: uuid(2),
        source_instance_id: uuid(3),
        collection_id: "synthetic-cost/Σ".into(),
        owner: "homebox".into(),
        partition_mode: PartitionMode::ExclusiveHome,
        allowed_external_ids: vec![],
    };
    let mut reader = HomeBoxReader::new_stock(
        registration.clone(),
        StockFixture {
            scope: registration.scope(),
        },
        FixedClock,
        Limits::default(),
        None,
    )
    .unwrap();
    let generation = reader.fetch_generation(None, uuid(99)).await.unwrap();
    let projection = &generation.entities()[0];
    assert_eq!(projection.maintenance.len(), COSTS.len());
    let serialized = serde_json::to_vec(projection).unwrap();
    // The actual frozen projection decoder/encoder also retains numeric tokens.
    let contract =
        crate::contracts::decode::<crate::contracts::HomeboxProjection>(&serialized).unwrap();
    let encoded = crate::contracts::encode(&contract).unwrap();
    let encoded: Value = serde_json::from_slice(&encoded).unwrap();
    let mut retained_projection = projection.clone();
    // Same typed field reconstruction used by retained::projection, after its
    // native contract validation. No persisted observation is invented here.
    retained_projection.maintenance =
        serde_json::from_value(encoded["maintenance"].clone()).unwrap();
    for (i, token) in COSTS.iter().enumerate() {
        assert_eq!(
            projection.maintenance[i].cost.as_ref().unwrap().as_str(),
            *token
        );
        assert_eq!(
            encoded["maintenance"][i]["cost"]
                .as_number()
                .unwrap()
                .as_str(),
            *token
        );
        assert_eq!(
            retained_projection.maintenance[i].cost,
            projection.maintenance[i].cost
        );
    }
    assert_eq!(
        projection.source_updated_at.as_ref().unwrap().as_str(),
        "2026-01-02T03:04:05.1200+02:00"
    );
    assert_eq!(
        projection.maintenance[0]
            .scheduled_date
            .as_ref()
            .unwrap()
            .as_str(),
        "2026-02-01"
    );
    let previous =
        PreviousGeneration::new(generation.cache().clone(), vec![retained_projection], false);
    let before = json!({"cache":previous.cache(),"entities":previous.entities()});
    let next = reader
        .fetch_generation(Some(&previous), uuid(100))
        .await
        .unwrap();
    assert_eq!(next.entities()[0].maintenance, projection.maintenance);
    assert_eq!(
        json!({"cache":previous.cache(),"entities":previous.entities()}),
        before
    );
}

#[test]
fn healthy_nullable_cost_remains_unknown() {
    let raw = json!({"entryId":uuid(301),"name":"Unknown amount","description":"Synthetic","scheduledDate":null,"completedDate":null,"cost":null});
    let entry: Maintenance = serde_json::from_value(raw.clone()).unwrap();
    assert!(entry.cost.is_none());
    assert_eq!(serde_json::to_value(entry).unwrap(), raw);
}
