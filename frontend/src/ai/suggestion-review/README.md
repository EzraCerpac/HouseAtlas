# Suggestion review presentation

This unmounted island is a LOCAL view/controller seam for #563, covering #564
inventory/duplicate candidates, #565 document categories/associations and #566
maintenance proposals and #567 cited answers. It is
not the shared proposal/evidence wire envelope, its validator, an inference route
or a native/source write owner. The existing backend/source writer owns those
contracts. Contradiction presentation remains unsupported.

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

## Generated checks and boundaries

Proposed scoped non-device command, using the repository-pinned Node 26.10.0:

    node --test frontend/lantern-tests/ai-suggestion-review.test.mjs

Thirty-two generated controller/source cases load the actual type-stripped controller:
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
must update its existing registration documentation/count (25 to 32 for this continuation); no new
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
