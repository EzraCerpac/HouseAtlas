// Exact, separately selected synthetic denial regression. No aggregate alias,
// CI registration, socket, live credential/provider, expiry/replay/revocation,
// fault/crash, mutation or adversarial case is provided by this entrypoint.
#[test]
fn live_authorization_begin_is_refused_without_replacing_original_attempt() {
    super::healthy_examples::check_live_authorization_begin_refusal();
}
