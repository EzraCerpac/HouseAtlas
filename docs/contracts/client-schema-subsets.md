# Browser schema resources

References #417. Source baseline: main
`73afa2059e57148988d5b4815679d59128ec68e9`, read 28 October 2026.
The technical handoff is [#417, 6470130133](https://github.com/EzraCerpac/HouseAtlas/issues/417#issuecomment-6470130133);
the separate increments follow [the ordered plan](https://github.com/EzraCerpac/HouseAtlas/issues/417#issuecomment-6467265175).
Design and feel remain with Claude. #481's single schema-text reference and lazy
quantity/admission readers are retained.

`contracts/stock-wire3/agent/agent.schema.json` and its adopted catalog remain
authoritative. `tools/client-schemas/generate.mjs` checks their adoption pins,
the frozen Atlas pin and the pinned-file v4 resource pin before deriving
`contracts/client-schemas/`. It never fetches schemas or changes those sources.
Run `node tools/client-schemas/generate.mjs` to update the checked-in artifacts.
Vite computes the same outputs and refuses stale checked-in bytes before
resolving client imports. The generator uses only Node standard libraries.

## Consumer audit

| Consumer | Required schema or catalog roots |
| --- | --- |
| `numeric/stock-ajv.ts`, `integration/stock-schemas.ts` | Shared Ajv resource; arbitrary catalog input/output refs and family input refs are supplied by the stock port. |
| `webmcp/stock.ts`, `webmcp/stock-schema.ts` | All 168 command input/output arms, all family input unions, `stockError`; browser descriptors retain the original batch specialization. Host admission is dynamic, so current configured support cannot justify pruning catalog arms. |
| `webmcp/coverage/families.ts`, `integration/stock-dispatch.ts`, `api/managed-download-client.ts` | Command IDs, family names, read/write effect and canonical input/output refs. The stock mount also reads confirmation. |
| `api/operation-history-client.ts` | The complete command ID enum, in original order; its local response schema is unchanged. |
| `api/retained-intent-client.ts` | `contextSelection`, every Atlas write input, command identity/authority/effect and output refs. All write results still use the closed exact evaluator. |
| `integration/editing-client.ts`, `integration/upload-place-evidence-client.ts`, capture drafts | Atlas `sourceRef`, `scope`, `recordRef`, `guard`, `license`, `location-semanticsRecord`, stock classification input/output and batch output. |
| `api/quantity-client.ts`, `webmcp/quantity/tool.ts` | Quantity-set request/result, Atlas `scope`/`sourceRef`; their local schemas remain unchanged. |
| `api/pinned-file-client.ts` | File-download v3 and pinned v4 request/capture result. V4's pointers into `homeboxTarget` and Atlas `sourceKey` retain their complete containing definitions. |
| Topology, geometry, evidence, native-place/evidence/scene clients | Their stock request refs are covered by the catalog; exact read/result/request/evidence roots come directly from the five closed maps in `numeric/schema-validator.ts`. |

The generated Ajv agent contains 423 of 459 definitions; the exact agent
contains 294. Each resource preserves every root keyword and assertion,
including the agent root request reference. This deliberately retains additional
request definitions. Each selected definition is copied whole and in source
order, without changing assertions, annotations, numeric constraints or refs.
The separate Atlas and pinned-file v4 resources remain intact.

Closure follows local and absolute references, escaped/deep pointers, nested
resource IDs and anchors. A visited set handles cycles without expanding them.
Dynamic or recursive scope keywords conservatively retain all supplied
documents' definitions; unresolved or ambiguous resources refuse generation.
There is no schema network fallback. The exact evaluator's existing fail-closed
keyword/ref checks and lazy compilation remain unchanged; its generated raw
bytes have a separate SHA-256 pin. Source and generated pins are recorded in
`contracts/client-schemas/pins.json`.

The catalog projection preserves every command and these consumed fields:
`commandId`, `authority`, `effect`, `inputSchema`, `outputSchema`,
`confirmation`, `toolFamily`. It preserves catalog-level version/status metadata.
These bytes establish neither admission nor service support. New consumers of
catalog metadata must extend the projection and its equivalence coverage.

## Coverage and remaining acceptance

The existing `healthy-read.mjs` lane calls `client-schema-subset.mjs` in process.
It checks deterministic bytes/pins, all copied definitions and requested roots,
the complete catalog projection, real scope/file v3/v4 validation and rejection
parity, and synthetic recursive/anchored/nested-resource reference behavior.
Existing numeric, quantity, retained-intent, pinned-capture, batch descriptor,
offline launch and frontend checks continue to exercise actual client imports.
Synthetic loaders now use the generated resources. No runner, workflow,
permission or browser selection was added.

Local implementation ran the artifact generator only, using installed Node
v24.19.0; no local build, typecheck, compilation or tests qualify this source.
Hosted CI uses the pinned Node v26.10.0 and verifies the candidate. Source-file
byte counts are not launch-bundle measurements. The exact candidate's hosted
launch raw/gzip comparison and offline/healthy outcomes remain to be recorded
when available. Broader #417 acceptance stays open. AI/PlaceEditor splitting
and a CI size-budget job are separate increments. Claude retains conflict/CI
repair, review and merge responsibility; device and design acceptance remain
separate.
