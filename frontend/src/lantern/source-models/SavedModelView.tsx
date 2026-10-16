import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LocalGlbPreview } from '../canonical-ifc/LocalGlbPreview';
import type { ModelOverviewAsset, ModelOverviewPort, ModelOverviewSelection } from './overview-types';

type Phase = { readonly selection: ModelOverviewSelection; readonly port: ModelOverviewPort; readonly attempt: number;
  readonly asset: ModelOverviewAsset | null; readonly files: readonly Blob[]; readonly failed: boolean };

/** A selected home publication loads automatically. Replacing/withdrawing its
 * owner synchronously removes the prior renderer from this render tree. */
export function SavedModelView({ port, selection }: { readonly port: ModelOverviewPort; readonly selection: ModelOverviewSelection }) {
  const [attempt, setAttempt] = useState(0), [phase, setPhase] = useState<Phase | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setPhase(null);
    const unsubscribe = port.subscribe(() => { if (port.current() !== selection) {
      // Retire actual pixels before React schedules its renderer cleanup.
      if (surface.current) surface.current.hidden = true;
      controller.abort(); setPhase(null);
    } });
    port.read(selection, controller.signal).then(asset => {
      if (!controller.signal.aborted && port.current() === selection)
        setPhase({ selection, port, attempt, asset, files: [asset.blob], failed: false });
    }, () => { if (!controller.signal.aborted && port.current() === selection)
      setPhase({ selection, port, attempt, asset: null, files: [], failed: true }); });
    return () => { controller.abort(); unsubscribe(); };
  }, [port, selection, attempt]);
  const current = phase?.selection === selection && phase.port === port && phase.attempt === attempt && port.current() === selection ? phase : null;
  useLayoutEffect(() => { if (surface.current) surface.current.hidden = port.current() !== selection; }, [port, selection, current]);
  return <div ref={surface}>{current?.asset ? <LocalGlbPreview files={current.files} saved={current.asset} />
    : <div className="cifc cifc-unavailable" role="status" aria-busy={!current?.failed}>
    <p>{current?.failed ? 'The saved model could not be loaded for this home.' : 'Loading saved model…'}</p>
    {current?.failed && <button type="button" className="chip-btn" onClick={() => setAttempt(value => value + 1)}>Check again</button>}
  </div>}</div>;
}
