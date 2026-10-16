# Source Document service availability

The authenticated browser view responses for `GET /api/atlas/view` and
`GET /api/atlas/homes/{workspaceId}/{homeId}/view` include this optional extension
beside their existing scope and projection fields:

```json
{
  "sourceDocumentsService": {
    "profile": "houseatlas.geodata-document-read.v2",
    "available": true
  }
}
```

The exact profile names the existing native Document v2 read service. `available`
is true only when this Host selected that service and its full store still
matches the selected connection and original native Access and media owners.
An ordinary-profile Host emits the same object with `available: false`.
The existing view response supplies the workspace/home scope; this extension
does not select a different scope or expose a private storage identity.

A consumer can construct its optional v2 Document reader only after decoding
the exact supported profile and `available: true` from its current authenticated
view. An absent field on an older backend, an unknown profile or a false value
leaves that reader unavailable. Existing browser decoders that ignore unknown
top-level fields remain compatible. Session identity, `canEdit`, a ready view,
native Stock support or a successful offline qualification are insufficient to
infer this service selection. Replacing or withdrawing the owning view/session
must also withdraw the reader using its existing ownership and cancellation
rules; retaining this object is not a durable capability.

The field advertises the installed service, not permission to read a particular
Document or proof of a record, original, preview or source being available.
The view uses its existing authorization and delivery rechecks. Every Document
route retains its own current scope, session and native owner checks. This
extension grants no access and changes no route, data or persistent selection.

The ordinary application and Documents can share the explicitly selected full
native store described in [full Document server selection](full-document-server-selection.md).
The separate exclusive Document dataset router does not expose these ordinary
browser views. Offline copy, recovery or qualification does not select either
serving router or issue this browser advertisement. Code integration and the
generated healthy check do not establish any installed production capability.

The named generated full-profile example exercises both authenticated view
paths with an ordinary-profile false advertisement, a selected full-profile true
advertisement and a true advertisement after strict persistent full reopen.
It uses only its existing disposable synthetic data and native owners. Frontend
decoding and conditional mounting are separate consumer changes.
