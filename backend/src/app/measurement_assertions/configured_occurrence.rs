//! Configured producer pins are INPUTS, never startup/session authority.
//! Current entries reuse the exact Host allocations. Only separately configured
//! retained descriptors may open old producers, through existing validators.
use super::occurrence_authority::OccurrenceAuthority;
use super::*;
use crate::config::{
    atlas_scene::ServerAtlasSceneSelection,
    measurement_profile::{CapturedPublicationOwner, SelectedMeasurements},
    model_overview::ServerModelOverviewSelection,
};
struct ConfiguredInput {
    current: bool,
    owner: Option<Arc<OccurrenceAuthority>>,
}
pub struct ConfiguredOccurrences {
    inputs: Vec<ConfiguredInput>,
}
fn unavailable() -> s::Error {
    s::Error::new(
        "measurement-context-authority-unavailable",
        "Configured occurrence input unavailable",
    )
}
impl ConfiguredOccurrences {
    pub fn capture(
        selected: &SelectedMeasurements,
        scene: Arc<ServerAtlasSceneSelection>,
        overview: Arc<ServerModelOverviewSelection>,
    ) -> s::Result<Arc<Self>> {
        let mut inputs = Vec::new();
        let mut selectors = Vec::<Value>::new();
        for input in selected.inputs() {
            let current = matches!(input.owner(), CapturedPublicationOwner::Current);
            let capture = || -> s::Result<Arc<OccurrenceAuthority>> {
                let bytes = input.bytes().ok_or_else(unavailable)?;
                let (scene, overview) = match input.owner() {
                    CapturedPublicationOwner::Current => (scene.clone(), overview.clone()),
                    CapturedPublicationOwner::RetainedPublication { overview, scene } => {
                        // Executed ONLY by explicit later runtime selection.
                        // Never discover producer paths from stored receipts.
                        let overview = Arc::new(
                            ServerModelOverviewSelection::read_pinned(
                                &overview.path,
                                &overview.sha256,
                            )
                            .map_err(|_| unavailable())?,
                        );
                        let scene = Arc::new(
                            ServerAtlasSceneSelection::read_pinned(
                                &scene.path,
                                &scene.sha256,
                                &overview,
                            )
                            .map_err(|_| unavailable())?,
                        );
                        (scene, overview)
                    }
                };
                Ok(Arc::new(OccurrenceAuthority::capture_configured_input(
                    scene,
                    overview,
                    bytes,
                    input.sha256(),
                )?))
            };
            let owner = match capture() {
                Ok(owner) => Some(owner),
                Err(e) => {
                    if current {
                        return Err(e);
                    } else {
                        None
                    }
                }
            };
            if let Some(owner) = &owner {
                let selector = owner.configured_selector();
                if selectors.contains(&selector) {
                    return Err(unavailable());
                }
                selectors.push(selector);
            }
            inputs.push(ConfiguredInput { current, owner });
        }
        if !inputs.iter().any(|i| i.current && i.owner.is_some()) || inputs.len() > 64 {
            return Err(unavailable());
        }
        Ok(Arc::new(Self { inputs }))
    }
    fn primary(&self) -> s::Result<&ConfiguredInput> {
        self.inputs
            .iter()
            .find(|i| i.current && i.owner.is_some())
            .ok_or_else(unavailable)
    }
    fn selected(&self, selector: &Value) -> s::Result<&ConfiguredInput> {
        // A missing captured current owner is unavailable. An unmatched selector
        // is stale; native owner qualification still follows an exact match.
        self.primary()?;
        self.inputs
            .iter()
            .find(|i| {
                i.current
                    && i.owner
                        .as_ref()
                        .is_some_and(|o| o.configured_selector() == *selector)
            })
            .ok_or_else(|| {
                s::Error::new(
                    "measurement-context-stale-selection",
                    "Occurrence selection changed",
                )
            })
    }
    fn for_proposal(&self, p: &online::OnlineProposal) -> s::Result<&ConfiguredInput> {
        let raw = wire::parse(
            online::canonical_proposal(p)
                .map_err(|_| unavailable())?
                .as_bytes(),
        )
        .map_err(contract)?;
        self.inputs
            .iter()
            .find(|i| {
                i.current
                    && i.owner
                        .as_ref()
                        .is_some_and(|o| o.configured_target_matches(&raw["target"]))
            })
            .ok_or_else(unavailable)
    }
    fn qualify_request(
        &self,
        selected: &ConfiguredInput,
        guard: &a::TransactionAuthorization<'_>,
        p: &RequestPrincipal,
        f: &MeasurementNativeFacts,
    ) -> s::Result<OccurrenceAuthority> {
        let source = selected.owner.as_ref().ok_or_else(unavailable)?;
        let reference = source.qualify_configured_input(guard, p, f, selected.current)?;
        let mut retained = Vec::new();
        for input in &self.inputs {
            let Some(owner) = &input.owner else {
                continue;
            };
            if Arc::ptr_eq(owner, source) {
                continue;
            }
            // Optional owner failure stays unavailable. No fresh principal,
            // substituted current handles, retry or weakened mutation closure.
            if let Ok(owner) = owner.qualify_configured_input(guard, p, f, false) {
                retained.push(Arc::new(owner));
            }
        }
        reference.with_retained_reviews(retained)
    }
    fn inventory(
        &self,
        f: &MeasurementNativeFacts,
        r: &[Value],
    ) -> s::Result<MeasurementInventoryReport> {
        // This path NEVER dereferences opaque historical producer content.
        self.primary()?
            .owner
            .as_ref()
            .ok_or_else(unavailable)?
            .inventory(f, r)
    }
}
impl ReviewedOccurrenceAuthority for ConfiguredOccurrences {
    fn disclosure_target_pins(&self, selector: &Value) -> s::Result<Vec<Value>> {
        self.selected(selector)?
            .owner
            .as_ref()
            .ok_or_else(unavailable)?
            .disclosure_target_pins(selector)
    }
    fn occurrence_context(
        &self,
        g: &a::TransactionAuthorization<'_>,
        p: &RequestPrincipal,
        selector: &Value,
        f: &MeasurementNativeFacts,
        r: &[Value],
    ) -> s::Result<Value> {
        self.qualify_request(self.selected(selector)?, g, p, f)?
            .occurrence_context(g, p, selector, f, r)
    }
    fn materialize(
        &self,
        g: &a::TransactionAuthorization<'_>,
        p: &RequestPrincipal,
        proposal: &online::OnlineProposal,
        f: &MeasurementNativeFacts,
        r: &[Value],
    ) -> s::Result<MeasurementMaterial> {
        self.qualify_request(self.for_proposal(proposal)?, g, p, f)?
            .materialize(g, p, proposal, f, r)
    }
    fn qualify(
        &self,
        g: &a::TransactionAuthorization<'_>,
        p: &RequestPrincipal,
        phase: MeasurementPhase,
        proposal: &online::OnlineProposal,
        f: &MeasurementNativeFacts,
        m: &MeasurementMaterial,
    ) -> s::Result<()> {
        self.qualify_request(self.for_proposal(proposal)?, g, p, f)?
            .qualify(g, p, phase, proposal, f, m)
    }
    fn authorize_retained(
        &self,
        g: &a::TransactionAuthorization<'_>,
        p: &RequestPrincipal,
        phase: MeasurementPhase,
        f: &MeasurementNativeFacts,
        r: &[Value],
    ) -> s::Result<()> {
        self.qualify_request(self.primary()?, g, p, f)?
            .authorize_retained(g, p, phase, f, r)
    }
    fn authorize_disclosure(
        &self,
        g: &a::TransactionAuthorization<'_>,
        p: &RequestPrincipal,
        f: &MeasurementNativeFacts,
        r: &[Value],
    ) -> s::Result<()> {
        self.primary()?
            .owner
            .as_ref()
            .ok_or_else(unavailable)?
            .authorize_disclosure(g, p, f, r)
    }
    fn historical_association(
        &self,
        g: &a::TransactionAuthorization<'_>,
        p: &RequestPrincipal,
        f: &MeasurementNativeFacts,
        reference: MeasurementAssociationReference<'_>,
        r: &Value,
    ) -> s::Result<Value> {
        let selected = self.inputs.iter().find(|i| {
            i.owner
                .as_ref()
                .is_some_and(|o| o.configured_reference_matches(reference))
        });
        if let Some(selected) = selected
            && let Ok(owner) = self.qualify_request(selected, g, p, f)
        {
            return owner.historical_association(g, p, f, reference, r);
        }
        Ok(json!({"status":"unavailable","reason":"historical-mapping-owner-unavailable"}))
    }
}
impl crate::storage::MeasurementRecoveryEvidence for ConfiguredOccurrences {
    fn verify_retained(
        &self,
        f: &MeasurementNativeFacts,
        r: &[Value],
    ) -> s::Result<MeasurementInventoryReport> {
        self.inventory(f, r)
    }
}
