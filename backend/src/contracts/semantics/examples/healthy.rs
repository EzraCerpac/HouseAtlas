//! Explicit published healthy fixture parity only. No held control execution.
//! Expected values are committed offline references; Rust never invokes JS.
use houseatlas_backend::contracts::{
    AtlasRecord, BatchMutation, Contract, HttpHistory, Mutation, MutationResult, RecordRef, Scope,
    Snapshot, decode,
    semantics::{
        FinalMutation, MutationTarget, PriorRecord, assert_transition_from_value, batch_digest,
        canonical_digest, mutation_digest, record_digest, reference_closure, timestamp_millis,
        validate_final_candidate, validate_history, validate_mutation_preconditions,
        validate_result, validate_snapshot,
    },
};
use serde_json::{Value, json};
use std::error::Error;

fn fixture<T: Contract>(bytes: &[u8]) -> Result<T, Box<dyn Error>> {
    Ok(decode(bytes)?)
}

fn ref_of(record: &AtlasRecord) -> Result<RecordRef, serde_json::Error> {
    let value = serde_json::to_value(record)?;
    serde_json::from_value(
        json!({"recordType": value["recordType"], "recordId": value["recordId"]}),
    )
}

fn current<'a>(
    snapshot: &'a Snapshot,
    target: &RecordRef,
) -> Result<Option<&'a AtlasRecord>, serde_json::Error> {
    for record in &snapshot.records {
        if ref_of(record)? == *target {
            return Ok(Some(record));
        }
    }
    Ok(None)
}

