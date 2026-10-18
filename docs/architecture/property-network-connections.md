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
