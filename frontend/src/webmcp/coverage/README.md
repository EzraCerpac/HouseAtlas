# Browser command coverage at PR39

Base: `501ccf6507d5924b7acf36675140294596e990a4` (merged PR39).
All added files stay in `frontend/src/webmcp/coverage/**`.

The existing `mountStockWebMcp` already exposes every current host-admitted arm.
There is no missing registered family for those 22 commands. This change adds
explicit service-family bindings and a reusable canonical renderer; it does
not increase the current host's tool or operation count. The existing admission
and native executor are authoritative, rather than catalog dispositions.

Sources inspected: `backend/src/http/agents/capabilities.rs`,
`agents/stock_dispatch.rs`, `agents/mod.rs`, `stock_mutations.rs::supported`,
`domain/stock/atlas_reads.rs`, `frontend/integration/{main,stock-dispatch,stock-schemas}`,
`frontend/src/app/StockApplication.tsx`, and the unchanged stock catalog/families.
Mounted MCP advertises only the same twenty reads; its POST Editor transport
principal does not add commands to that read catalog.

| Canonical family | Catalog arms | Current browser arms (Editor) | Remaining |
| --- | ---: | ---: | --- |
| `atlas_records` | 50 | 16 | 34 |
| `atlas_bindings` | 9 | 2 | 7 |
| `atlas_media_geometry` | 16 | 4 | 12 |
| `homebox_entities_locations` | 30 | 0 | 30 |
| `homebox_tags_fields` | 16 | 0 | 16 |
| `homebox_templates_types` | 10 | 0 | 10 |
| `homebox_files_links` | 14 | 0 | 14 |
| `homebox_maintenance` | 10 | 0 | 10 |
| `network_queries` | 3 | 0 | 3 |
| `homebox_product_features` | 6 | 0 | 6 |

Current Viewer: 20 reads across three tools. Current Editor: those reads plus
circuit creation and qualified classification replacement, still three tools.
The remaining 142 catalog arms are not browser-admitted. Of those,
`atlas.batch.execute` has a native root executor for nonempty identity-create-only
children, and `atlas.identity.create` is supported only as such a child. Neither
has independent host admission. No batch is advertised or executed by this lane.

## Additive owner mount proposal

Keep `SessionApp` and the existing `StockApplication` committed-context facade.
Inside `frontend/src/app/StockApplication.tsx`, the owner can import:

```tsx
import { bindAtlasService, CommandCoverageBoundary } from "../webmcp/coverage/index.js";
```

Inside `StockApplication`, memoize the bindings after obtaining `ports`:

```tsx
const bindings = useMemo(
  () => bindAtlasService(ports.service, ports.admission?.commandIds ?? []),
  [ports.service, ports.admission],
);
```

At this pinned host, the server's admission response carries exactly its current
supported native command IDs. If admission/service support diverges in a later
host, supply the service owner's exact support list instead. The new adapter
intersects that list with the facade's current admission; supplying a service
binding can never admit a command.

Replace only the existing `StockWebMcpBoundary` JSX and its completion child
with this JSX, preserving the surrounding owner error boundary and scope hooks:

```tsx
<CommandCoverageBoundary
  sessions={facade.sessions}
  schemas={ports.schemas}
  bindings={bindings}
  {...(Object.hasOwn(ports, "modelContext")
    ? { modelContext: ports.modelContext } : {})}
>
  {children(onScopeCommit)}
</CommandCoverageBoundary>
```

Do not add a second sibling stock mount: tool names are document-scoped. The
old exported `StockCompletionView` can remain for its existing consumers. Root
and existing WebMCP/application files are unchanged in this PR. The proposed
mount relies on the existing revision subscription, committed scope match,
actual application-session DTO, offline validator and same-origin dispatcher.
No authentication store, HTTP route, CSRF convention, grants or credentials are
added. Binding/support changes require fresh memoized bindings; login, logout,
rotation, scope and admission changes still revise the original facade.

