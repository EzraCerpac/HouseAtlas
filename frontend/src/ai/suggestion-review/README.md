# Suggestion review presentation

This unmounted island is a LOCAL view/controller seam for #563, covering #564
inventory/duplicate candidates, #565 document categories/associations and #566
maintenance proposals, #567 cited answers and #568 comparison candidates. It is
not the shared proposal/evidence wire envelope, its validator, an inference route
or a native/source write owner. The existing backend/source writer owns those
contracts. Answer and comparison kinds are read-only.

## Integration contract

Adapt only a shared, validated and admitted proposal to SuggestionReviewView.
Keep its exact evidence/version/page references in the source-owned adapter;
local display keys are not canonical IDs or read grants. Do not pass raw model
output, URL handles, tools, approval challenges or account/session receipts.

The host owns one stable createSuggestionReviewController per proposal/context
above navigation/remounts, and disposes it on real retirement. The React
SuggestionReview consumes it without disposing a host's active controller.
Replace the opaque context allocation on every actor/home/session/selection
generation, including A-B-A; change revision/sourceSetRevision whenever exact
sources or proposal versions change. current() must be synchronous and
side-effect-free, and subscribe() must notify changes promptly. The controller
also suppresses superseded content on getSnapshot, without waiting for effects.

recheck is a read-only current-source/access/original-availability check, never
a receipt or approval. A stale/withdrawn proposal is held for dismissal, not
rebased. inspectSource resolves the exact original/version/page through its
existing qualified owner and honors cancellation. It may inspect admitted
historical evidence; it never follows a model URL or clamps an unavailable page.
Offline/disabled/unavailable review leaves manual app workflows untouched.

Accept selection for review and Reject emit a frozen authority:none user intent
only after an explicit action and successful current check. Fields, candidates and maintenance tasks
start unselected. Editing preserves raw text; the existing owner validates field
semantics and canonical candidate membership before staging its ordinary review/
native-source workflow. Consume occurs before callbacks; repeat, re-entry and
unconfirmed delivery cannot automatically replay. The intent ID is browser
correlation only, not approval authority or a domain idempotency receipt.
A callback acknowledgement is not a committed source outcome. No AiClient run,
openReview or resume method is called; existing consequential human-review
continuations, approvals, original custody and source writes remain unchanged.
Dismiss is local and emits no intent. Host callbacks must revalidate their own
current authority even if this view retires while delivery is in flight.

Evidence is rendered as React text, with source/retrieval dates independently
shown or Unknown, exact page/version, original availability, uncertainty and
uncalibrated model scores. Similar products are not identified as the same item.
Documentary associations do not establish tested wiring or physical placement.
No HTML insertion, arbitrary hyperlink, image/PDF renderer or live input exists.

## Maintenance local presentation contract

The canonical source remains backend/src/ai/suggestions/types.rs:
MaintenanceSuggestion carries candidate_ref, title, interval, conditions,
urgency and support. This island does not introduce a wire envelope.

The admitted maintenance view has empty fields/candidates and a maintenance
list (maximum 16). Each task has a local key; an owner-bound targetKey and
targetLabel; title; interval; conditions; urgency; reason; uncertainty;
evidenceKeys; and baselineDate. The adapter must bind candidate_ref to an
exact admitted target rather than infer a target from its label. Support
continues to refer to the existing exact version/page evidence. baselineDate
is exact source-owned display text or null (Unknown), never a generated date;
the canonical suggestion does not itself supply a service-history baseline.

Intervals retain periodic {every, unit}, conditional {condition}, or unknown.
Units are days/weeks/months/years/usage-hours; urgency is
unknown/routine/review-soon. Conditions retain separate exact strings.
Periodic counts must be canonical positive integers no greater than 100000. Incomplete user edits remain
raw drafts and cannot be accepted: switching to periodic introduces an empty
count and no selected unit, not a guessed default. Empty new conditions must
be completed or deliberately removed. Unknown remains a valid explicit value.

selectMaintenanceTask and editMaintenanceTask edit only local title, interval,
conditions and urgency. The target remains fixed. A maintenance review intent
adds a maintenance list of selected task keys, bound target keys and structured
edited values, with editedFields naming differences from the original proposal.
Reject sends an empty maintenance list. Existing inventory/document intents
do not acquire this property. All intents still have authority:none and the
existing source/context recheck and once-consumed delivery fence. No interval
is converted into a due date; neither selection nor delivery creates a task,
changes service history, schedules work or issues approval.

