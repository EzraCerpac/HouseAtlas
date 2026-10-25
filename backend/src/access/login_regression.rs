//! Exact synthetic cases for login rate keys and multi-home issuance. The two
//! login rate cases are denial cases for the separate regression lane; the
//! client-key and multi-home cases are healthy. In-memory stores, a fixed clock
//! and synthetic identities only; no listener, provider or real credential.
//! docs/contributing/verification.md lists each exact command; run each only
//! by exact path with `-- --ignored --exact --test-threads=1`.

use std::{
    net::IpAddr,
    sync::{
        Arc,
        atomic::{AtomicI64, Ordering},
    },
};

use serde_json::json;

use super::{credentials::digest, *};
use crate::domain as d;

const ORIGIN: &str = "https://atlas.synthetic.invalid";
const PASSWORD: &str = "Synthetic-test-password-only!";
const WRONG: &str = "Synthetic-wrong-password-only!";
const NOW: i64 = 1_800_000_000_000;

fn id(n: u32) -> CanonicalId {
    CanonicalId::parse(format!("10000000-0000-4000-8000-{n:012}")).unwrap()
}

fn scope(home: u32) -> Scope {
    Scope {
        workspace_id: id(1),
        home_id: id(home),
    }
}

fn request(method: Method, cookie: Option<&str>) -> RequestEvidence<'_> {
    RequestEvidence {
        method,
        url: "https://atlas.synthetic.invalid/api/atlas/v1",
        origin: Some(ORIGIN),
        sec_fetch_site: Some("same-origin"),
        referer: None,
        cookie,
        csrf: None,
        authorization: None,
    }
}

fn setup() -> (AccessBoundary, Arc<AtomicI64>) {
    let clock = Arc::new(AtomicI64::new(NOW));
    let current = Arc::clone(&clock);
    let config = AccessConfig::new(vec![ORIGIN.to_owned()])
        .unwrap()
        .with_clock(move || current.load(Ordering::Relaxed));
    let mut boundary = AccessBoundary::in_memory(config).unwrap();
    boundary
        .provision_user(
            &id(4),
            &id(5),
            "synthetic-viewer",
            &hash_password(PASSWORD).unwrap(),
            None,
        )
        .unwrap();
    boundary
        .set_membership(&id(4), &scope(2), Role::Viewer, true)
        .unwrap();
    (boundary, clock)
}

fn login(boundary: &mut AccessBoundary, password: &str, client: &str) -> AccessResult<()> {
    let body =
        serde_json::to_vec(&json!({"username": "synthetic-viewer", "password": password})).unwrap();
    boundary
        .login(&request(Method::Post, None), &body, client)
        .map(|_| ())
}

#[test]
#[ignore = "Separate synthetic login rate denial regression lane; exact path only"]
fn another_clients_failures_do_not_lock_out_a_correct_password() {
    let (mut boundary, _) = setup();
    for _ in 0..10 {
        assert_eq!(
            login(&mut boundary, WRONG, "192.0.2.1"),
            Err(AccessError::Unauthenticated)
        );
    }
    // The failing client is capped, even with the correct password.
    assert_eq!(
        login(&mut boundary, WRONG, "192.0.2.1"),
        Err(AccessError::RateLimited)
    );
    assert_eq!(
        login(&mut boundary, PASSWORD, "192.0.2.1"),
        Err(AccessError::RateLimited)
    );
    // The account owner on another client still signs in.
    assert_eq!(login(&mut boundary, PASSWORD, "198.51.100.2"), Ok(()));
}

