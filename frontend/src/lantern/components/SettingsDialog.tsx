import { useState } from 'react';
import { formatDate } from '../../app/copy';
import { AiSettingsSection, useAiHostAvailable } from '../../ai/host/index.js';
import { useStore } from '../state/store';
import { Modal } from './Modal';
import { setModelUpdates, useModelUpdates } from '../unified-atlas/model-updates';
import { autoPrefersFull, setModelQuality, useModelQuality } from '../unified-atlas/model-quality';
import { DEFAULT_SUN_PLACE, updateSunPlace, useSunPlace } from '../unified-atlas/sun-place';
import type { SunPlace } from '../unified-atlas/daylight';
import { SyncSettings } from '../../outbox/ui';
import { BackupSettings } from './BackupSettings';
import { Choice } from './Choice';

export function SettingsDialog() {
  const { state, dispatch, actions } = useStore();
  const aiAvailable = useAiHostAvailable();
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

        {aiAvailable && <div className="field">
          <AiSettingsSection />
        </div>}

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

        <SunPlaceSettings />

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

const SUN_FIELDS: readonly (readonly [keyof SunPlace, string, number, number])[] = [
  ['latitude', 'Latitude', -90, 90], ['longitude', 'Longitude', -180, 180], ['northDeg', 'Model north, degrees clockwise', -360, 360],
];

/** Where the 3D view's sun is computed for. Values save as soon as they are valid. */
function SunPlaceSettings() {
  const place = useSunPlace();
  const [draft, setDraft] = useState<Record<keyof SunPlace, string>>(() => ({
    latitude: String(place.latitude), longitude: String(place.longitude), northDeg: String(place.northDeg) }));
  const [locating, setLocating] = useState<'busy' | 'failed' | null>(null);
  const edit = (key: keyof SunPlace, text: string, low: number, high: number) => {
    setDraft(value => ({ ...value, [key]: text }));
    const value = Number(text);
    if (text.trim() !== '' && Number.isFinite(value) && value >= low && value <= high) updateSunPlace({ [key]: value });
  };
  const locate = () => {
    if (!('geolocation' in navigator)) { setLocating('failed'); return; }
    setLocating('busy');
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      // Two decimals, about a kilometre: plenty for the sun, and no closer than needed.
      const latitude = Math.round(coords.latitude * 100) / 100, longitude = Math.round(coords.longitude * 100) / 100;
      updateSunPlace({ latitude, longitude });
      setDraft(value => ({ ...value, latitude: String(latitude), longitude: String(longitude) }));
      setLocating(null);
    }, () => setLocating('failed'), { maximumAge: 3_600_000, timeout: 15_000 });
  };
  const unset = place.latitude === DEFAULT_SUN_PLACE.latitude && place.longitude === DEFAULT_SUN_PLACE.longitude;
  return (
    <fieldset className="field">
      <legend>Sun position</legend>
      <div className="field-row">
        {SUN_FIELDS.map(([key, label, low, high]) => <label key={key} className="field">
          <span className="field-label">{label}</span>
          <input type="number" inputMode="decimal" step="any" min={low} max={high} value={draft[key]}
            onChange={event => edit(key, event.currentTarget.value, low, high)} />
        </label>)}
      </div>
      <button type="button" className="btn" onClick={locate} disabled={locating === 'busy'}>
        {locating === 'busy' ? 'Finding this device…' : "Use this device's location"}</button>
      <p className="setting-static" role="status" aria-live="polite">{locating === 'failed'
        ? 'The location is unavailable. Enter it instead.'
        : `Lights the 3D view for the real sun. Stored on this device${unset ? '; the location is a default until set' : ''}.`}</p>
    </fieldset>
  );
}
