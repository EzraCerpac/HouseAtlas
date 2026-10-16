import { useId, useState } from 'react';
import { LocalGlbPreview } from '../canonical-ifc/LocalGlbPreview';
import type { SourceModelPort } from '../source-ports';
import './source-models.css';

const NO_FILES: readonly File[] = [];

/** Browser-only source-export viewing. The chosen files are read in this tab
 * and dropped with it; nothing is uploaded, saved, published or bound to the
 * home. No saved model or site artifact read is mounted here. */
export function SourceModelView({ port }: { readonly port: SourceModelPort }) {
  const inputId = useId(), noteId = useId();
  const [files, setFiles] = useState<readonly File[]>(NO_FILES);
  return <section className="source-model-pane" aria-labelledby={`${inputId}-title`}>
    <div className="source-model-chooser">
      <h2 id={`${inputId}-title`}>Model file</h2>
      <label htmlFor={inputId}>Choose a GLB or browser manifest</label>
      <input id={inputId} type="file" multiple accept=".glb,.json,model/gltf-binary,application/json" aria-describedby={noteId}
        onChange={event => setFiles(Array.from(event.currentTarget.files ?? []))} />
      <p id={noteId}>Read in this browser only. Nothing is uploaded or saved, and the file is not linked to this home.
        Rooms, floors and alignment are never inferred. No saved model publication is connected.</p>
    </div>
    <LocalGlbPreview files={files} review={port} />
  </section>;
}
