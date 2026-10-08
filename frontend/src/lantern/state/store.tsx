import { createContext, useCallback, useContext, useMemo, useReducer, useSyncExternalStore, type Dispatch, type ReactNode } from 'react';
import { OVERLAY_FOR_KIND, kindOf as kindFromId, locate } from '../data/query';
import type { ConflictInfo, HouseData, Overlay, Selection, System, WriteOp, WriteStatus } from '../data/types';
import type { AskEntry } from '../assistant/engine';
import type { LanternProjection } from '../adapters/read';
import type { AtlasEditingClient } from '../../app/editing';
import type { QuantityClient } from '../../api/quantity-client';
import type { PinnedFileClient } from '../../api/pinned-file-client';
import type { Scope } from '../../app/types';
import type { SessionSettings } from '../../app/session';
export type ViewId = 'atlas' | 'rooms' | 'upkeep' | 'network' | 'library' | 'changes';

export type Dialog =
  | { type: 'editItem'; itemId: string }
  | { type: 'link'; targetId: string }
  | { type: 'media'; targetId: string }
  | { type: 'complete'; taskId: string }
  | { type: 'schedule'; targetId: string; afterTaskId?: string }
  | { type: 'preview'; docId: string }
  | { type: 'conflict'; writeId: string };

export interface Settings {
  outage: boolean;
  slowWrites: boolean;
  motion: 'system' | 'reduce' | 'full';
  assistant: 'demo' | 'off';
}

export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'info' | 'warn';
}

export interface AppState {
  houseId: string;
  houses: Record<string, HouseData>;
  view: ViewId;
  selection: Selection | null;
  floorId: string;
  mode: '3d' | '2d';
  exploded: boolean;
  overlay: Overlay;
  focusCircuit?: string | undefined;
  dialog: Dialog | null;
  searchOpen: boolean;
  askOpen: boolean;
  settingsOpen: boolean;
  nativeOpen: boolean;
  toasts: Toast[];
  settings: Settings;
  ask: Record<string, AskEntry[]>;
  changesFocus?: string | undefined;
}

export type Action =
  | { type: 'house'; id: string }
  | { type: 'view'; view: ViewId; focus?: string }
  | { type: 'select'; sel: Selection | null; keepOverlay?: boolean; view?: ViewId }
  | { type: 'floor'; id: string }
  | { type: 'mode'; mode: '3d' | '2d' }
  | { type: 'explode'; on: boolean }
  | { type: 'overlay'; overlay: Overlay }
  | { type: 'focusCircuit'; id?: string | undefined }
  | { type: 'dialog'; dialog: Dialog | null }
  | { type: 'search'; open: boolean }
  | { type: 'ask'; open: boolean }
  | { type: 'settingsOpen'; open: boolean }
  | { type: 'nativeOpen'; open: boolean }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'toast'; text: string; tone?: Toast['tone'] }
  | { type: 'dismissToast'; id: number }
  | { type: 'queueWrite'; write: WriteOp }
  | { type: 'writeStatus'; houseId: string; id: string; status: WriteStatus; note?: string }
  | { type: 'resolveConflict'; id: string; choice: 'theirs' | 'mine' | 'custom'; value?: string }
  | { type: 'reconcile'; id: string; how: 'check' | 'retry' }
  | { type: 'discardWrite'; id: string }
  | { type: 'askPush'; entry: AskEntry }
  | { type: 'askUpdate'; id: string; entry: AskEntry }
  | { type: 'askClear' };