The source integration owner must extend disclosure and
frontend/src/ai/suggestion-adapter/session.ts before this variant can be
delivered: its current exact view-key decoder and result bindings still
refuse maintenance. Bind selected maintenance task keys/targets back to the
canonical proposal, validate structured user edits and preserve support and
all currentness fences. Do not treat this local view shape as wire authority.
That bridge, production mount and shared registration/manifest updates are
UNAPPLIED in this six-file increment.

## Cited answer local presentation contract

Answer is a read-only kind with empty fields/candidates, no maintenance property
and exactly one answer object. Its fields are:
- route: inventory, documents, maintenance, electrical, network, clarify or unknown;
- coverage: partial or no-answer (never exhaustive);
- rankedCandidates: ordered {key, label} objects, at most 32 unique local keys;
- statements: at most 16 {key, text, reason, uncertainty, evidenceKeys} objects;
- missingEvidence: at most 16 nonempty source-owned strings.

The existing source owner maps canonical ProposalResult::Answer.route/coverage
directly; ranked_refs to rankedCandidates in the same original order and through
its admitted input bindings; SupportedText.text/support to statement text,
rationale, qualitative uncertainty and exact evidence references; and the
proposal-level missing_evidence to missingEvidence. Local keys are display
bindings only, not canonical authority, identity confidence, URLs or read grants.
The adapter must preserve exact source record versions, dates, page/section and
support/claim joins in sources/evidenceKeys. Do not manufacture missing metadata.
Statements require resolved nonempty evidence. Supported text is limited to 2048
UTF-8 bytes and rationale/missing-evidence text to 1024; prohibited controls and
lone surrogates refuse. Unknown uncertainty is displayed explicitly.

No-answer has no statements; partial has at least one. Clarify/unknown routes
cannot contain statements. An empty answer requires missing-evidence detail.
Sources may be empty only for an unsupported/no-answer display; such absence
does not establish completeness, access or a fresh source observation. Ranking
is displayed without changing order, introducing selection, or upgrading it
to identity, probability or approval. Electrical/network limitations are visible
beside the answer; documentary text establishes no tested circuit, safe breaker,
physical route or instruction to operate equipment.

All answer edit/select methods refuse and decide returns without recheck,
consumption or onIntent, including direct accept/reject calls. The component
renders no accept/reject/edit controls for answers. Only exact owner-authorized
source inspection and local dismissal remain. Existing current generation,
source revision, availability, cancellation and stale/historical-inspection
contracts apply. Withdrawn/unavailable originals cannot be opened, and a replaced
context cannot resurrect on late completion. React renders text, never retrieved
HTML, tool calls, hyperlinks or permissions. There is no question box/inference,
new host port, persisted answer, native action or production route.

The #562 integrator must add canonical disclosure and strict session-decoder
answer projection with exact source/rank joins, and must ensure any answer
session's public review API also refuses intent delivery. Those shared files
remain UNAPPLIED here. This donor does not supply model eligibility, routing/
groundedness evaluation, live host mounting, API admission or acceptance.

Seven authored answer cases add partial ordered/cited/inert data and no-intent
actions, empty no-answer/clarify/unknown routes, exact/historical/unavailable
source inspection, source/account replacement with cancelled late inspection,
offline/disabled dismissal, bounded/refused shapes, and a deterministic source
contract for read-only controls and electrical/network qualifiers. The last
case reads source text only; it is not mounted React or a rendered UI result.

## Comparison candidate local presentation contract

The contradictions kind is a read-only inspection seam, not a correction or
conflict-resolution workflow. It has empty fields/candidates, no maintenance or
answer property, and one contradictions object with:

- findings: at most 16 {key, pattern, assertions, rationale, uncertainty};
- missingEvidence: at most 16 nonempty source-owned strings.

pattern is incompatible-location, conflicting-association or
possible-supersession. Each finding has at most 16 assertions and must involve
at least two distinct owner-bound inputKey values. Each assertion is exactly
{key, inputKey, text, uncertainty, factDate, evidenceKeys}. Finding and assertion
uncertainty are the canonical qualitative tentative/ambiguous/unknown values,
not scores or measured confidence. Assertion text is at most 2048 UTF-8 bytes;
rationale/missing evidence are at most 1024. Date text, when actually known, is
nonempty and bounded to 256 UTF-8 bytes. Prohibited controls and lone surrogates
refuse. An empty finding list needs missing-evidence detail and is never proof
that records agree. Evidence references must resolve; overflow refuses rather
than truncating a side or inventing evidence.

