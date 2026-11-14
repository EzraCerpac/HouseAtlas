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
}
const ledger: { steps: Partial<Record<LoadStep, number>>; model?: 'saved' | 'fresh'; savedReadMs?: number; parseMs?: number; buildMs?: number; backend?: string } = { steps: {} };
export const loadLedger: LoadLedger = ledger;
const SHOWN = typeof location !== 'undefined' && new URLSearchParams(location.search).get('render-probe') === 'load';
let readout: Promise<() => void> | null = null;
function changed(): void {
  if (SHOWN) void (readout ??= import('./load-readout').then(module => module.showLoadReadout(ledger))).then(update => update(), () => undefined);
}
export function noteLoadStep(step: LoadStep): void {
  if (ledger.steps[step] !== undefined) return;
  ledger.steps[step] = performance.now(); changed();
}
export function noteFirstModel(model: 'saved' | 'fresh', parseMs: number, savedReadMs?: number): void {
  if (ledger.model !== undefined) return;
  ledger.model = model; ledger.parseMs = parseMs; if (savedReadMs !== undefined) ledger.savedReadMs = savedReadMs; changed();
}
export function noteFirstStage(buildMs: number, backend: string): void {
  if (ledger.backend !== undefined) return;
  ledger.buildMs = buildMs; ledger.backend = backend; changed();
}