`CommandCoverageBoundary` renders the entire canonical result inside the
existing peer's acknowledged subtree. Errors unmount that peer. The exact
request ID, command ID, scope, payload, optional/null fields, ordered records,
receipts, history entries, cursor, retry advice and outcomes remain untouched.
It interprets no business policy, synthesizes no success and starts no refresh.
`bindCommandFamilies(...).coverage()` reports current admission/binding only;
`admitted-and-bound` is not a claim that an operation has run or is live-qualified.

## Authorized healthy checks

After inspecting the scripts, activate the pinned Node/npm runtime and run:

```sh
npm --prefix frontend run typecheck
npm --prefix frontend run build
node --check frontend/src/webmcp/coverage/healthy-browser.mjs
node frontend/src/webmcp/coverage/healthy-browser.mjs
```

The new runner uses the locked Vite/React/Ajv dependencies. It compiles the
actual new TS/TSX, serves only generated fixture assets on ephemeral IPv4
loopback, and calls actual `document.modelContext.getTools/executeTool` in
Chromium 151.0.7922.173. No modelContext shim is used. The release guard uses the
same inspected DOMString IDL versions as the existing native browser runners.
The synthetic service port uses the unchanged first two native wire fixtures,
projections of the published healthy geometry/reconciliation snapshots, ten
empty history fixtures and one explicitly synthetic classification receipt.
The synthetic session is a port marker, never a credential, principal or grant.
There is no Rust/SQLite commit, login, new credential or provider request.

All 22 current native command arms execute through three registered families.
The runner compares the exercised IDs with the actual root admission source.
Checks validate shared input/output and advertised schemas, original application
session handoff, complete request/result equality, actual DOM completion before
native tool return, effect annotations (observable in this inspected browser),
absent session marker in public name/description/schema metadata,
164-row reporting with only 22 bound arms, and ordinary unmount cleanup.
History fixtures exercise empty first pages; populated/continuation history,
batch children, denied/error results, provider outcomes, rotation, revocation,
replay, races and fault/render-failure controls remain unrun. This proves browser
transport and rendering against healthy fixtures, not native service qualification.

The unchanged publication verifier rejects additive files until the root owner
adds their exact paths/modes/digests/ownership to
`docs/publication/source-manifest.json`. This lane cannot edit that file.
Both ordinary hosted workflows stop at that allowlist check. The root owner
must reseal the manifest and adopt the mount before this change becomes hosted
application coverage. Automatic Codex PR review is used; no duplicate manual
review request is sent.

## Per-command matrix

“Existing exposure” describes PR39's admitted browser schema, not execution in
this lane. Every exposed row below has a successful actual-browser healthy
fixture check in this lane; all blocked rows have no invocation. The catalog is
164 arms, not 164 live operations.

