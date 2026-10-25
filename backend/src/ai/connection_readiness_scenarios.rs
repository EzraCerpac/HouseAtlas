// Synthetic readiness DTO scenarios for #295; no runtime is installed or called.
use crate::ai::connection::*;

fn qualified_snapshot() -> ConnectionSnapshot {
    ConnectionSnapshot {
        method: ConnectionMethod::SignInWithChatgpt,
        permission: InferencePermission::Granted,
        eligibility: Eligibility::Eligible,
        authorization: AuthorizationState::Connected,
        account: Some(AccountDisplay {
            account_id: "synthetic-account".into(),
            workspace_id: "synthetic-workspace".into(),
            label: "Synthetic account".into(),
        }),
        paid_use_admission: PaidUseAdmission::VerifiedZeroPaidUse,
        runtime: RuntimeSnapshot {
            kind: RuntimeKind::Local,
            route: RuntimeRoute::LocalInferenceCompanion,
            qualification: RuntimeQualification::Qualified,
            availability: RuntimeAvailability::Ready,
            checked_at: Some("2026-10-25T00:00:00Z".into()),
        },
        usage_supported: false,
    }
}

#[test]
fn helper_and_companion_availability_remain_independent_of_sign_in() {
    let qualified = qualified_snapshot();
    assert!(qualified.can_infer());
    for route in [
        RuntimeRoute::LocalSignInHelper,
        RuntimeRoute::IssuedWebsiteClient,
        RuntimeRoute::LocalInferenceCompanion,
    ] {
        for availability in [
            RuntimeAvailability::Unknown,
            RuntimeAvailability::Sleeping,
            RuntimeAvailability::Unreachable,
        ] {
            let mut unavailable = qualified.clone();
            unavailable.runtime.route = route;
            unavailable.runtime.availability = availability;
            // Account, consent and spending admission are still present;
            // none substitutes for the current runtime observation.
            assert_eq!(unavailable.authorization, AuthorizationState::Connected);
            assert!(!unavailable.can_infer(), "{route:?}/{availability:?}");
            let wire = serde_json::to_value(&unavailable).unwrap();
            let restored: ConnectionSnapshot = serde_json::from_value(wire).unwrap();
            assert_eq!(restored, unavailable);
            assert!(!restored.can_infer());
        }
    }
    // Exiting a bootstrap helper does not itself observe a companion or
    // qualify a runtime, even when identity sign-in succeeded.
    let mut bootstrap = qualified;
    bootstrap.runtime.route = RuntimeRoute::LocalSignInHelper;
    bootstrap.runtime.qualification = RuntimeQualification::Held;
    bootstrap.runtime.availability = RuntimeAvailability::Unknown;
    bootstrap.runtime.checked_at = None;
    assert!(!bootstrap.can_infer());
}

#[test]
fn account_consent_runtime_and_spending_are_separate_readiness_facts() {
    let qualified = qualified_snapshot();
    let mut cases = Vec::new();
    let mut account_only = qualified.clone();
    account_only.account = None; // Account-only observation has no workspace.
    cases.push(("account-only identity", account_only));
    for permission in [InferencePermission::Unknown, InferencePermission::Denied] {
        let mut snapshot = qualified.clone();
        snapshot.permission = permission;
        cases.push(("missing inference permission", snapshot));
    }
    for authorization in [
        AuthorizationState::Unconfigured,
        AuthorizationState::SignInRequired,
        AuthorizationState::Expired,
    ] {
        let mut snapshot = qualified.clone();
        snapshot.authorization = authorization;
        cases.push(("missing current authorization", snapshot));
    }
    let mut spending_held = qualified.clone();
    spending_held.paid_use_admission = PaidUseAdmission::Held;
    cases.push(("spending admission held", spending_held));
    let mut runtime_held = qualified.clone();
    runtime_held.runtime.qualification = RuntimeQualification::Held;
    cases.push(("runtime not qualified", runtime_held));
    let mut no_runtime = qualified.clone();
    no_runtime.runtime.route = RuntimeRoute::Unset;
    cases.push(("no selected runtime", no_runtime));
    for (scenario, snapshot) in cases {
        assert!(!snapshot.can_infer(), "{scenario}");
    }
    // These successful synthetic predicates neither make a request nor
    // establish a real account's eligibility, model list or completed turn.
    assert!(qualified.can_infer());
}
