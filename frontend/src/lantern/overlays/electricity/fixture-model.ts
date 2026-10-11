import type { ElectricityFixtureLayerProps, ProjectedElectricalFixture } from './fixture-types';

const COLORS = ['#2f56e0', '#087f8c', '#8d4ab8', '#bb562e', '#388052', '#aa4275', '#74601e'];
export function electricalGroupColor(label: string | null): string {
  if (label === null) return '#65738a';
  let hash = 0;
  for (const character of label) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length]!;
}

/** Projection authority comes from an actual diagram registration or an explicit
 * preview of one proposed receipt, never from
 * a room alias, a source filename, a mesh ordinal or a document marker. */
export function registeredFixturePlacements(props: ElectricityFixtureLayerProps): readonly ProjectedElectricalFixture[] {
  const data = props.data;
  if (!props.active || !data || data.viewKey !== props.viewKey) return [];
  const used = new Set<string>();
  return props.placements.filter(placement => {
    const fixture = data.fixtures.find(candidate => candidate.id === placement.fixtureId);
    const receipt = data.registrationReceipts.find(candidate => candidate.id === placement.registrationReceiptId
      && candidate.sha256 === placement.registrationReceiptSha256);
    const region = data.regions.find(candidate => candidate.id === placement.regionId);
    if (!fixture || !receipt || !region || used.has(fixture.id)) return false;
    const reviewed = placement.basis === 'reviewed-approximate-diagram'
      && (receipt.status === 'source-reviewed-approximate' || receipt.status === 'owner-reviewed-approximate');
    const preview = placement.basis === 'proposed-diagram-alignment' && receipt.status === 'proposed'
      && props.registrationPreviewId === receipt.id;
    const accepted = placement.viewKey === props.viewKey && placement.visible
      && (reviewed || preview)
      && data.roomMappingReceipt !== null
      && receipt.roomMappingReceipt.id === data.roomMappingReceipt.id
      && receipt.roomMappingReceipt.sha256 === data.roomMappingReceipt.sha256
      && receipt.sheetId === fixture.sheetId && receipt.regionId === fixture.regionId
      && placement.regionId === fixture.regionId
      && receipt.originalPhotoSha256 === fixture.source.originalPhotoSha256
      && placement.originalPhotoSha256 === fixture.source.originalPhotoSha256
      && receipt.packagePlaceKey === placement.packagePlaceKey
      && receipt.packagePlaceUuid === placement.packagePlaceUuid
      && region.places.some(place => place.packagePlaceKey === receipt.packagePlaceKey
        && place.packagePlaceUuid === receipt.packagePlaceUuid && place.basis === 'owner-reported')
      && receipt.approvedFixtureIds.includes(fixture.id)
      && receipt.sourceAnchorIds.length > 0
      && receipt.sourceAnchorIds.length === placement.sourceAnchorIds.length
      && receipt.sourceAnchorIds.every(anchor => placement.sourceAnchorIds.includes(anchor))
      && placement.sourcePoint.length === 2
      && placement.sourcePoint.every((value, index) => value === fixture.source.normalizedPoint[index])
      && placement.point.length === 2 && placement.point.every(Number.isFinite);
    if (accepted) used.add(fixture.id);
    return accepted;
  });
}
