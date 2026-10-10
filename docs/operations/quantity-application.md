# Configured quantity application flow

The default server has no quantity installation selected. A trusted host can
mount original quantity configurations with `Host::with_quantity_installations`.
Each selection must belong to that host's actual Core Store and Access owners;
duplicate targets are refused. This mount creates no grant, artifact capture,
provider request or approval. Installed artifact, account/group/home mapping,
credentials, policy and native physical registration remain explicit inputs.

The browser sends no request merely by viewing a source. Explicit actions use:

- GET `/api/atlas/homebox/quantity/availability`, with the five original workspace,
  home, source instance, collection and entity query selectors. Source kind is
  fixed to HomeBox entity. Configured availability is not an installed runtime
  attestation or approval.
- POST `/api/atlas/homebox/quantity/preview`, with original source, safe integer
  quantity and unchanged reason. The server issues an original observation GET
  before constructing the full immutable wire, captures its preparation through
  a second GET, and qualifies the same original graph under current native Store
  and mutation Access fences. It returns original lexical quantity/dates, wire,
  exact PATCH effect and reviewed policy, with a finite remaining lifetime.
- POST `/api/atlas/homebox/quantity/approval`, with the exact preview, request,
  plan and policy bindings plus explicit acknowledgement. Human-required wire
  already contains an inert reserved receipt UUID. The authenticated POST creates
  consent custody; a separate current original physical phase issues the matching
  closed receipt. An ID or serialized response cannot issue that authority.
- POST `/api/atlas/homebox/quantity/dispatch`, with the same bindings and issued
  receipt ID, or null for explicit no-human policy. Atomic native admission spends
  genuine approval and produces the original one-shot invocation. Only that
  invocation can enter the consuming native driver and private evidence owner.

All routes retain normal same-origin, session and CSRF behavior. Intake rejects
unknown/repeated fields and bounds preview to 16 KiB, later POSTs to 4 KiB, and
responses to 1 MiB. The server retains at most sixteen active original workers,
with four queued commands each. Workers keep original reader, principal, capture,
prepared graph and receipt allocations on their stack; no Store, Access or Core
lock spans provider I/O. Preview lifetime is at most the configured 60-second
artifact/capture window. Scope/session/current-grant checks are repeated at
approval, dispatch and output.

An absent configured preview is 404. Quantity above the selected reviewed maximum
is refused with 422 before provider capture. Remaining preview lifetime must be
1 through 60000 milliseconds; a sub-millisecond remainder is refused. Availability
uses the native Editor prerequisite for a subsequent mutation POST, while that
POST still requires actual session, action, actor and grant authorization. This
prerequisite issues no approval.

Approval is distinct from invocation and native observation. Native reports and
original qualified readback bytes are retained privately before journal awaits.
Their custody is in memory, not a durable raw-evidence archive. Invoked activity
remains EndUnproven and keeps the physical hold; HTTP success and readback
agreement prove neither termination, causality nor provider compare-and-set.
The result is the unchanged stock outcome and does not update cached quantity.

Failed output can follow approval, SQL commitment or provider I/O. Unavailable
responses establish no rollback or safe retry. Approval and dispatch are each
attempted once per original worker; replacement sessions cannot use the original
captured grants. Historical/replay adoption, restored authority and automatic
retry are absent.

Source compilation and bounded reviews cover this composition. The separately
inspected frontend positive used fake HTTP only. No new human issuer/native I/O
runtime positive or live provider activation is established by these source
checks. Those require an inspected ordinary fixture and actual configured inputs.
