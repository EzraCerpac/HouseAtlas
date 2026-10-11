# Native owner composition

Core and the durable HomeBox host share one `Arc<Mutex<Store>>` and one Access
owner. The trusted `Core::durable_homebox_stock_host` constructor checks that
Store's Access identity and passes those same allocations to the existing
durable queue; it opens no database and supplies no missing write qualification.
All durable aliases must be drained before recovery can close the Store.

Existing-asset review now produces an opaque `AssetReviewQualifiedCompletion`
only after genuine Store receipt, successor, Media release and read transaction
completion. A Store identity token compares allocations, not physical database
labels. Public commit DTOs and old observation tuples cannot construct it.

`Host::with_native_media_archive` captures that identity directly from its
configured Store and selects a dedicated actual native descriptor, independently
admitted origin, retention scopes and optional complete reference generation.
The default has no archive. The concrete Media publisher accepts only the opaque
completion plus the live original review proof and mutation guard. It checks the
complete catalog before publication and after file/directory sync. Root invokes
it under Core → Store → Access → owner → native custody; callbacks do not
reenter Store or Access. Commit correlation DATA is preserved before consuming
the carrier. Publication or later HTTP failure can follow durable SQL/archive
and never establishes rollback or retry safety.

Fresh publication emits an immutable complete generation. The concrete reader
checks a new descriptor against that genuine reference. Cold-start configuration
must independently admit the real deployment/physical database/archive mapping
and complete producer generation outside the candidate archive or recovered SQL.
Candidate scans, origin labels and calculated hashes do not authenticate it.
Upload publication uses `AssetUploadQualifiedCompletion`, issued only after
the same Store's strict consumed-upload linkage, current asset and original
runtime byte checks complete. The configured publisher also borrows the actual
stage and original mutation guard. Root preserves committed DATA before owner
locking and publication, and publishes before stage cleanup. Archive-only work
has a separate cooperative budget; no postcommit error implies rollback. The
private disposition conservatively records HTTP delivery as not established.
Raw commit/stage pairs cannot construct the carrier. Legacy recovery stays held.
Native temporary stage directories explicitly request mode 0700 without changing
the process mask or weakening descriptor checks.

The configured HomeBox reader captures actual fixed entity/maintenance GETs
before preparation. `NativeReadCapture` retains original bytes, retrieval time
and original opaque source/partition handles. The existing graph owner resolves
observed members and authorizes the complete original graph, after which
`bind_prepared` consumes the capture into the existing Domain read dispatcher.
Access locks end before GET awaits and semantic Store work. The five current
forms are entity tags, field list/get and maintenance list/get; source status
stays unresolved. `NativeReadCredentialConfig` retains bounded sensitive header
bytes supplied by trusted account/custody configuration. Each delivery uses the
same original principal and source/partition handles under an actual native
source-read fence; syntax validation authenticates no provider account.
`CapturedAccess::retain_original` imports those unchanged handles inside the
same principal's fenced authorization and issues no grant.

`Host::with_native_homebox_reads` correlates each endpoint/scope and mounts the
five forms only for matching configured homes. HTTP and owned MCP call the same
native graph consumer on a blocking worker; Core, Store and Access locks end
before GET awaits. The owner checks current registration/cache baseline and the
complete retained native result at disclosure. Credential deadlines reject late
delivery, but SQLite's existing synchronous fence is not preemptible. Real
account/enrollment, selected registration and custody inputs are still required;
the default has no configured native read binding. The synthetic root example
uses fixed original GET bytes, while the provider positives exercise actual
credential-bearing loopback GETs. These do not qualify a live HTTPS provider.
This bounded stock mount requires the existing wire3 canonical UUID collection
identity. Other opaque source collection IDs stay unchanged and unavailable to
this mount; no adapter infers or replaces them.
This read implementation does not supply writer hidden-field, snapshot,
installed-build, impact or file-version qualification.

The retained preparation adapter now keeps the original opaque source evidence,
raw captures and actual native plan from the existing mandatory qualifier.
Revalidation uses that same owner and evidence, with no fresh capture. Domain's
closed original-preparation consumer additionally pins that exact carrier in
the original prepared graph and checks the real original mutation guard and
source/partition coverage. These adapters supply no write or enqueue authority.
Jobs initial enqueue still needs the complete write graph, hidden-field/full-
impact and approval producer. Read membership and public preflight digests
cannot supply those facts. The queue's
current immutable codec stores request metadata; initial preparation retention
needs an additive, explicitly admitted schema contract. Existing migration
checksums and original queue envelopes must remain unchanged. Profile 7 and
runtime recovery/restore controls remain held.

Saved receipt is an explicit passive action on a genuine current canonical
completion. It sends the original full submitted envelope to the separately
authorized retained-intent route, validates saved canonical wire/ordered children
and displays text. Scope/session identity masks stale results. It creates no
write, replay, retry, media proof or download authority; original Media release
and HTTP delivery remain not-established.
