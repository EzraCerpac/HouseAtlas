import { useEffect, useId, useRef, useState } from 'react';
import { CAPTURE_TYPES, selectEvidenceFile, type EvidenceSelection, type SelectionMethod, type SelectionPolicy } from './selection';

const names: Record<string, string> = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'application/pdf': 'PDF', 'text/plain': 'UTF-8 text' };

/** Native pickers open only from user activation. This component stores no draft. */
export function EvidencePicker({ policy, busy, value, onChange }: {
  policy: SelectionPolicy; busy: boolean; value: EvidenceSelection | null;
  onChange: (selection: EvidenceSelection | null) => void;
}) {
  const hints = useId(), statusId = useId();
  const active = useRef<AbortController | null>(null);
  const group = useRef<HTMLFieldSetElement>(null);
  const [pending, setPending] = useState(false), [status, setStatus] = useState('');
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    const element = group.current;
    const cancel = () => setStatus('Selection cancelled. The current file is unchanged.');
    element?.addEventListener('cancel', cancel, true);
    return () => element?.removeEventListener('cancel', cancel, true);
  }, []);
  const types = policy.contentTypes.filter(type => CAPTURE_TYPES.includes(type as typeof CAPTURE_TYPES[number]));
  const photos = types.filter(type => type.startsWith('image/'));
  const choose = async (input: HTMLInputElement, method: SelectionMethod) => {
    const original = input.files?.[0];
    if (!original) return; // Dismissal retains the current selection and form.
    input.value = ''; // The same file can be chosen again as a new selection.
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    onChange(null); setPending(true); setStatus('Checking selected file…');
    try {
      const selection = await selectEvidenceFile(original, method, policy, controller.signal);
      if (!controller.signal.aborted && active.current === controller) {
        onChange(selection); setStatus('File selected. Review the evidence statement before uploading.');
      }
    } catch (error) {
      if (!controller.signal.aborted && active.current === controller)
        setStatus(error instanceof Error ? error.message : 'The selected file could not be read.');
    } finally {
      if (active.current === controller) setPending(false);
    }
  };
  const picker = (label: string, name: string, method: SelectionMethod, accept: string[], camera = false) => (
    <label>
      <span>{label}</span>
      <input name={name} type="file" accept={accept.join(',')} {...(camera ? { capture: 'environment' as const } : {})}
        disabled={busy || pending || !accept.length} aria-describedby={`${hints} ${statusId}`}
        onChange={event => void choose(event.currentTarget, method)} />
    </label>
  );
  return <fieldset ref={group} disabled={busy}>
    <legend>Photo or document</legend>
    <p id={hints} className="muted">{types.map(type => names[type]).join(', ')}. Maximum {Math.min(policy.maximumBytes, 10 * 1024 * 1024)} bytes per file. HEIC/HEIF is not supported yet.</p>
    {photos.length > 0 && picker('Take photo', 'camera', 'camera-request', photos, true)}
    {photos.length > 0 && picker('Choose photo', 'photos', 'photo-picker', photos)}
    {picker('Choose file or PDF', 'file', 'file-picker', types)}
    <p id={statusId} role="status" aria-live="polite">{status}</p>
    {value && <>
      <p className="muted" style={{ overflowWrap: 'anywhere' }}>Selected: {value.original.name} · {names[value.file.type]} · {value.file.size} bytes</p>
      <button type="button" disabled={busy || pending} onClick={() => { onChange(null); setStatus('File removed.'); }}>Remove file</button>
    </>}
    <p className="muted">Uploads preserve the file returned by your browser, including embedded metadata. Camera and Photos may change a file before returning it.</p>
  </fieldset>;
}
