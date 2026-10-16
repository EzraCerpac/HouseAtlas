import { useId, useState, useSyncExternalStore } from 'react';
import { LocalGlbPreview } from '../canonical-ifc/LocalGlbPreview';
import { SavedModelView } from './SavedModelView';
import type { SourceModelPort } from '../source-ports';
import './source-models.css';

const NO_FILES: readonly File[] = [];
const noOverview = () => null;
const noSubscription = () => () => {};

/** The selected saved overview loads automatically. The separate local-file
 * choice remains browser-only and never uploads, saves or binds its files. */
export function SourceModelView({ port }: { readonly port: SourceModelPort }) {
  const inputId = useId(), noteId = useId();
  const [files, setFiles] = useState<readonly File[]>(NO_FILES);
  const [local, setLocal] = useState(false);
  const selected = useSyncExternalStore(port.overview?.subscribe ?? noSubscription, port.overview?.current ?? noOverview, noOverview);
  return <section className="source-model-pane" aria-labelledby={`${inputId}-title`}>
    {selected && port.overview && <>
      <h2 id={`${inputId}-title`}>Model</h2>
      <div className="seg" role="group" aria-label="Model source">
        <button type="button" aria-pressed={!local} onClick={() => setLocal(false)}>Saved model</button>
        <button type="button" aria-pressed={local} onClick={() => setLocal(true)}>Local file</button>
      </div>
      {!local && <SavedModelView port={port.overview} selection={selected} />}
    </>}
    {(!selected || local) && <>
    <div className="source-model-chooser">
      <h2 {...(!selected ? { id: `${inputId}-title` } : {})}>Model file</h2>
      <label htmlFor={inputId}>Choose a GLB or browser manifest</label>
      <input id={inputId} type="file" multiple accept=".glb,.json,model/gltf-binary,application/json" aria-describedby={noteId}
        onChange={event => setFiles(Array.from(event.currentTarget.files ?? []))} />
      <p id={noteId}>Read in this browser only. Nothing is uploaded or saved, and the file is not linked to this home.
        Rooms, floors and alignment are never inferred.</p>
    </div>
    <LocalGlbPreview files={files} review={port} />
    </>}
  </section>;
}
