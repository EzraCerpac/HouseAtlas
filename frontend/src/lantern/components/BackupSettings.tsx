import { useEffect, useState } from 'react';
import { MONTHS, NIGHTS, RECENT, chooseRetention, describeRetention, describeStatus, readSettings, type Load, type Retention } from '../backups.ts';
import { Choice } from './Choice';

const browserFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

/** Settings → Backups. Hidden where the server has no backup job. */
export function BackupSettings({ transport = browserFetch }: { readonly transport?: typeof fetch }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    readSettings(transport).then(next => { if (active) setLoad(next); }, () => { if (active) setLoad({ kind: 'unreachable' }); });
    return () => { active = false; };
  }, [transport]);

  if (load.kind === 'absent') return null;
  if (load.kind !== 'ready') {
    // The saved choice is unknown until the server answers; never show a default as if it were saved.
    return (
      <fieldset className="field backup-settings">
        <legend>Backups</legend>
        <p className="setting-static" role="status" aria-live="polite">{load.kind === 'loading'
          ? 'Checking the backup settings…'
          : 'Backups can be seen and changed when the server can be reached.'}</p>
      </fieldset>
    );
  }
  const view = load.view, retention = view.retention;
  const choose = async (next: Retention) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setLoad({ kind: 'ready', view: { ...view, retention: next } });
    try {
      // After an unclear failure this is what the server holds, or unknown.
      const saved = await chooseRetention(next, transport);
      setLoad(saved.load);
      if (saved.error) setError('Not saved; try again.');
    } catch {
      setLoad({ kind: 'ready', view });
      setError('Only an editor of every home can change this.');
    } finally {
      setSaving(false);
    }
  };
  const recent = retention.keep === 'recent' ? retention : null;
  const options = (values: readonly number[], current: number) => [...new Set([...values, current])].sort((a, b) => a - b);

  return (
    <fieldset className="field backup-settings" disabled={saving}>
      <legend>Backups</legend>
      <Choice label="Keep backups" value={retention.keep}
        onChange={keep => { if (keep !== retention.keep) void choose(keep === 'forever' ? { keep } : RECENT); }}
        options={[['forever', 'Forever'], ['recent', 'Recent + monthly']]} />
      {recent && <div className="backup-keep">
        <label>Nightly
          <select value={recent.nights} onChange={event => void choose({ ...recent, nights: Number(event.target.value) })}>
            {options(NIGHTS, recent.nights).map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>Monthly
          <select value={recent.months} onChange={event => void choose({ ...recent, months: Number(event.target.value) })}>
            {options(MONTHS, recent.months).map(n => <option key={n} value={n}>{n === 0 ? 'None' : n}</option>)}
          </select>
        </label>
      </div>}
      <p className="setting-static">{describeRetention(retention)}</p>
      <div className="setting-static" role="status" aria-live="polite">
        {describeStatus(view.status).map(line => <p key={line}>{line}</p>)}
        {error && <p className="backup-error">{error}</p>}
      </div>
    </fieldset>
  );
}
