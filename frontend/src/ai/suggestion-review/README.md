# Suggestion review presentation — first increment

This unmounted island is a LOCAL view/controller seam for #563, initially #564
inventory/duplicate candidates and #565 document categories/associations. It is
not the shared proposal/evidence wire envelope, its validator, an inference route
or a native/source write owner. The existing backend/source writer owns those
contracts. Maintenance, cited-answer and contradiction variants intentionally
remain unsupported until their agreed shared types are available.

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
only after an explicit action and successful current check. Fields/candidates
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

## Generated checks and boundaries

Proposed scoped non-device command, using the repository-pinned Node 26.10.0:

    node --test frontend/lantern-tests/ai-suggestion-review.test.mjs

Thirteen generated controller cases load the actual type-stripped controller:
explicit fields/edits, candidate selection, document pages, stale dismissal,
source revisions, A-B-A/late inspections, superseded checks, offline/disabled
states, availability interruption, repeat/re-entry, uncertain callback delivery,
dismiss/disposal and unavailable originals/abstention. No validation engine or
controller behavior is copied into the fixtures. Node stripping is not semantic
TypeScript checking; these cases do not mount React or establish DOM focus,
visual layout, accessibility interaction, native originals, inference quality
or device behavior.

The desktop executor is unavailable during preparation. These cases, semantic
typecheck, React rendering and builds are NOT RUN here. Hosted Actions are
billing-blocked; no retry/settings change is requested or bypassed.

Exactly six new source/documentation/fixture files are handed to the existing
#562 integrator. Shared manifest/test registration is deliberately UNAPPLIED and
owned by that composition lane. No existing Host/AI/offline/Library/Atlas source,
routes, credentials, runtime/account selection, grant or deployment is changed.
Shared-schema adaptation and actual host mount remain explicit dependencies.
