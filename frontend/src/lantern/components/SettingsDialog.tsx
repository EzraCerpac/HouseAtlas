import { lazy, Suspense } from 'react';
import { useStore } from '../state/store';
import { Modal } from './Modal';

// The modal owns focus and dismissal while settings-only code loads.
const SettingsContents = lazy(() => import('./SettingsContents').then(module => ({ default: module.SettingsContents })));

export function SettingsDialog() {
  const { dispatch } = useStore();
  const close = () => dispatch({ type: 'settingsOpen', open: false });
  return <Modal title="Settings" onClose={close}
    footer={<button type="button" className="btn btn-primary" onClick={close}>Done</button>}>
    <Suspense fallback={<p className="setting-static" role="status">Loading settings…</p>}>
      <SettingsContents />
    </Suspense>
  </Modal>;
}
