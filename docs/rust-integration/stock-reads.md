# Native stock record reads

GET `/api/atlas/stock/v3/workspaces/{workspaceId}/homes/{homeId}/records/{recordType}/{recordId}`
maps an actual authenticated read request to the exact stock wire3 record-get
envelope. The route accepts the ten frozen Atlas record types and no query.
The server supplies a fresh correlation UUID, actual selected scope and the
caller path's target; it does not accept authority claims or issue mutation
capability. Malformed record targets use the same frozen shape validator and
422 category as canonical record target validation.

The domain owner's `NativeStockContract`, `prepare`, `dispatch` and `AtlasReads`
run directly with actual native contracts and SQLite. Root preparation retains
the original private access principal by reference, the exact accepted request,
and the complete actual authorized scoped snapshot. Storage can suppress denied
provider projections. Root capture conservatively authorizes every remaining
source/cache partition, binding source, evidence/attachment source, geometry
mapping, HomeBox source/native-link/parent, and Network relation/endpoint.
Original opaque grants are revalidated before deduplication; after sealing,
reads cannot acquire replacement or additional handles.

Release revalidates the actual principal and every original grant, compares
the current retained SQLite snapshot for exact equality and the owner's native
digest, recomputes the result through genuine `AtlasReads`, and requires exact
retained JSON equality. Target disclosure is restricted to the exact requested
record present in that pinned scope. Native digest equality alone would provide
the published JavaScript numeric equivalence, so exact retained-value equality
is separately required. This is equality plumbing, not another graph/schema
validator. An unrelated restricted source or any snapshot change can keep this
conservative whole-home profile unavailable.

The inspected healthy runner compares stock circuit and asset reads with actual
frozen SQLite reads after their fresh successful creates. Asset public payload
omits the private storage key; metadata read does not prove byte availability.
Only the separate actual media service supplies authorized original bytes.
The four added requests are sequential GETs; original commands run once in a
fresh disposable service. No synthetic principal, schema peer, storage owner,
grant, graph, or JavaScript semantic oracle supplies the running path.

This record-get binding supplies no stock mutation, provider query, presence
admission, whole-collection entitlement, approval or physical dispatch. The
domain's stock error-arm ordering correction is still outstanding; no error
arm or negative probe is executed. The separate bounded fresh native stock
transaction binding is documented in [stock-writes.md](stock-writes.md);
native audit history is documented in [stock-history.md](stock-history.md). Browser stock
forms/generated stock DTOs remain owner work. Concurrency, revocation, denial,
replay, guard controls and deployment qualification remain unrun.