fn main() -> Result<(), Box<dyn Error>> {
    let golden: Value = serde_json::from_slice(include_bytes!("healthy.expected.json"))?;
    let inputs: [(&str, &[u8]); 3] = [
        (
            "plan-free.snapshot.json",
            include_bytes!("../../../../../packages/contracts/fixtures/plan-free.snapshot.json"),
        ),
        (
            "optional-geometry.snapshot.json",
            include_bytes!(
                "../../../../../packages/contracts/fixtures/optional-geometry.snapshot.json"
            ),
        ),
        (
            "import-remap.snapshot.json",
            include_bytes!("../../../../../packages/contracts/fixtures/import-remap.snapshot.json"),
        ),
    ];
    let snapshots = inputs
        .iter()
        .map(|(name, bytes)| {
            let snapshot = fixture::<Snapshot>(bytes)?;
            validate_snapshot(&snapshot)?;
            assert_eq!(
                canonical_digest(&serde_json::to_value(&snapshot)?)?,
                golden["snapshotDigests"][name]
                    .as_str()
                    .expect("named healthy digest")
            );
            println!("PASS native graph and published canonical digest: {name}");
            Ok(snapshot)
        })
        .collect::<Result<Vec<_>, Box<dyn Error>>>()?;
    let original = &snapshots[0];
    let candidate = &snapshots[2];
    let command = fixture::<Mutation>(include_bytes!(
        "../../../../../packages/contracts/fixtures/create-circuit.mutation.json"
    ))?;
    let result = fixture::<MutationResult>(include_bytes!(
        "../../../../../packages/contracts/fixtures/create-circuit.result.json"
    ))?;
    let record = serde_json::to_value(&result.record)?;
    let scope: Scope = serde_json::from_value(
        json!({"workspaceId": record["workspaceId"], "homeId": record["homeId"]}),
    )?;
    let target = MutationTarget {
        scope: scope.clone(),
        record: ref_of(&result.record)?,
    };
    let transition = validate_mutation_preconditions(original, None, &command, &target, &[])?;
    assert_eq!(
        assert_transition_from_value(None, &command, &target)?,
        transition
    );
    assert_eq!(
        timestamp_millis(record["createdAt"].as_str().expect("healthy createdAt")),
        golden["createdTimestampMillis"].as_i64()
    );
    println!("PASS native raw-current create and fixture Date.parse milliseconds");
    assert_eq!(
        json!({"nextRevision": transition.next_revision}),
        golden["createTransition"]
    );
    assert_eq!(
        mutation_digest(&target, &command, None, None)?,
        golden["createMutationDigest"]
            .as_str()
            .expect("healthy create digest")
    );
    validate_result(&result, PriorRecord::Absent)?;
    assert_eq!(
        record_digest(&result.record)?,
        serde_json::to_value(&result.audit)?["afterDigest"]
    );
    let mut created_candidate = original.clone();
    created_candidate.records.push(result.record.clone());
    validate_final_candidate(
        &created_candidate,
        &[FinalMutation {
            current: None,
            command: &command,
            target: &target,
        }],
    )?;
    println!(
        "PASS native healthy create preconditions, final graph/decision and committed audit result"
    );

    let batch = fixture::<BatchMutation>(include_bytes!(
        "../../../../../packages/contracts/fixtures/import-remap.batch.json"
    ))?;
    let batch_hash = batch_digest(&scope, &batch)?;
    assert_eq!(
        batch_hash,
        golden["batchDigest"]
            .as_str()
            .expect("healthy batch digest")
    );
    let created = batch
        .commands
        .iter()
        .filter(|entry| matches!(entry.command, Mutation::Create(_)))
        .map(|entry| entry.target.clone())
        .collect::<Vec<_>>();
    let targets = batch
        .commands
        .iter()
        .map(|entry| MutationTarget {
            scope: scope.clone(),
            record: entry.target.clone(),
        })
        .collect::<Vec<_>>();
    let priors = batch
        .commands
        .iter()
        .map(|entry| current(original, &entry.target))
        .collect::<Result<Vec<_>, _>>()?;
    for (index, ((entry, target), prior)) in
        batch.commands.iter().zip(&targets).zip(&priors).enumerate()
    {
        let transition =
            validate_mutation_preconditions(original, *prior, &entry.command, target, &created)?;
        let raw_current = prior.map(serde_json::to_value).transpose()?;
        assert_eq!(
            assert_transition_from_value(raw_current.as_ref(), &entry.command, target)?,
            transition
        );
        assert_eq!(
            json!({"nextRevision": transition.next_revision}),
            golden["batchTransitions"][index]
        );
        assert_eq!(
            mutation_digest(
                target,
                &entry.command,
                Some(&batch.batch_id),
                Some(&batch_hash)
            )?,
            golden["batchMutationDigests"][index]
                .as_str()
                .expect("healthy batch command digest")
        );
    }
    let final_commands = batch
        .commands
        .iter()
        .zip(&targets)
        .zip(&priors)
        .map(|((entry, target), prior)| FinalMutation {
            current: *prior,
            command: &entry.command,
            target,
        })
        .collect::<Vec<_>>();
    validate_final_candidate(candidate, &final_commands)?;
    let closure = reference_closure(&scope, original, Some(candidate), &batch.commands, None)?;
    assert_eq!(serde_json::to_value(closure)?, golden["closure"]);
    println!(
        "PASS native healthy import-remap transitions, guards, ordered final decisions, request digests and reference closure"
    );
    println!("PASS native raw-current import-remap transitions against published references");

    let histories: [(&str, &[u8]); 3] = [
        (
            "empty.audit-array.json",
            include_bytes!(
                "../../../../../packages/contracts/history/fixtures/empty.audit-array.json"
            ),
        ),
        (
            "recorded.audit-array.json",
            include_bytes!(
                "../../../../../packages/contracts/history/fixtures/recorded.audit-array.json"
            ),
        ),
        (
            "tombstone.audit-array.json",
            include_bytes!(
                "../../../../../packages/contracts/history/fixtures/tombstone.audit-array.json"
            ),
        ),
    ];
    let contexts: Value = serde_json::from_slice(include_bytes!(
        "../../../../../packages/contracts/history/fixtures/contexts.json"
    ))?;
    for ((name, bytes), context) in histories
        .into_iter()
        .zip(contexts["cases"].as_array().expect("healthy contexts"))
    {
        let history = fixture::<HttpHistory>(bytes)?;
        validate_history(&history)?;
        let wire = serde_json::to_value(&history)?;
        assert_eq!(
            Value::Array(
                wire.as_array()
                    .expect("history array")
                    .iter()
                    .map(|audit| audit["operation"].clone())
                    .collect()
            ),
            context["expectedOperations"]
        );
        if let Some(record) = context.get("committedRecord") {
            let committed = fixture::<MutationResult>(&serde_json::to_vec(
                &json!({"schemaVersion":1,
                "record":record, "audit":wire.as_array().expect("history array").last(), "replayed":false}),
            )?)?;
            let prior = if name == "tombstone.audit-array.json" {
                PriorRecord::Record(&result.record)
            } else {
                PriorRecord::Unspecified
            };
            validate_result(&committed, prior)?;
        }
        println!("PASS native recorded history and supplied committed result: {name}");
    }
    println!(
        "PASS native semantics: explicit healthy published fixtures only; held controls unrun"
    );
    Ok(())
}
