import { useMemo, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { Icon } from '../components/Icon';
import { displayLevelAnchor, displayLevelIds, displayLevelLabel, displayLevels, type AtlasAction, type AtlasModel, type AtlasViewState } from './scene';
import type { AtlasLevel } from './types';
import { atlasBuildingName, atlasLevelName } from './labels';
import { plural } from './atlas-text';

/** Short rung marks from each floor's own display name: initials, without a
 * trailing "floor". Marks that repeat within a building gain a source-order number. */
function floorMarks(model: AtlasModel, levels: readonly AtlasLevel[]): ReadonlyMap<string, string> {
  const marks = levels.map(level => {
    const words = (displayLevelLabel(model, level.levelId) ?? atlasLevelName(model, level.levelId)).split(' · ')[0]!.split(/\s+/).filter(Boolean);
    const kept = words.length > 1 && /^floor$/i.test(words[words.length - 1]!) ? words.slice(0, -1) : words;
    return kept.map(word => /[\p{L}\p{N}]/u.exec(word)?.[0] ?? '').join('').slice(0, 2).toUpperCase() || '·';
  });
  return new Map(levels.map((level, at) => {
    const mark = marks[at]!, same = marks.filter(other => other === mark).length;
    return [level.levelId, same > 1 ? `${mark}${marks.slice(0, at + 1).filter(other => other === mark).length}` : mark];
  }));
}

/** Short building marks for the rail: the initials of each building's name,
 * numbered where two buildings share them. */
function buildingMarks(model: AtlasModel, buildings: readonly { readonly buildingId: string }[]): ReadonlyMap<string, string> {
  const marks = buildings.map(row => atlasBuildingName(model, row.buildingId).split(' · ')[0]!.split(/\s+/).filter(Boolean)
    .map(word => /[\p{L}\p{N}]/u.exec(word)?.[0] ?? '').join('').slice(0, 2).toUpperCase() || '·');
  return new Map(buildings.map((row, at) => {
    const mark = marks[at]!, same = marks.filter(other => other === mark).length;
    return [row.buildingId, same > 1 ? `${mark}${marks.slice(0, at + 1).filter(other => other === mark).length}` : mark];
  }));
}

/** The Floor Stack: where you are, building and floor, in one small control.
 * Its head names the scope with a slab glyph, the current floor lit. On a
 * phone the head is a chip that unfolds the stack below it and folds again
 * after a choice, a tap elsewhere or Escape; on a wide stage the stack is a
 * rail of marks that widens to names on hover, focus or a click of its head.
 * Floors hang at their actual relative heights, top floor first; buildings
 * stand above them when there is more than one, and Spread floors (Exploded)
 * closes the stack in 3D. Arrow up and down on the head, or a swipe of the
 * chip, step one floor, "All floors" standing above the top floor. */
export function FloorStack({ model, levels, buildings, buildingNav, building, state, dispatch, chooseBuilding, shownLevel, selectionLevel, contextLevels,
  canExplode, compact, open, setOpen, head, panelId }: {
  readonly model: AtlasModel; readonly levels: readonly AtlasLevel[];
  readonly buildings: readonly { readonly buildingId: string }[]; readonly buildingNav: boolean;
  readonly building: { readonly buildingId: string; readonly label: string } | null;
  readonly state: AtlasViewState; readonly dispatch: (action: AtlasAction) => void;
  readonly chooseBuilding: (buildingId: string | null) => void;
  /** The floor Plan draws for a whole-building scope. */
  readonly shownLevel: string | null;
  readonly selectionLevel: string | null; readonly contextLevels: ReadonlySet<string>;
  readonly canExplode: boolean; readonly compact: boolean;
  readonly open: boolean; readonly setOpen: (open: boolean) => void;
  readonly head: RefObject<HTMLButtonElement | null>; readonly panelId: string;
}) {
  const choices = useMemo(() => displayLevels(model, levels), [model, levels]);
  const top = [...choices].reverse();
  const activeLevels = new Set(displayLevelIds(model, state.levelId));
  const currentAnchor = state.levelId === null ? null : displayLevelAnchor(model, state.levelId);
  const marks = useMemo(() => floorMarks(model, choices), [model, choices]);
  const buildingMark = useMemo(() => buildingMarks(model, buildings), [model, buildings]);
  const gaps = top.map((level, at) => {
    const below = top[at + 1]; if (!below) return 0;
    return Math.max(48, (model.floorY.get(level.levelId)! - model.floorY.get(below.levelId)!) * 22);
  });
  const whole = state.levelId === null && state.buildingId !== null;
  const current = currentAnchor === null ? null : model.levelsById.get(currentAnchor) ?? null;
  const floorName = current ? displayLevelLabel(model, current.levelId) ?? atlasLevelName(model, current.levelId) : null;
  const mark = current ? marks.get(current.levelId) ?? '·' : building && levels.length > 0 ? 'All' : null;
  const where = building ? `${building.label}, ${floorName ?? 'all floors'}` : 'All buildings';
  // Low to high, then the whole building above the top floor.
  const steps: readonly (string | null)[] = [...choices.map(level => level.levelId), null];
  const step = (by: 1 | -1) => {
    if (levels.length === 0) return;
    const at = steps.indexOf(currentAnchor), next = steps[Math.max(0, Math.min(steps.length - 1, at + by))]!;
    if (next !== state.levelId || at === -1) dispatch({ type: 'level', levelId: next });
  };
  const pick = (levelId: string | null) => {
    dispatch({ type: 'level', levelId });
    if (compact && open) { setOpen(false); head.current?.focus({ preventScroll: true }); }
  };
  // A vertical swipe on the head steps a floor instead of opening the stack.
  const swipe = useRef<{ readonly y: number; moved: boolean } | null>(null);
  const keys = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault(); event.stopPropagation();
    step(event.key === 'ArrowUp' ? 1 : -1);
  };
  const slabs = top.slice(0, 5);
  // The paper widens over the stage while the stack's own box keeps its size,
  // so opening the rail never re-fits the model.
  return <div className={`ua-stack${compact ? ' is-chip' : ' is-rail'}${open ? ' is-open' : ''}${levels.length === 0 ? ' is-site' : ''}`}>
    <div className="ua-stack-paper">
      <button ref={head} type="button" className="ua-stack-head" aria-expanded={open} aria-controls={panelId}
        aria-label={`Building and floor: ${where}`} title={compact ? undefined : where} onKeyDown={keys}
        onPointerDown={event => { swipe.current = { y: event.clientY, moved: false }; }}
        onPointerMove={event => {
          // A press released elsewhere never reached click: no button held, no swipe.
        const start = swipe.current; if (start && event.buttons === 0) { swipe.current = null; return; }
        if (!start || start.moved || Math.abs(event.clientY - start.y) < 16) return;
          start.moved = true; step(event.clientY < start.y ? 1 : -1);
        }}
        onPointerCancel={() => { swipe.current = null; }}
        onClick={() => { const moved = swipe.current?.moved; swipe.current = null; if (!moved) setOpen(!open); }}>
        {/* Keyed by floor: a new floor nudges the glyph once. */}
        <svg key={state.levelId ?? state.buildingId ?? 'site'} className="ua-stack-glyph" width={26} height={26} viewBox="0 0 26 26" aria-hidden="true">
          {slabs.length > 0 ? slabs.map((level, at) => <rect key={level.levelId} x={4} width={18} rx={1.4}
            y={4 + at * (19 / slabs.length)} height={Math.max(2.5, 19 / slabs.length - 1.6)}
            className={whole || activeLevels.has(level.levelId) ? 'is-lit' : selectionLevel === level.levelId ? 'is-held' : undefined} />)
            : <path d="M4 21V11l9-7 9 7v10Z M10 21v-6h6v6" />}
        </svg>
        {mark && <span className="ua-stack-mark">{mark}</span>}
        <span className="ua-stack-where">
          {buildingNav && <span className="ua-stack-building">{building?.label ?? 'All buildings'}</span>}
          {floorName && <span className="ua-stack-floor">{floorName}</span>}
        </span>
        {compact && <Icon name="chevronDown" size={15} className="ua-stack-chevron" />}
      </button>
      <div id={panelId} className="ua-stack-card" role="group" aria-label="Building and floor" hidden={compact && !open}>
        {buildingNav && <ul className="ua-stack-buildings" aria-label="Buildings">
          <li><button type="button" className="ua-rung ua-stack-row" aria-pressed={state.buildingId === null} onClick={() => chooseBuilding(null)}>
            <span className="ua-rung-tick" aria-hidden="true"><Icon name="atlas" size={16} /></span>
            <span className="ua-rung-name">All buildings</span></button></li>
          {buildings.map(row => <li key={row.buildingId}><button type="button" className="ua-rung ua-stack-row" aria-pressed={state.buildingId === row.buildingId}
            onClick={() => chooseBuilding(row.buildingId)}>
            <span className="ua-rung-tick" aria-hidden="true">{buildingMark.get(row.buildingId)}</span>
            <span className="ua-rung-name">{atlasBuildingName(model, row.buildingId)}</span></button></li>)}
        </ul>}
        {levels.length > 0 && <ol className="ua-stack-floors" aria-label={building ? `Floors of ${building.label}` : 'Floors'}>
          <li><button type="button" className={`ua-rung ua-stack-row${whole ? ' is-current' : ''}`} aria-pressed={whole}
            onClick={() => pick(null)}>
            <span className="ua-rung-tick ua-rung-tick-all" aria-hidden="true">All</span>
            <span className="ua-rung-name">All floors</span></button></li>
          {top.map((level, at) => {
            const here = currentAnchor === level.levelId;
            const members = displayLevelIds(model, level.levelId);
            const drawn = !here && state.levelId === null && shownLevel !== null && members.includes(shownLevel);
            const holds = selectionLevel !== null && members.includes(selectionLevel), also = !holds && members.some(id => contextLevels.has(id));
            const rooms = members.flatMap(id => model.levelsById.get(id)!.occurrenceIds).filter(key => model.selectable.has(key)).length;
            const hasPlan = members.some(id => model.plansByLevel.has(id));
            // Spacing above this floor: its height difference to the floor listed before it.
            return <li key={level.levelId} style={at > 0 ? { '--rung-gap': `${gaps[at - 1]}px` } as CSSProperties : undefined}>
              <button type="button" className={`ua-rung ua-stack-row${here ? ' is-current' : drawn ? ' is-shown' : ''}`} aria-pressed={here}
                title={level.elevationBasis ?? undefined}
                aria-label={`${(displayLevelLabel(model, level.levelId) ?? atlasLevelName(model, level.levelId))}: ${plural(rooms, 'room')}${hasPlan ? '' : ', no plan'}${drawn ? ', plan shown' : ''}${holds ? ', has the selected room' : also ? ', has another part of the selected room' : ''}`}
                onClick={() => pick(level.levelId)}>
                <span className="ua-rung-tick" aria-hidden="true">{marks.get(level.levelId)}</span>
                <span className="ua-rung-name">{(displayLevelLabel(model, level.levelId) ?? atlasLevelName(model, level.levelId))}</span>
                <span className="ua-rung-sub">{rooms.toLocaleString()}{hasPlan ? '' : ' · no plan'}</span>
                {(holds || also) && <span className={`ua-rung-mark${also ? ' is-context' : ''}`} aria-hidden="true" />}
              </button>
            </li>;
          })}
        </ol>}
        {state.view === 'plan' && state.levelId !== null && activeLevels.size > 1 && <div role="group" aria-label="Plan level">
          {[...activeLevels].map(levelId => <button key={levelId} type="button" className="ua-rung ua-stack-row"
            aria-pressed={state.levelId === levelId} onClick={() => dispatch({ type: 'level', levelId })}>
            <span className="ua-rung-name">{atlasLevelName(model, levelId)}</span>
          </button>)}
        </div>}
        {canExplode && <button type="button" className="ua-rung ua-stack-row ua-stack-spread" aria-pressed={state.exploded}
          onClick={() => dispatch({ type: 'explode', exploded: !state.exploded })}>
          <span className="ua-rung-tick" aria-hidden="true"><Icon name="explode" size={17} /></span>
          <span className="ua-rung-name">Spread floors</span>
          <span className="ua-stack-switch" aria-hidden="true" /></button>}
      </div>
    </div>
  </div>;
}