The source integrator maps validated ProposalResult::Contradictions.findings
in original order. Bind each finding key to the corresponding existing
ReviewProposal.finding_keys entry (or an exact local alias); this UI does not
compute it or persist deduplication. Map pattern/rationale/uncertainty directly.
For every finding.claim_refs entry, preserve the referenced ExtractedClaim text,
qualitative uncertainty and all exact evidence_refs. Bind assertion.key to
claim_ref and inputKey to source_ref through source-owner mappings. Each
evidenceKeys entry must resolve to evidence from that SAME admitted input and
its exact target/version, never just a matching label. Local distinct input
strings and list uniqueness are presentation consistency checks, not native
identity, access, truth or deduplication authority. The Rust validator remains
the source of canonical two-input/finding-key admission.

sources retains source_date as Source date and retrieved_at as Retrieved,
with exact recordVersion/page/section/excerpt/freshness/original availability.
factDate is separately owner-supplied known fact time or null (Unknown).
The canonical ExtractedClaim has NO fact-date field: the first canonical
adapter must use null unless the original qualified source owner supplies an
independent exact fact-time binding to that assertion/version. Never copy
source or retrieval time into factDate and never infer chronology, falsity,
superiority or a winner. Likewise, this contract supplies no invented
reviewed/tested/current-truth status; those are not fields on the canonical
finding/claim. Inspecting originals remains with the actual read owner.

The display preserves both/all assertions symmetrically, their exact citations,
why flagged, uncertainty and missing information. Pattern labels say Possible.
Compatible history or distinct same-name items may explain apparent differences.
Electrical/network comparison text establishes no tested wiring, safe breaker,
physical route or equipment instruction. All retrieved/model text is inert
React text, never HTML, URLs, permissions or tools. No claim is selected as right.

The controller refuses all edit/select/decide actions for contradictions before
recheck, consumption or onIntent, preserving the same answer no-intent guard.
The component exposes source inspection and local dismissal only. Dismissal
is not persistence, an accepted decision, audit history, deduplication or a
correction; a new independently admitted controller can still show the same
unresolved key. No winner/merge/delete/relink/correction API or control exists.
Current generation/source revisions, availability, source-owner inspection
and AbortSignal fences are retained. Stale admitted history can still be
inspected through its owner; unavailable/withdrawn originals cannot open, and
an actually retired/revoked context is synchronously hidden and cannot return
on late completion. This island issues no Access/read grant.

The sole #562 integrator must add the canonical disclosure/session mapping and
strict nested decoding; preserve exact claim/input/evidence/finding-key joins;
require independent current source/access checks on disclosure and inspection;
and defensively refuse public comparison review-intent APIs. Shared count docs
(32 to 39), matching manifest and composition remain UNAPPLIED here, as do real
host mounting and runtime binding. Existing correction/audit authority, accepted
decision persistence and repeated-evaluation deduplication are separate later
owner-bound gaps. Nothing here satisfies #568's consequential workflow,
deduplication, model-quality or installed/device acceptance.

Seven new generated cases cover exact two-side/source/fact/retrieval dates,
all patterns with unknown dates and compatible-history/distinct-item limits,
both-source inspection and stale/unavailable/withdrawn originals, corrected/
retired/replaced context with late cancellation, direct no-intent/offline/local
dismissal, bounded malformed payload refusal, and source-only control/date/
qualification presentation. They test no conflict detector or truth resolution.
The source-text contract is not React rendering or mounted interaction.

## Generated checks and boundaries

Proposed scoped non-device command, using the repository-pinned Node 26.10.0:

    node --test frontend/lantern-tests/ai-suggestion-review.test.mjs

Forty-one generated controller/source cases load the actual type-stripped controller:
explicit fields/edits, candidate selection, document pages, stale dismissal,
source revisions, A-B-A/late inspections, superseded checks, offline/disabled
states, availability interruption, repeat/re-entry, uncertain callback delivery,
dismiss/disposal, availability loss during uncertain handoff, and unavailable originals/abstention. No validation engine or
controller behavior is copied into the fixtures. Node stripping is not semantic
TypeScript checking; these cases do not mount React or establish DOM focus,
visual layout, accessibility interaction, native originals, inference quality
or device behavior.