| Command | Family | Existing exposure | Service support / blocker and owner |
| --- | --- | --- | --- |
| `atlas.identity.get` | `atlas_records` | Viewer + Editor | Native record/history executor; healthy browser fixture passed |
| `atlas.identity.list` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.identity.history` | `atlas_records` | Viewer + Editor | Native record/history executor; healthy browser fixture passed |
| `atlas.identity.create` | `atlas_records` | Blocked | Root service/admission owner: child-only in the supported batch profile; no standalone executor/admission |
| `atlas.identity.replace` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.identity.tombstone` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.identity.restore` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.binding.get` | `atlas_bindings` | Viewer + Editor | Native record/history executor; healthy browser fixture passed |
| `atlas.binding.list` | `atlas_bindings` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.binding.history` | `atlas_bindings` | Viewer + Editor | Native record/history executor; healthy browser fixture passed |
| `atlas.binding.create` | `atlas_bindings` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.binding.review` | `atlas_bindings` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.binding.tombstone` | `atlas_bindings` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.binding.restore` | `atlas_bindings` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.evidence.get` | `atlas_records` | Viewer + Editor | Native record/history executor; healthy browser fixture passed |
| `atlas.evidence.list` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.evidence.history` | `atlas_records` | Viewer + Editor | Native record/history executor; healthy browser fixture passed |
| `atlas.evidence.create` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.evidence.tombstone` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.evidence.restore` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.location-semantics.get` | `atlas_records` | Viewer + Editor | Native record/history executor; healthy browser fixture passed |
| `atlas.location-semantics.list` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.location-semantics.history` | `atlas_records` | Viewer + Editor | Native record/history executor; healthy browser fixture passed |
| `atlas.location-semantics.create` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.location-semantics.replace` | `atlas_records` | Editor | Native scoped mutation executor; healthy browser fixture passed (no native write) |
| `atlas.location-semantics.tombstone` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.location-semantics.restore` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.circuit.get` | `atlas_records` | Viewer + Editor | Native record/history executor; healthy browser fixture passed |
| `atlas.circuit.list` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.circuit.history` | `atlas_records` | Viewer + Editor | Native record/history executor; healthy browser fixture passed |
| `atlas.circuit.create` | `atlas_records` | Editor | Native scoped mutation executor; healthy browser fixture passed (no native write) |
| `atlas.circuit.replace` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.circuit.tombstone` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.circuit.restore` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.valve.get` | `atlas_records` | Viewer + Editor | Native record/history executor; healthy browser fixture passed |
| `atlas.valve.list` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.valve.history` | `atlas_records` | Viewer + Editor | Native record/history executor; healthy browser fixture passed |
| `atlas.valve.create` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.valve.replace` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.valve.tombstone` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.valve.restore` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.relation.get` | `atlas_records` | Viewer + Editor | Native record/history executor; healthy browser fixture passed |
| `atlas.relation.list` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.relation.history` | `atlas_records` | Viewer + Editor | Native record/history executor; healthy browser fixture passed |
| `atlas.relation.create` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.relation.replace` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.relation.tombstone` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.relation.restore` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.geometry.get` | `atlas_media_geometry` | Viewer + Editor | Native record/history executor; healthy browser fixture passed |
| `atlas.geometry.list` | `atlas_media_geometry` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.geometry.history` | `atlas_media_geometry` | Viewer + Editor | Native record/history executor; healthy browser fixture passed |
| `atlas.geometry.create` | `atlas_media_geometry` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.geometry.tombstone` | `atlas_media_geometry` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.geometry.restore` | `atlas_media_geometry` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.asset.get` | `atlas_media_geometry` | Viewer + Editor | Native record/history executor; healthy browser fixture passed |
| `atlas.asset.list` | `atlas_media_geometry` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.asset.history` | `atlas_media_geometry` | Viewer + Editor | Native record/history executor; healthy browser fixture passed |
| `atlas.asset.create` | `atlas_media_geometry` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.asset.review` | `atlas_media_geometry` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.asset.tombstone` | `atlas_media_geometry` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.asset.restore` | `atlas_media_geometry` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.reconciliation.get` | `atlas_records` | Viewer + Editor | Native record/history executor; healthy browser fixture passed |
| `atlas.reconciliation.list` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.reconciliation.history` | `atlas_records` | Viewer + Editor | Native record/history executor; healthy browser fixture passed |
| `atlas.reconciliation.create` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.reconciliation.tombstone` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.reconciliation.restore` | `atlas_records` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.binding.remap` | `atlas_bindings` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `atlas.asset.download` | `atlas_media_geometry` | Blocked | Root service/admission owner: no executor binding in current native host (library/schema presence does not enable it) |
| `homebox.entity.get` | `homebox_entities_locations` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.entity.list` | `homebox_entities_locations` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.entity.history` | `homebox_entities_locations` | Blocked | HomeBox contract/provider owner: unsupported stock lifecycle/history/file/attachment form; do not widen capability |
| `homebox.entity.create` | `homebox_entities_locations` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.entity.update` | `homebox_entities_locations` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.entity.archive` | `homebox_entities_locations` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.entity.unarchive` | `homebox_entities_locations` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.entity.reparent` | `homebox_entities_locations` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.entity.delete` | `homebox_entities_locations` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.entity.restore-deleted` | `homebox_entities_locations` | Blocked | HomeBox contract/provider owner: unsupported stock lifecycle/history/file/attachment form; do not widen capability |
| `homebox.entity.duplicate` | `homebox_entities_locations` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.location.get` | `homebox_entities_locations` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.location.list` | `homebox_entities_locations` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.location.history` | `homebox_entities_locations` | Blocked | HomeBox contract/provider owner: unsupported stock lifecycle/history/file/attachment form; do not widen capability |
| `homebox.location.create` | `homebox_entities_locations` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.location.update` | `homebox_entities_locations` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.location.archive` | `homebox_entities_locations` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.location.unarchive` | `homebox_entities_locations` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.location.reparent` | `homebox_entities_locations` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.location.delete` | `homebox_entities_locations` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.location.restore-deleted` | `homebox_entities_locations` | Blocked | HomeBox contract/provider owner: unsupported stock lifecycle/history/file/attachment form; do not widen capability |
| `homebox.location.duplicate` | `homebox_entities_locations` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.entity.children.sync` | `homebox_entities_locations` | Blocked | HomeBox contract/provider owner: child sync requires native parent-location semantics revision; root provider executor unbound |
| `homebox.entity.mediated-history` | `homebox_entities_locations` | Blocked | Domain/provider/root owners: mediated-history ledger and provider activity binding not mounted |
| `homebox.location.children.sync` | `homebox_entities_locations` | Blocked | HomeBox contract/provider owner: child sync requires native parent-location semantics revision; root provider executor unbound |
| `homebox.location.mediated-history` | `homebox_entities_locations` | Blocked | Domain/provider/root owners: mediated-history ledger and provider activity binding not mounted |
| `homebox.entity.quantity.set` | `homebox_entities_locations` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.entity.type.set` | `homebox_entities_locations` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.location.tree` | `homebox_entities_locations` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.entity.path` | `homebox_entities_locations` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.tag.list` | `homebox_tags_fields` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.tag.get` | `homebox_tags_fields` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.tag.create` | `homebox_tags_fields` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.tag.update` | `homebox_tags_fields` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.tag.delete` | `homebox_tags_fields` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.entity.tags.get` | `homebox_tags_fields` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.entity.tags.set` | `homebox_tags_fields` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.entity.tags.add` | `homebox_tags_fields` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.entity.tags.remove` | `homebox_tags_fields` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.field.list` | `homebox_tags_fields` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.field.get` | `homebox_tags_fields` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.field.create` | `homebox_tags_fields` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.field.update` | `homebox_tags_fields` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.field.delete` | `homebox_tags_fields` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.entity.field-names` | `homebox_tags_fields` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.entity.field-values` | `homebox_tags_fields` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.file.list` | `homebox_files_links` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.file.get` | `homebox_files_links` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.file.upload` | `homebox_files_links` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.file.update` | `homebox_files_links` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.file.download` | `homebox_files_links` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.file.delete` | `homebox_files_links` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.file.replace-bytes` | `homebox_files_links` | Blocked | HomeBox contract/provider owner: unsupported stock lifecycle/history/file/attachment form; do not widen capability |
| `homebox.file.restore-deleted` | `homebox_files_links` | Blocked | HomeBox contract/provider owner: unsupported stock lifecycle/history/file/attachment form; do not widen capability |
| `homebox.document-link.list` | `homebox_files_links` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.document-link.get` | `homebox_files_links` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.document-link.create` | `homebox_files_links` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.document-link.update` | `homebox_files_links` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.document-link.delete` | `homebox_files_links` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.document-link.retarget` | `homebox_files_links` | Blocked | HomeBox contract/provider owner: unsupported stock lifecycle/history/file/attachment form; do not widen capability |
| `homebox.maintenance.list` | `homebox_maintenance` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.maintenance.get` | `homebox_maintenance` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.maintenance.create` | `homebox_maintenance` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.maintenance.update` | `homebox_maintenance` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.maintenance.schedule` | `homebox_maintenance` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.maintenance.complete` | `homebox_maintenance` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.maintenance.reopen` | `homebox_maintenance` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.maintenance.delete` | `homebox_maintenance` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.maintenance.attachment-upload` | `homebox_maintenance` | Blocked | HomeBox contract/provider owner: unsupported stock lifecycle/history/file/attachment form; do not widen capability |
| `homebox.maintenance.attachment-delete` | `homebox_maintenance` | Blocked | HomeBox contract/provider owner: unsupported stock lifecycle/history/file/attachment form; do not widen capability |
| `homebox.entity-type.list` | `homebox_templates_types` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.entity-type.create` | `homebox_templates_types` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.entity-type.update` | `homebox_templates_types` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.entity-type.delete` | `homebox_templates_types` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.template.list` | `homebox_templates_types` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.template.get` | `homebox_templates_types` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.template.create` | `homebox_templates_types` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.template.update` | `homebox_templates_types` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.template.delete` | `homebox_templates_types` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `homebox.template.create-item` | `homebox_templates_types` | Blocked | HomeBox/access/root owners: provider preparation, original approval, route/build binding, durable activity and dispatch/readback unbound |
| `atlas.binding.reassign-identity` | `atlas_bindings` | Blocked | Atlas policy owner: exceptional identity/purge policy unresolved; held in shared catalog |
| `atlas.asset.hard-purge` | `atlas_media_geometry` | Blocked | Atlas policy owner: exceptional identity/purge policy unresolved; held in shared catalog |
| `atlas.evidence.replace` | `atlas_records` | Blocked | Atlas contract/domain owner: append-only replacement forbidden; use new superseding records |
| `atlas.geometry.replace` | `atlas_media_geometry` | Blocked | Atlas contract/domain owner: append-only replacement forbidden; use new superseding records |
| `atlas.reconciliation.replace` | `atlas_records` | Blocked | Atlas contract/domain owner: append-only replacement forbidden; use new superseding records |
| `network.inventory.get` | `network_queries` | Blocked | Network/access/root owners: whole-collection disclosure, credential/runtime binding and TLS-profile reconciliation remain open |
| `network.snapshot.get` | `network_queries` | Blocked | Network/access/root owners: whole-collection disclosure, credential/runtime binding and TLS-profile reconciliation remain open |
| `network.history.get` | `network_queries` | Blocked | Network/access/root owners: whole-collection disclosure, credential/runtime binding and TLS-profile reconciliation remain open |
| `atlas.batch.execute` | `atlas_records` | Blocked | Root admission owner: absent admission; native executor restricts nonempty children to identity.create |
| `homebox.bulk.execute` | `homebox_product_features` | Blocked | HomeBox/root owners: proposal feature route, variant preparation, authority/approval and provider executor unbound |
| `homebox.import.csv` | `homebox_product_features` | Blocked | HomeBox/root owners: proposal feature route, variant preparation, authority/approval and provider executor unbound |
| `homebox.export.create` | `homebox_product_features` | Blocked | HomeBox/root owners: proposal feature route, variant preparation, authority/approval and provider executor unbound |
| `homebox.query.read` | `homebox_product_features` | Blocked | HomeBox/root owners: proposal feature route, variant preparation, authority/approval and provider executor unbound |
| `homebox.label.output` | `homebox_product_features` | Blocked | HomeBox/root owners: proposal feature route, variant preparation, authority/approval and provider executor unbound |
| `homebox.qrcode.render` | `homebox_product_features` | Blocked | HomeBox/root owners: proposal feature route, variant preparation, authority/approval and provider executor unbound |
