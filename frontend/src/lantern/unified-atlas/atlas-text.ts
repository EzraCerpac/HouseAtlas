import type { UnplacedReason } from './scene';
import type { OverlayKind } from './types';

export const OVERLAY_KINDS: readonly OverlayKind[] = ['electrical', 'network'];
export const OVERLAY_LABEL: Record<OverlayKind, string> = { electrical: 'Electrical', network: 'Network' };
export const OVERLAY_ICON: Record<OverlayKind, 'plug' | 'wifi'> = { electrical: 'plug', network: 'wifi' };
export const UNPLACED_LABEL: Record<UnplacedReason, string> = {
  'not-linked': 'room not linked to a home place',
  'room-absent': 'room not in this model',
  'other-publication': 'from another model version',
  'occurrence-mismatch': 'floor part does not belong to the room',
  'no-placement': 'room has no position in this model',
  'not-selectable': 'no selectable room part',
};
export const LINK_LABEL = { reviewed: 'Linked to a home place', historical: 'Linked in an earlier review only', unmapped: 'Not linked to a home place yet' } as const;
export const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
export const elevation = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)} m`;
/** A UTC time as written, shortened to the minute for the stage; the exact value stays in Source. */
export const stampTime = (value: string) => {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]00:?00)$/.exec(value);
  return match ? `${match[1]} ${match[2]} UTC` : value;
};