Nine maintenance cases add periodic/conditional/unknown intervals, exact target/
evidence, explicit edits, incomplete-edit refusal, superseded manuals/context,
offline states, rejected/uncertain once-only intent, and bounded source shapes.
These are authored source cases, NOT executed results. The composition owner
must update its existing registration documentation/count (39 to 41 for this continuation); no new
selection or CI lane is introduced here.

The desktop executor is unavailable during preparation. These cases, semantic
typecheck, React rendering and builds are NOT RUN here. Hosted Actions are
billing-blocked; no retry/settings change is requested or bypassed.

Exactly six existing source/documentation/fixture files are handed to the existing
#562 integrator. Shared manifest/test registration is deliberately UNAPPLIED and
owned by that composition lane. No existing Host/AI/offline/Library/Atlas source,
routes, credentials, runtime/account selection, grant or deployment is changed.
Shared-schema adaptation and actual host mount remain explicit dependencies.


## Composed canonical-edit repair

The #562 integration repair shares controller validateMaintenanceValues with the
session adapter. Draft validity uses canonical UTF-8 text/interval bounds before
Accept or consumption. Invalid local edits remain held and editable; correction
can deliver once. CR and other disallowed controls refuse, while LF/TAB remain
valid. Actual/uncertain owner callback failure remains terminal, with no replay.
Two new controller cases cover canonical/CR rejection with correction and exact
UTF-8/interval boundaries. These and the composed session regressions are authored,
NOT RUN. Canonical disclosure/session binding is supplied by #562; the earlier
UNAPPLIED notes describe this donor's standalone six-file increment. Real ports,
application activation, task creation/scheduling and native authority stay unbound.

## Donor composition provenance

Before adding answer behavior, this branch copies exactly the controller,
README and existing test bodies from #562 at
2e3f7f343be83d17c4f58676b9e7ce15c82eae1d. The separate preservation commit
retains the integration-owned canonical maintenance edit repair, including CR/
UTF-8/interval bounds and its two authored cases. No unrelated #562 source,
runner, manifest, backend or private ancestry is merged into this donor.
The following answer commit changes only these same six owned paths.

## Comparison continuation provenance

This increment continues eb217ae3f44287bd383c80d5f3eef7e818a2f442.
All six owned preimages match #562 at
b43e8c0d1ede78cce3cc748e56671932780d476a. No additional repair is copied from the
integration branch and none of its backend/adapter/runner/manifest changes is
merged here. Existing inventory/document/maintenance behavior, canonical
pre-consumption maintenance validation and read-only answers are retained.
Only the same six owned files change; all original corpus files stay untouched.
All 39 authored cases and semantic compiler/build/React/device checks are NOT RUN.

## Explicit same-product, unknown-identity relation

The local candidate relation same-product-identity-unknown displays
"Same product; physical identity unknown". It is a distinct admitted value,
not an alias or redefinition of same-product, possible-duplicate or
proposed-association. Existing relation values and labels remain unchanged.
Matching product evidence establishes neither the same nor distinct physical
item and grants no merge, deletion, relocation, source write or native action.

The source integrator maps the matching canonical SameProductIdentityUnknown
variant to this exact relation through its existing inventory-duplicate
disclosure/session binding. The candidate key, original canonical target,
evidence, uncertainty, currentness recheck and once-consumed authority:none
candidate-only intent remain unchanged. This local addition creates no wire
envelope, dispatcher, native effect or production mount.

Two new authored cases cover the explicit label via a source-text contract,
separate retained relationships, exact source inspection, original candidate/
proposal intent binding with once-only reentry, stale/replaced source context
and offline/disabled/unavailable refusal. There are 41 authored cases, all
NOT RUN; source-text inspection is not rendered UI evidence. Shared count
docs/manifests, canonical variant/disclosure/session composition and actual
qualification remain with #562's integrator.

This does NOT bridge the original inv-model-only corpus case: its manual is
a Document and Inventory still needs an InventoryItem subject. No original
is relabelled, physical subject invented, corpus mapping/count changed or
semantic/model-quality/native acceptance inferred. This continuation changes
only the necessary five owned source/doc/test paths; CSS is unchanged.
