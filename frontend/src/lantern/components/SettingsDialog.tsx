import { useState } from 'react';
import { formatDate } from '../../app/copy';
import { AiSettingsSection } from '../../ai/host/index.js';
import { useStore } from '../state/store';
import { Modal } from './Modal';
import { setModelUpdates, useModelUpdates } from '../unified-atlas/model-updates';
import { SyncSettings } from '../../outbox/ui';

export function SettingsDialog() {
  const { state, dispatch, actions } = useStore();
  const modelUpdates = useModelUpdates();
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<'success' | 'failed' | null>(null);
  const close = () => dispatch({ type: 'settingsOpen', open: false });
  const check = async () => {
    if (checking) return;
    setChecking(true);
    setCheckResult(null);
    try {
      setCheckResult((await actions.reload()) ? 'success' : 'failed');
    } catch {
      setCheckResult('failed');
    } finally {
      setChecking(false);
    }
  };

  return (
    <Modal
      title="Settings"
      onClose={close}
      footer={<button type="button" className="btn btn-primary" onClick={close}>Done</button>}
    >
      <div className="settings">
        <div className="field">
          <span className="field-label">Language</span>
          <p className="setting-static">English</p>
        </div>

        <div className="field">
          <span className="field-label">Saved information</span>
          <button type="button" className="btn" onClick={check} disabled={checking}>
            {checking ? 'Reloading saved information…' : 'Reload saved information'}
          </button>
          <p className="setting-static" role="status" aria-live="polite">
            {checkResult === 'success' ? 'Saved information reloaded.' : checkResult === 'failed' ? 'The reload did not succeed. Saved information has kept its previous date.' : null}
          </p>
        </div>

        <div className="field">
          <AiSettingsSection />
        </div>

        <fieldset className="field">
          <legend>Room map downloads</legend>
          <div className="seg" role="radiogroup" aria-label="Room map downloads">
            {([['automatic', 'Automatic'], ['ask', 'When I ask']] as const).map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={modelUpdates === value}
                tabIndex={modelUpdates === value ? 0 : -1}
                onKeyDown={(event) => {
                  const values = ['automatic', 'ask'] as const;
                  const current = values.indexOf(value);
                  const next = event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1
                    : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (current + 1) % values.length
                    : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (current + values.length - 1) % values.length : -1;
                  if (next < 0) return;
                  event.preventDefault();
                  setModelUpdates(values[next]!);
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
                }}
                onClick={() => setModelUpdates(value)}>
                {label}
              </button>
            ))}
          </div>
          <p className="setting-static">{modelUpdates === 'ask'
            ? 'The stored copy opens; the model downloads only when you choose Check for update.'
            : 'Checks for a newer model on each open, except on mobile data where the browser reports it.'}</p>
        </fieldset>

        <SyncSettings />

        <fieldset className="field">
          <legend>Motion</legend>
          <div className="seg" role="radiogroup" aria-label="Motion">
            {([
              ['system', 'Follow system'],
              ['reduce', 'Reduce'],
              ['full', 'Full'],
            ] as const).map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={state.settings.motion === value}
                tabIndex={state.settings.motion === value ? 0 : -1}
                onKeyDown={(event) => {
                  const values = ['system', 'reduce', 'full'] as const;
                  const current = values.indexOf(value);
                  const next = event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1
                    : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (current + 1) % values.length
                    : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (current + values.length - 1) % values.length : -1;
                  if (next < 0) return;
                  event.preventDefault();
                  dispatch({ type: 'settings', patch: { motion: values[next]! } });
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
                }}
                onClick={() => dispatch({ type: 'settings', patch: { motion: value } })}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        {actions.session && <div className="field">
          <span className="field-label">Session</span>
          <p className="setting-static">Expires {formatDate(actions.session.expiresAt)}.</p>
          {actions.session.signOut && <button type="button" className="btn" onClick={actions.session.signOut}>Sign out</button>}
        </div>}
      </div>
    </Modal>
  );
}
