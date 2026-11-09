# Suggestion review presentation

This unmounted island is a LOCAL view/controller seam for #563, covering #564
inventory/duplicate candidates, #565 document categories/associations and #566
maintenance proposals. It is
not the shared proposal/evidence wire envelope, its validator, an inference route
or a native/source write owner. The existing backend/source writer owns those
contracts. Cited-answer and contradiction variants remain unsupported.

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
Periodic counts must be positive u32 integers. Incomplete user edits remain
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

## Generated checks and boundaries

Proposed scoped non-device command, using the repository-pinned Node 26.10.0:

    node --test frontend/lantern-tests/ai-suggestion-review.test.mjs

Twenty-three generated controller cases load the actual type-stripped controller:
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
must update its existing registration documentation/count (14 to 23); no new
selection or CI lane is introduced here.

The desktop executor is unavailable during preparation. These cases, semantic
typecheck, React rendering and builds are NOT RUN here. Hosted Actions are
billing-blocked; no retry/settings change is requested or bypassed.

Exactly six existing source/documentation/fixture files are handed to the existing
#562 integrator. Shared manifest/test registration is deliberately UNAPPLIED and
owned by that composition lane. No existing Host/AI/offline/Library/Atlas source,
routes, credentials, runtime/account selection, grant or deployment is changed.
Shared-schema adaptation and actual host mount remain explicit dependencies.