export interface LanternActions {
  reload: () => Promise<boolean>;
  switchHome: (scope: Scope) => void;
  session?: SessionSettings;
  editing?: AtlasEditingClient;
  quantity?: QuantityClient;
  /** Optional local HomeBox file consumer; never a grant or quantity authority. */
  pinnedFiles?: PinnedFileClient;
  nativeContent: ReactNode;
}
function initial(house: HouseData): AppState {
  return { houseId: house.id, houses: { [house.id]: house }, view: 'atlas', selection: null,
    floorId: house.floors[0]?.id ?? '', mode: '3d', exploded: true, overlay: 'spaces', dialog: null,
    searchOpen: false, askOpen: false, settingsOpen: false, nativeOpen: false, toasts: [],
    settings: { outage: false, slowWrites: false, motion: 'system', assistant: 'off' }, ask: {} };
}
let toastSeq = 0;
function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'view': return { ...s, view: a.view, changesFocus: a.focus };
    case 'select': {
      const loc = a.sel ? locate(s.houses[s.houseId]!, a.sel.id) : {};
      return { ...s, selection: a.sel, floorId: loc.floorId ?? s.floorId,
        overlay: a.sel && !a.keepOverlay ? OVERLAY_FOR_KIND[a.sel.kind] ?? s.overlay : s.overlay,
        view: a.view ?? s.view, focusCircuit: a.sel?.kind === 'circuit' ? a.sel.id : undefined };
    }
    case 'floor': return { ...s, floorId: a.id };
    case 'mode': return { ...s, mode: a.mode };
    case 'explode': return { ...s, exploded: a.on };
    case 'overlay': return { ...s, overlay: a.overlay };
    case 'focusCircuit': return { ...s, focusCircuit: a.id };
    case 'dialog': return { ...s, dialog: a.dialog };
    case 'search': return { ...s, searchOpen: a.open };
    case 'ask': return { ...s, askOpen: a.open };
    case 'nativeOpen': return { ...s, nativeOpen: a.open };
    case 'settingsOpen': return { ...s, settingsOpen: a.open };
    case 'settings': return { ...s, settings: { ...s.settings, motion: a.patch.motion ?? s.settings.motion } };
    case 'toast': return { ...s, toasts: [...s.toasts.slice(-3), { id: ++toastSeq, text: a.text, tone: a.tone ?? 'info' }] };
    case 'dismissToast': return { ...s, toasts: s.toasts.filter(t => t.id !== a.id) };
    default: return s;
  }
}
export function makeWrite(_input: {
  title: string; targetId: string; system: System; patch: WriteOp['patch'];
  origin?: 'you' | 'assistant'; forceOutcome?: WriteOp['forceOutcome']; conflict?: ConflictInfo;
}): WriteOp { throw new Error('This prototype action has no admitted HouseAtlas operation.'); }
interface Ctx { state: AppState; dispatch: Dispatch<Action>; house: HouseData; projection: LanternProjection; actions: LanternActions }
const StoreContext = createContext<Ctx | null>(null);
export function StoreProvider({ children, projection, actions }: { children: ReactNode; projection: LanternProjection; actions: LanternActions }) {
  const [local, send] = useReducer(reducer, projection.house, initial);
  const state = useMemo(() => ({ ...local, houseId: projection.house.id, houses: { [projection.house.id]: projection.house } }), [local, projection]);
  const dispatch = useCallback<Dispatch<Action>>(a => {
    if (a.type === 'house') {
      const home = projection.view.homes.find(h => JSON.stringify([h.workspaceId, h.homeId]) === a.id);
      if (home) actions.switchHome(home);
      return;
    }
    if (a.type === 'queueWrite' || a.type === 'writeStatus' || a.type === 'reconcile' || a.type === 'resolveConflict' || a.type === 'discardWrite' || a.type === 'askPush' || a.type === 'askUpdate' || a.type === 'askClear') {
      send({ type: 'toast', text: 'This action has no admitted HouseAtlas operation.', tone: 'warn' }); return;
    }
    if (a.type === 'dialog' && a.dialog && a.dialog.type !== 'preview') {
      send({ type: 'toast', text: 'Use the available Atlas action or verified HomeBox link in record details.', tone: 'info' }); return;
    }
    send(a);
  }, [projection, actions]);
  const value = useMemo(() => ({ state, dispatch, house: projection.house, projection, actions }), [state, dispatch, projection, actions]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
export function useStore(): Ctx { const ctx = useContext(StoreContext); if (!ctx) throw new Error('useStore outside provider'); return ctx; }
export function useSelect() {
  const { dispatch } = useStore();
  return useCallback((id: string | null, opts?: { keepOverlay?: boolean; view?: ViewId }) => {
    if (!id) return dispatch({ type: 'select', sel: null });
    const kind = kindFromId(id); if (kind) dispatch({ type: 'select', sel: { kind, id }, ...opts });
  }, [dispatch]);
}
function subscribeMotion(cb: () => void) { const mq = window.matchMedia('(prefers-reduced-motion: reduce)'); mq.addEventListener('change', cb); return () => mq.removeEventListener('change', cb); }
export function useReducedMotion(): boolean {
  const { state } = useStore();
  const system = useSyncExternalStore(subscribeMotion, () => window.matchMedia('(prefers-reduced-motion: reduce)').matches, () => false);
  return state.settings.motion === 'reduce' || (state.settings.motion === 'system' && system);
}
export function useCanWrite(system: System): { ok: boolean; reason?: string } {
  return { ok: false, reason: system === 'HomeBox' ? 'HomeBox owns this record. Use its verified native link when available.' : 'This prototype action has no admitted Atlas operation. Available Atlas actions appear in record details.' };
}