#[test]
#[ignore = "Separate synthetic login rate denial regression lane; exact path only"]
fn a_clients_own_failures_rate_limit_that_username() {
    let (mut boundary, clock) = setup();
    // A correct login starts the client attempt window before any failure.
    assert_eq!(login(&mut boundary, PASSWORD, "192.0.2.1"), Ok(()));
    clock.store(NOW + 200_000, Ordering::Relaxed);
    for _ in 0..9 {
        assert_eq!(
            login(&mut boundary, WRONG, "192.0.2.1"),
            Err(AccessError::Unauthenticated)
        );
    }
    // The attempt window expires; the later failure window does not.
    clock.store(NOW + 300_000, Ordering::Relaxed);
    assert_eq!(
        login(&mut boundary, WRONG, "192.0.2.1"),
        Err(AccessError::Unauthenticated)
    );
    clock.store(NOW + 300_001, Ordering::Relaxed);
    assert_eq!(
        login(&mut boundary, PASSWORD, "192.0.2.1"),
        Err(AccessError::RateLimited)
    );
    assert_eq!(login(&mut boundary, PASSWORD, "198.51.100.2"), Ok(()));
    // Successful logins never record a failure for their own client.
    assert_eq!(login(&mut boundary, PASSWORD, "198.51.100.2"), Ok(()));
    clock.store(NOW + 500_000, Ordering::Relaxed);
    assert_eq!(login(&mut boundary, PASSWORD, "192.0.2.1"), Ok(()));
}

#[test]
#[ignore = "Synthetic healthy client-key normalization case; exact path only"]
fn client_keys_normalize_ipv4_hosts_and_ipv6_prefixes() {
    let key = |peer: &str| client_key(peer.parse::<IpAddr>().unwrap());
    assert_eq!(key("192.0.2.7"), "192.0.2.7");
    assert_eq!(key("::ffff:192.0.2.7"), "192.0.2.7");
    assert_eq!(key("::192.0.2.7"), "192.0.2.7");
    assert_eq!(key("2001:db8:1:2::1"), "2001:db8:1:2::/64");
    assert_eq!(
        key("2001:db8:1:2::1"),
        key("2001:db8:1:2:ffff:ffff:ffff:ffff")
    );
    assert_ne!(key("2001:db8:1:2::1"), key("2001:db8:1:3::1"));
    // Every link-local peer shares one documented key.
    assert_eq!(key("fe80::1"), key("fe80::aaaa:bbbb:cccc:dddd"));
    assert_eq!(key("fe80::1"), "fe80::/64");
    assert_eq!(key("::1"), "::/64");
    assert_ne!(key("::1"), key("0.0.0.1"));
}

#[test]
#[ignore = "Synthetic healthy multi-home issuance case; exact path only"]
fn multi_home_capture_authenticates_once() {
    let (mut boundary, _) = setup();
    boundary
        .set_membership(&id(4), &scope(3), Role::Viewer, true)
        .unwrap();
    let body =
        serde_json::to_vec(&json!({"username": "synthetic-viewer", "password": PASSWORD})).unwrap();
    let receipt = boundary
        .login(&request(Method::Post, None), &body, "192.0.2.1")
        .unwrap();
    let cookie = receipt.set_cookie().split(';').next().unwrap();
    let configured: Vec<_> = [2, 9, 3]
        .into_iter()
        .map(|home| d::HomeSummary {
            scope: d::Scope {
                workspace_id: id(1).as_str().into(),
                home_id: id(home).as_str().into(),
            },
            label: format!("Synthetic home {home}"),
        })
        .collect();
    let requests = |boundary: &AccessBoundary| -> i64 {
        boundary
            .store
            .db
            .query_row(
                "SELECT count FROM access_rates WHERE bucket=?1",
                [digest(&format!("request:user:{}", id(4).as_str()))],
                |row| row.get(0),
            )
            .unwrap()
    };
    let homes = crate::app::capture_homes(
        &mut boundary,
        &request(Method::Get, Some(cookie)),
        &configured,
    )
    .unwrap();
    // The non-member home is skipped; the others keep configured order.
    assert_eq!(
        homes
            .iter()
            .map(|home| home.summary.scope.home_id.clone())
            .collect::<Vec<_>>(),
        [id(2).as_str(), id(3).as_str()]
    );
    for home in &homes {
        let selected = crate::app::access_scope(&home.summary.scope).unwrap();
        assert_eq!(home.principal.scope(), &selected);
        boundary.revalidate(&home.principal).unwrap();
    }
    assert_eq!(requests(&boundary), 1);
    boundary
        .authorize(&request(Method::Get, Some(cookie)), &scope(2), Action::Read)
        .unwrap();
    assert_eq!(requests(&boundary), 2);
}
