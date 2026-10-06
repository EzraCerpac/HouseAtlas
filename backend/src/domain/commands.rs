use super::{
    AccessPort, BatchResult, Capability, CommandPort, ContractPort, ContractShape, DomainError,
    DomainResult, MutationOperation, MutationResult, RecordRef, Scope,
};
use serde_json::Value;

/// Immutable canonical command values after JSON parsing. The constructor
/// preserves the distinction between absent and explicitly null preconditions.
#[derive(Clone, Debug)]
pub struct CanonicalMutation {
    wire: Value,
    operation: MutationOperation,
}

impl CanonicalMutation {
    pub fn decode(wire: Value, contracts: &impl ContractPort) -> DomainResult<Self> {
        check_preconditions(&wire)?;
        contracts.validate(ContractShape::Mutation, &wire)?;
        let operation = serde_json::from_value(
            wire.get("operation")
                .ok_or(DomainError::InvalidContract)?
                .clone(),
        )
        .map_err(|_| DomainError::InvalidContract)?;
        Ok(Self { wire, operation })
    }

    pub fn wire(&self) -> &Value {
        &self.wire
    }

    pub fn operation(&self) -> MutationOperation {
        self.operation
    }

    fn check_target(&self, target: &RecordRef) -> DomainResult<()> {
        if matches!(
            self.operation,
            MutationOperation::Create | MutationOperation::Replace
        ) {
            let value_type = self.wire.pointer("/value/recordType");
            if value_type
                != Some(
                    &serde_json::to_value(target.record_type)
                        .map_err(|_| DomainError::InvalidContract)?,
                )
            {
                return Err(DomainError::InvalidContract);
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct CanonicalBatch {
    wire: Value,
    entries: Vec<(RecordRef, CanonicalMutation)>,
}

impl CanonicalBatch {
    pub fn decode(wire: Value, contracts: &impl ContractPort) -> DomainResult<Self> {
        // Match HTTP's missing-precondition classification before shape checking.
        if let Some(entries) = wire.get("commands").and_then(Value::as_array) {
            for entry in entries {
                check_preconditions(entry.get("command").ok_or(DomainError::InvalidContract)?)?;
            }
        }
        contracts.validate(ContractShape::BatchMutation, &wire)?;
        let entries = wire
            .get("commands")
            .and_then(Value::as_array)
            .ok_or(DomainError::InvalidContract)?
            .iter()
            .map(|entry| {
                let target = serde_json::from_value(
                    entry
                        .get("target")
                        .ok_or(DomainError::InvalidContract)?
                        .clone(),
                )
                .map_err(|_| DomainError::InvalidContract)?;
                let command = CanonicalMutation::decode(
                    entry
                        .get("command")
                        .ok_or(DomainError::InvalidContract)?
                        .clone(),
                    contracts,
                )?;
                command.check_target(&target)?;
                Ok((target, command))
            })
            .collect::<DomainResult<_>>()?;
        Ok(Self { wire, entries })
    }

    pub fn wire(&self) -> &Value {
        &self.wire
    }

    pub fn entries(&self) -> &[(RecordRef, CanonicalMutation)] {
        &self.entries
    }
}

fn check_preconditions(wire: &Value) -> DomainResult<()> {
    let fields = wire.as_object().ok_or(DomainError::InvalidContract)?;
    if !fields.contains_key("expectedRevision") || !fields.contains_key("guards") {
        return Err(DomainError::RevisionRequired {
            current_revision: None,
        });
    }
    if let Some(guards) = fields.get("guards").and_then(Value::as_array)
        && guards.iter().any(|guard| {
            guard
                .as_object()
                .is_some_and(|fields| !fields.contains_key("expectedRevision"))
        })
    {
        return Err(DomainError::RevisionRequired {
            current_revision: None,
        });
    }
    Ok(())
}

pub struct Commands<S, A, C> {
    pub store: S,
    pub access: A,
    pub contracts: C,
}

impl<S, A, C: ContractPort> Commands<S, A, C> {
    pub fn execute<P>(
        &mut self,
        principal: &P,
        scope: &Scope,
        target: &RecordRef,
        wire: Value,
    ) -> DomainResult<MutationResult>
    where
        S: CommandPort<P>,
        A: AccessPort<P>,
    {
        self.access
            .authorize(principal, scope, Capability::Mutate)?;
        self.contracts.validate(
            ContractShape::RecordRef,
            &serde_json::to_value(target).map_err(|_| DomainError::InvalidContract)?,
        )?;
        let command = CanonicalMutation::decode(wire, &self.contracts)?;
        command.check_target(target)?;
        // This is the only mutation call. Never reconstruct storage's candidate,
        // authorize from historical payloads, or perform a provider write here.
        let result = self.store.execute(principal, scope, target, &command)?;
        self.access
            .authorize(principal, scope, Capability::Mutate)?;
        self.access
            .revalidate(principal, scope, Capability::Mutate)?;
        Ok(result)
    }

    pub fn execute_batch<P>(
        &mut self,
        principal: &P,
        scope: &Scope,
        wire: Value,
    ) -> DomainResult<BatchResult>
    where
        S: CommandPort<P>,
        A: AccessPort<P>,
    {
        self.access
            .authorize(principal, scope, Capability::Mutate)?;
        let batch = CanonicalBatch::decode(wire, &self.contracts)?;
        let result = self.store.execute_batch(principal, scope, &batch)?;
        self.access
            .authorize(principal, scope, Capability::Mutate)?;
        self.access
            .revalidate(principal, scope, Capability::Mutate)?;
        Ok(result)
    }
}
