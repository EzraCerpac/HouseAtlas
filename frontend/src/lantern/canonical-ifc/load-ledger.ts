/** What this page's first Atlas open took, for the ?render-probe=load readout
 * (load-readout.ts): times from navigation start (performance.now()) and the
 * largest costs this page can attribute. Each value keeps the first one noted.
 * Nothing is shown without that query, and nothing leaves the page. */
export type LoadStep = 'home' | 'house' | 'textures' | 'shaded';
export interface LoadLedger {
  readonly steps: Readonly<Partial<Record<LoadStep, number>>>;
  /** The first model drawn: the saved copy shown before the fresh read, or the fresh read's (downloaded, or the saved bytes it confirmed). */
  readonly model?: 'saved' | 'fresh';
  /** Reading and verifying the saved copy, parsing the first model drawn, and building the first stage, in ms; and the renderer. */
  readonly savedReadMs?: number; readonly parseMs?: number; readonly buildMs?: number; readonly backend?: string;
  /** The first model drawn was this device's parsed copy (parsed-store.ts); parseMs is then the time to read it. */
  readonly parsedCopy?: true;
}
const ledger: { steps: Partial<Record<LoadStep, number>>; model?: 'saved' | 'fresh'; savedReadMs?: number; parseMs?: number; buildMs?: number; backend?: string; parsedCopy?: true } = { steps: {} };
export const loadLedger: LoadLedger = ledger;
const SHOWN = typeof location !== 'undefined' && new URLSearchParams(location.search).get('render-probe') === 'load';
let readout: Promise<() => void> | null = null;
function changed(): void {
  if (SHOWN) void (readout ??= import('./load-readout').then(module => module.showLoadReadout(ledger))).then(update => update(), () => undefined);
}
let houseDrawn: () => void = () => undefined;
/** Resolves once this page has drawn its first Atlas frame. Work that should
 * not delay that frame (keeping a parsed copy) waits for it. */
export const firstHouseDrawn: Promise<void> = new Promise(resolve => { houseDrawn = resolve; });
export function noteLoadStep(step: LoadStep): void {
  if (ledger.steps[step] !== undefined) return;
  ledger.steps[step] = performance.now(); changed();
  if (step === 'house') houseDrawn();
}
export function noteFirstModel(model: 'saved' | 'fresh', parseMs: number, savedReadMs?: number, parsedCopy?: boolean): void {
  if (ledger.model !== undefined) return;
  ledger.model = model; ledger.parseMs = parseMs; if (savedReadMs !== undefined) ledger.savedReadMs = savedReadMs;
  if (parsedCopy) ledger.parsedCopy = true; changed();
}
export function noteFirstStage(buildMs: number, backend: string): void {
  if (ledger.backend !== undefined) return;
  ledger.buildMs = buildMs; ledger.backend = backend; changed();
}
