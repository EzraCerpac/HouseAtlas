import type { LoadLedger } from './load-ledger';

/** The ?render-probe=load readout: three lines of times and costs for this
 * page's first Atlas open (load-ledger.ts), kept on screen as selectable text. */
export interface ModelDownload { readonly bytes: number; readonly ms: number }
/** Finished GETs of the overview model in this page's resource timing (not the Full detail). */
export function modelDownloads(entries: readonly Pick<PerformanceResourceTiming, 'name' | 'startTime' | 'responseEnd' | 'encodedBodySize'>[]): ModelDownload[] {
  return entries.filter(entry => /\/atlas\/[^/?]+\/artifacts\/model\?/.test(entry.name))
    .map(entry => ({ bytes: entry.encodedBodySize, ms: entry.responseEnd - entry.startTime }));
}
const seconds = (ms: number | undefined) => ms === undefined ? 'pending' : `${(ms / 1000).toFixed(1)} s`;
const BACKENDS: Record<string, string> = { webgpu: 'WebGPU', webgl2: 'WebGL2' };
export function formatLoadReadout(ledger: LoadLedger, downloads: readonly ModelDownload[]): string {
  const { steps } = ledger;
  const download = downloads.length === 0 ? 'none so far'
    : downloads.map(({ bytes, ms }) => `${(bytes / 1e6).toFixed(1)} MB in ${seconds(ms)}`).join(', ');
  const model = ledger.model === undefined ? 'pending' : ledger.model === 'saved' ? 'saved copy'
    : downloads.length > 0 ? 'download' : 'saved copy after online check';
  const saved = ledger.savedReadMs !== undefined ? `Saved copy read ${seconds(ledger.savedReadMs)}` : ledger.model === undefined ? 'Saved copy read pending' : 'No saved copy read';
  return `Home ${seconds(steps.home)} · house ${seconds(steps.house)} · textures ${seconds(steps.textures)} · shaded ${seconds(steps.shaded)}\n`
    + `Model: ${model} · model download: ${download}\n`
    + `${saved} · ${ledger.parsedCopy ? 'kept parse' : 'parse'} ${seconds(ledger.parseMs)} · build ${seconds(ledger.buildMs)} · ${ledger.backend === undefined ? 'renderer pending' : BACKENDS[ledger.backend] ?? ledger.backend}`;
}
/** Shows the readout over the page and returns its update; finished requests update it too. */
export function showLoadReadout(ledger: LoadLedger): () => void {
  const output = document.createElement('output');
  output.setAttribute('aria-label', 'Load times');
  output.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:9999;max-width:560px;margin:0 auto;padding:6px 10px;box-sizing:border-box;'
    + 'border-radius:8px;background:Canvas;color:CanvasText;box-shadow:0 2px 12px rgb(0 0 0 / .3);font:12px/1.4 system-ui,sans-serif;'
    + 'white-space:pre-wrap;user-select:text;-webkit-user-select:text';
  document.body.append(output);
  const update = () => { output.textContent = formatLoadReadout(ledger, modelDownloads(performance.getEntriesByType('resource') as PerformanceResourceTiming[])); };
  try { new PerformanceObserver(update).observe({ type: 'resource' }); } catch { /* Updated by the ledger only. */ }
  return update;
}
