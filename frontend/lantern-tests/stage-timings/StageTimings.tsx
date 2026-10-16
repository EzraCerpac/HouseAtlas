/** Fixture-only DOM view of the bounded, anonymous stage timings for the
 * named areas. It reads `readStageTimings` and nothing else: no window or
 * performance introspection, no export and no network. The table scrolls
 * inside its own box so long runs never widen the page. */
import { useSyncExternalStore } from 'react';
import { clearStageTimings, readStageTimings, subscribeStageTimings, type StageArea, type StageDetail } from '../../src/lantern/observability/stage-timing';
import './stage-timings.css';

// The newest entry changes identity on every mark and is undefined after Clear.
const newest = () => readStageTimings().at(-1) ?? null;
const detailText = (detail: StageDetail | null) => detail === null ? ''
  : Object.entries(detail).map(([key, value]) => `${key} ${String(value)}`).join(', ');

export function StageTimings({ areas, title = 'Stage timings' }: { readonly areas: readonly StageArea[]; readonly title?: string }) {
  useSyncExternalStore(subscribeStageTimings, newest);
  const rows = readStageTimings().filter(entry => areas.includes(entry.area));
  const showArea = areas.length > 1;
  const headingId = `stage-timings-${areas.join('-')}`;
  return <section className="stage-timings" aria-labelledby={headingId}>
    <div className="stage-timings-head">
      <h2 id={headingId}>{title}</h2>
      <span role="status">{rows.length === 0 ? 'None yet' : `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`}</span>
      <button type="button" className="chip-btn" disabled={rows.length === 0} onClick={clearStageTimings}>Clear</button>
    </div>
    <div className="stage-timings-scroll" tabIndex={0} aria-label={`${title}, scrollable`}>
      <table>
        <colgroup><col className="stage-timings-at" />{showArea && <col className="stage-timings-area" />}<col className="stage-timings-event" /><col /></colgroup>
        <thead><tr><th scope="col">ms</th>{showArea && <th scope="col">Area</th>}<th scope="col">Event</th><th scope="col">Detail</th></tr></thead>
        <tbody>{rows.map((entry, at) => <tr key={at}>
          <td>{entry.at.toFixed(1)}</td>{showArea && <td>{entry.area}</td>}<td>{entry.event}</td><td>{detailText(entry.detail)}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
