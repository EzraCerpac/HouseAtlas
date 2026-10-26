import { useState } from 'react';
import { formatDate } from '../../app/copy';
import { AiSettingsSection } from '../../ai/host/index.js';
import { useStore } from '../state/store';
import { Modal } from './Modal';
import { setModelUpdates, useModelUpdates } from '../unified-atlas/model-updates';
import { autoPrefersFull, setModelQuality, useModelQuality } from '../unified-atlas/model-quality';
import { SyncSettings } from '../../outbox/ui';
import { BackupSettings } from './BackupSettings';
import { Choice } from './Choice';

export function SettingsDialog() {
  const { state, dispatch, actions } = useStore();
  const modelUpdates = useModelUpdates();
  const modelQuality = useModelQuality();
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
          <Choice label="Room map downloads" value={modelUpdates} onChange={setModelUpdates}
            options={[['automatic', 'Automatic'], ['ask', 'When I ask']]} />
          <p className="setting-static">{modelUpdates === 'ask'
            ? 'The stored copy opens; the model downloads only when you choose Check for update.'
            : 'Checks for a newer model on each open, except on mobile data where the browser reports it.'}</p>
        </fieldset>

        <SyncSettings />

        <fieldset className="field">
          <legend>Model quality</legend>
          <Choice label="Model quality" value={modelQuality} onChange={setModelQuality}
            options={[['auto', 'Auto'], ['light', 'Light'], ['full', 'Full']]} />
          <p className="setting-static">{modelQuality === 'light'
            ? 'Shows the lighter model, which every device can draw.'
            : modelQuality === 'full'
              ? 'Shows the lighter model first, then swaps in every detail where the house has it. The full model is a large download each time.'
              : `Every detail on a computer with a capable graphics card, the lighter model elsewhere. This device: ${autoPrefersFull() ? 'Full' : 'Light'}.`}</p>
        </fieldset>

        <BackupSettings />

        <fieldset className="field">
          <legend>Motion</legend>
          <Choice label="Motion" value={state.settings.motion} onChange={motion => dispatch({ type: 'settings', patch: { motion } })}
            options={[['system', 'Follow system'], ['reduce', 'Reduce'], ['full', 'Full']]} />
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
