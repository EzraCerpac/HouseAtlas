// Isolated hook seam for executing the actual MeshLayer effect against a fake
// generated canvas. No DOM, browser, native React mount or network is invoked.
let canvas, refs = 0, effects = [];
export function resetEffects(value) { canvas = value; refs = 0; effects = []; }
export function useRef(value) { return { current: refs++ === 0 ? canvas : value }; }
export function useLayoutEffect(effect) { effects.push(effect); }
export function runEffects() { return effects.map(effect => effect()).filter(value => typeof value === 'function'); }
