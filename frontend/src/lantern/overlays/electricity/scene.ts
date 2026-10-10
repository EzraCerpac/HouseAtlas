import { electricitySheets, hasAcceptedPackageSelection } from './documentary-adapter';
import type { ElectricityOverlayData, ElectricityPackagePlaceSelection } from './types';
import type { ElectricitySceneAnchor, ElectricitySceneGroup, ElectricitySceneMapping, ElectricityScenePoint, ElectricitySceneProjection } from './scene-types';

const nonempty = (value: string) => typeof value === 'string' && value.trim().length > 0;
const digest = (value: string) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const point = (value: ElectricityScenePoint) => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);

/** Pure documentary joins. The host authenticates receipt bytes and admission;
 * this adapter checks membership and never turns a hash into authority. */
export function electricitySceneProjection(data: ElectricityOverlayData, mapping: ElectricitySceneMapping | null,
  anchors: readonly ElectricitySceneAnchor[], dock: ElectricityScenePoint, ui: number,
  selectedPackagePlaces: ElectricityPackagePlaceSelection | null = null, selectedPlaceId: string | null = null): ElectricitySceneProjection | null {
  if (!point(dock) || !Number.isFinite(ui) || ui <= 0) return null;
  const mappingAvailable = mapping !== null && mapping.schema === 'houseatlas.documentary-electricity-room-context.v1'
    && mapping.viewKey === data.viewKey && nonempty(mapping.receiptId) && digest(mapping.receiptSha256);
  const selectionAvailable = selectedPackagePlaces === null || (hasAcceptedPackageSelection(data, selectedPackagePlaces)
    && mappingAvailable && selectedPackagePlaces.receiptId === mapping!.receiptId
    && selectedPackagePlaces.receiptSha256 === mapping!.receiptSha256);
  const sheets = selectionAvailable ? electricitySheets(data, selectedPlaceId, null, selectedPackagePlaces) : [];
  // A source anchor spanning an unresolved component is withheld as a whole,
  // even if another accepted target row exists for the same source reference.
  const unresolvedAnchors = new Set(mappingAvailable ? mapping!.associations.filter(ref => ref.unresolvedLabels.length > 0).map(ref => ref.sourceAnchorId) : []);
  const groups: ElectricitySceneGroup[] = [], groupKeys = new Set<string>(), anchorIds = new Set<string>();
  if (mappingAvailable && selectionAvailable) for (const anchor of anchors) {
    if (!anchor.visible || anchor.basis !== 'schematic-room' || anchor.viewKey !== data.viewKey || !nonempty(anchor.id)
      || anchorIds.has(anchor.id) || !point(anchor.base) || !point(anchor.top)
      || anchor.receiptId !== mapping!.receiptId || anchor.receiptSha256 !== mapping!.receiptSha256) continue;
    const refs = mapping!.associations.filter(ref => ref.floorKey === anchor.floorKey
      && ref.packagePlaceKey === anchor.packagePlaceKey && ref.packagePlaceUuid === anchor.packagePlaceUuid
      && !unresolvedAnchors.has(ref.sourceAnchorId) && anchor.sourceAnchorIds.includes(ref.sourceAnchorId));
    if (refs.length === 0 || (selectedPackagePlaces !== null && (!selectedPackagePlaces.targets.some(target =>
      target.packagePlaceKey === anchor.packagePlaceKey && target.packagePlaceUuid === anchor.packagePlaceUuid)
      || !refs.some(ref => selectedPackagePlaces.sourceAnchorIds.includes(ref.sourceAnchorId))))) continue;
    const groupKey = JSON.stringify([anchor.floorKey, anchor.packagePlaceKey, anchor.packagePlaceUuid]);
    if (groupKeys.has(groupKey)) continue;
    const associations = sheets.flatMap(sheet => sheet.roomAssociations.filter(room => room.packagePlaceKey === anchor.packagePlaceKey
      && room.packagePlaceUuid === anchor.packagePlaceUuid).map(room => ({ sheetId: sheet.id, room })));
    const first = associations[0];
    if (!first) continue;
    const ids = new Set(associations.map(entry => entry.sheetId));
    groups.push({ anchor, label: first.room.label, sheets: sheets.filter(sheet => ids.has(sheet.id)), associations });
    groupKeys.add(groupKey); anchorIds.add(anchor.id);
  }
  const shown = new Set(groups.flatMap(group => group.sheets.map(sheet => sheet.id)));
  return { groups, sheets, unplaced: sheets.filter(sheet => !shown.has(sheet.id)),
    drawingCount: sheets.length, associationCount: sheets.reduce((count, sheet) => count + sheet.roomAssociations.length, 0),
    ui, dock };
}
