/** Presentation data supplied by the authorized owner, not a native wire schema.
 * Network graph coordinates, device names and source mesh IDs never locate hardware. */
export type NetworkConfidence = 'accepted' | 'recorded' | 'tentative' | 'unknown' | 'conflicting';
export type NetworkOverlaySelection = { readonly kind: 'device' | 'link'; readonly id: string };
export interface NetworkOverlaySource {
  readonly label: string;
  readonly revision: string | null;
  readonly recordedAt: string | null;
  readonly retrievedAt: string | null;
  readonly status: 'accepted' | 'recorded' | 'stale';
  readonly acceptedAt: string | null;
  /** Inventory record coverage, never a radio coverage measurement. */
  readonly coverage: 'complete' | 'partial' | 'unknown';
  readonly notes: string;
  readonly roomMappingReceipt?: { readonly id: string; readonly sha256: string };
}
export interface NetworkPlaceAssociation {
  /** Stable Atlas place ID only when actually reviewed; a room name is not an ID. */
  readonly placeId: string | null;
  /** Documentary Network room identity only; never a mesh or Atlas place ID. */
  readonly sourceRoomId: string | null;
  /** Canonical documentary place identity; never substituted for native placeId. */
  readonly sourcePlaceId?: string | null;
  /** Existing registry UUID, not a newly minted or persisted Atlas ID. */
  readonly sourcePlaceUUID?: string | null;
  /** Reviewed source plan references. Text anchors do not position devices. */
  readonly planAssociations?: readonly NetworkPlanAssociation[];
  readonly roomLabel: string;
  readonly detail: string;
  readonly confidence: NetworkConfidence;
  readonly basis: string;
  readonly floorKey: string | null;
  readonly mappingStatus: 'unmatched' | 'proposed' | 'accepted';
  /** No geometric placement supported by this documentary overlay. */
  readonly coordinate: null;
}
export interface NetworkPlanAssociation {
  readonly sourceAnchorId: string;
  readonly sourceFloorKey: string;
  readonly sourceFloorLabel: string;
  readonly sourceReference: string;
  readonly sourceHandle: string;
  readonly sourceSHA256: string;
  readonly mappingReceiptSHA256: string;
}
/** Exact owner-reviewed documentary context; separate from native place selection. */
export interface NetworkPackagePlaceSelection {
  readonly viewKey: string;
  readonly status: 'accepted' | 'proposed' | 'unmatched';
  readonly receiptId: string;
  readonly receiptSha256: string;
  readonly sourceAnchorIds: readonly string[];
  readonly targets: readonly { readonly packagePlaceKey: string; readonly packagePlaceUuid: string }[];
  readonly unresolvedLabels: readonly string[];
}
export interface NetworkOverlayDevice {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly mobility: 'fixed' | 'mobile' | 'nonspatial' | 'unknown';
  readonly confidence: NetworkConfidence;
  readonly notes: string;
  readonly place: NetworkPlaceAssociation | null;
}
export interface NetworkOverlayLink {
  readonly id: string;
  readonly fromEndpointId: string;
  readonly toEndpointId: string;
  readonly kind: 'connection' | 'segment-membership' | 'unresolved-path' | 'hypothesis';
  readonly medium: string;
  readonly confidence: NetworkConfidence;
  /** Preserve the source's confidence separately from curated uncertainty. */
  readonly sourceConfidence: string | null;
  readonly temporalStatus: string;
  readonly recordedAtPrecision: string | null;
  readonly basis: string;
  readonly recordedAt: string | null;
  readonly notes: string;
  /** Topology association only; never a cable route. */
  readonly path: null;
}
export interface NetworkOverlayEndpoint {
  readonly id: string;
  readonly label: string;
  readonly kind: 'segment' | 'interface' | 'named-endpoint' | 'unresolved';
  readonly ownerDeviceId: string | null;
  readonly notes: string;
}
export interface NetworkOverlayData {
  /** Fresh opaque owner identity; changed on session/scope/building/revision. */
  readonly viewKey: string;
  readonly source: NetworkOverlaySource;
  readonly devices: readonly NetworkOverlayDevice[];
  readonly links: readonly NetworkOverlayLink[];
  readonly endpoints: readonly NetworkOverlayEndpoint[];
}
export interface NetworkOverlayPanelProps {
  readonly active: boolean;
  readonly viewKey: string;
  /** Owner withholds data on revoked/expired/changed scope or unavailable source. */
  readonly data: NetworkOverlayData | null;
  /** Context only. Export labels never imply room-to-floor bindings. */
  readonly selectedFloor?: { readonly id: string; readonly label: string } | null;
  readonly selectedPlaceId?: string | null;
  /** Host validates full receipt membership and clears this on scope changes. */
  readonly selectedPackagePlaces?: NetworkPackagePlaceSelection | null;
  readonly onSelectionChange?: (selection: NetworkOverlaySelection | null) => void;
}
