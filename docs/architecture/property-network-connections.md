# Network associations in the property view

The documentary source already retains the complete logical network. The room
projection places reviewed fixed-device records at room summary markers, while
the original links and endpoints remain in the documentary record ledger.
`documentaryOverlayIndex` deliberately supplies empty source-position arrays for
these summaries. A count marker therefore does not establish a device coordinate,
and an absent physical cable route does not erase a recorded logical connection.

`network-connections.ts` supplies the missing pure display association between
original topology and admitted markers. It consumes `DocumentaryNetworkGraph[]`
and `NetworkConnectionAnchor[]`. It does not map a second copy of the source,
change documentary records, open a native source, or calculate a graph layout.

The scene owner supplies each anchor's exact graph key, typed source node ID,
room ID, occurrence ID, camera-projected point, basis and qualification. It must
establish the source-to-room association using the existing reviewed projection
before supplying that anchor. A device label or matching raw ID from another
source is insufficient. The graph key must describe the same original source as
the documentary record used by the room summary. A `source-position` anchor must
come from an actually qualified source position; changing the basis of a summary
does not qualify it.

The result retains every original device, endpoint and link, with source facts
and qualification. Typed node keys include the graph namespace. Link keys also
include source array index and link ID, so reversed links and parallel links
remain separate records. Device references resolve before endpoint references,
as in the established network model helper. An endpoint can use its explicitly
recorded owner device's anchor only when that device exists in the same graph.
The endpoint and owner remain separate typed records.

Every original link has explicit resolved ends, placement reasons and all
admitted occurrence pairs. Both anchors are required to render an association.
Missing placement leaves the link in the output with its original provenance;
it never supplies a guessed location or an arbitrary unplaced dock in the model.
Coincident pairs are retained for the renderer to represent with an association
glyph or loop. All pairs span the property; selection affects highlighting and
must not filter the projection by building, floor or room.

The existing `networkSharedMediumAssociations` helper supplies separately
identified associations between devices with accepted memberships in the same
recorded segment and medium. These are shared-medium associations, not direct
cables. Their original membership link objects remain attached, and their
coverage count is separate from the original link count. The projection does
not locate the abstract segment or turn a shared medium into an electrical
circuit, cable chain, wireless coverage area or physical route.

Coverage reports total, anchored and unplaced counts separately for source
devices, endpoints and original links, plus a separate count for derived
shared-medium associations. An anchored endpoint may use its explicit owner's
room summary; the count never means a surveyed endpoint position. Renderers
should label the result as logical associations at room summaries and preserve
the source's kind, uncertainty, confidence and time qualification. Original
documentary unplaced counts remain factual physical-placement accounting and
are not reduced merely because a logical association can be drawn.

The named generated positive check is
`node frontend/lantern-tests/unified-atlas-network-connections-healthy.mjs`.
It covers both-anchored original links, explicit endpoint owners, independent
typed IDs, reversed and parallel links, multiple room occurrences and buildings,
within-room associations, separately counted shared media and source-qualified
coverage. It uses no native host, browser, provider, household data or external
transport. Ordinary success does not qualify actual source admission, physical
registration, current network state or runtime rendering.

The shared live/saved factual projector now supplies its own exact device record
keys and original-source SHA. `NetworkStageConnections` admits only a matching
room observation from that same source before using the existing occurrence
summary. It does not borrow a room from another observation or graph. The 3D
SVG decoration uses those camera-projected summaries, preserves every admitted
occurrence pair across the property, and keeps pointer events with the existing
stage controls. A coincident pair draws a loop; selection changes emphasis only.
Plan retains the separate logical graph. The layer key reports rendered original
connections and missing room associations separately from derived shared media.
Physical unplaced record accounting remains unchanged.

The existing `unified-atlas-overlay-source-healthy.mjs` positive additionally
passes the actual generated decoder/projector result through this join, checking
source-stamped keys, explicit endpoint owners, both self-link forms, complete
occurrence pairs and retained missing associations. Native lease/expiry and saved
identity admission remain with their existing owners. Current-household source
coverage and rendered browser pixels require their own retained evidence; these
generated checks establish neither.

## Route roots and the source root marker (#552)

A device in the documentary network route may carry `sourceRoot`, the source's
own root marker. It is optional and is the only optional device key; every other
device key stays required and unknown keys stay refused. When present it must be
a JSON boolean. `null`, strings, numbers, arrays and objects refuse the whole
documentary read, as any other malformed field does; nothing is coerced.
The admitted device keeps the field exactly: absent stays absent, and `true` and
`false` keep their value. The graph and the saved overlay copy carry the same
admitted device object and JSON unchanged.

The tap-to-trace route ends at the nearest root. A root is a device with
`sourceRoot: true`, or one whose kind names a router or gateway. `false` and an
absent field both leave a device unmarked; the kind rule still applies to it.
Among roots at equal route cost the source's mark ranks first, then router, then
gateway, then the lower node ID. Hop count and evidence are compared before rank.
Role, label, notes, graph degree and layout position never make a root.

Bytes without the field keep their earlier route, with one deliberate change:
a device whose kind names only a modem is no longer a root. The issue defines a
root as a router or gateway kind, or a device the source marks. A modem may
be in bridge mode in front of the actual router, so it becomes a root only when
its source marks it. A kind such as `modem-router` still names a router.

Only this documentary route admits the field. The inventory adapter and the
Rust network projection still refuse unknown device keys; extending them is a
separate change. Until then, those producers cannot mark a root.

The proposed host integration must call `currentStageTrace` during render to
admit a route only while its graph is shown with the exact data it traced.
The current host does not yet make that check. `publishStageTrace` compares the
graph key and data identity on withdrawal; it does not distinguish two owners
sharing both identities. `NetworkGraph` publishes and withdraws in layout effects,
but host retirement and first-frame behavior remain unverified.

The current host chooses the standalone graph only without a host lens; the
lens graph is in the alternative portal. The combined runtime graph list
deduplicates keys, and each graph invokes withdrawal directly in layout-effect
cleanup. These source facts do not establish a general mount-owner guarantee:
an independently delayed withdrawal from an earlier mount with the same key and
data can clear a later mount's route. The generated mounted fixture authors a
control for that limitation; it does not mount or qualify either host path.

`unified-atlas-network-source-root-healthy.mjs` contains authored controls for
generated bytes through the documentary decoder (accepted, absent, malformed
and wrong-type markers), root selection and pure retirement. It also renders
the stage as static server markup, which runs no effects and shows no frames.
These controls are unrun and establish no mounted behaviour, frame timing or
producer support.
