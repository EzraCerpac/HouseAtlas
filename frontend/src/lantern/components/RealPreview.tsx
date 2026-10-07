import { safeMediaUrl, safeWebUrl } from '../../app/model';
import { useState } from 'react';
import { useStore } from '../state/store';
import { Modal } from './Modal';
import { Note, StorageTag } from './ui';
import { fmtDateTime } from '../data/time';

/** No drawn demo pages: only existing authorized, decoded preview capabilities. */
export function RealPreview() {
  const { state, dispatch, house, projection } = useStore();
  const [failed, setFailed] = useState(false);
  if (state.dialog?.type !== 'preview') return null;
  const id = state.dialog.docId, doc = house.docs.find(d => d.id === id);
  const attachment = projection.attachments.get(id), entry = projection.entries.get(id);
  if (!doc || !attachment) return null;
  const close = () => dispatch({ type: 'dialog', dialog: null });
  const href = attachment.kind === 'external-link' ? safeWebUrl(attachment.url) : safeMediaUrl(attachment.downloadHref);
  const image = attachment.kind === 'stored-file' && safeMediaUrl(attachment.previewHref) && ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(attachment.contentType ?? '');
  return <Modal wide title={doc.title} kicker={<StorageTag doc={doc} />} onClose={close} footer={<button className="btn btn-primary" type="button" onClick={close}>Done</button>}>
    <div className="preview-layout">
      <div className="preview-stage">
        {image && attachment.kind === 'stored-file' && !failed ? <img className="authorized-preview" src={safeMediaUrl(attachment.previewHref)!} alt="Image preview" onError={() => setFailed(true)} /> : <Note>{attachment.kind === 'external-link' ? 'External address only. No stored copy is supplied.' : failed ? 'The issued preview could not be loaded.' : 'A safe image preview is unavailable.'}</Note>}
        {href ? <a className="btn btn-primary" href={href} target="_blank" rel="noopener noreferrer">{attachment.kind === 'external-link' ? 'Open external link' : 'Download original'}</a> : <Note>File access is unavailable.</Note>}
      </div>
      <aside className="preview-aside" aria-label="Provenance"><h3>Provenance</h3><dl className="facts">
        <div><dt>Owner</dt><dd>HomeBox</dd></div>
        <div><dt>Attachment</dt><dd><code>{attachment.attachmentId}</code></dd></div>
        <div><dt>Availability</dt><dd>{href ? 'Access link supplied; validity checked on use' : 'No download link issued'}</dd></div>
        {attachment.kind === 'stored-file' && <><div><dt>Content type</dt><dd>{attachment.contentType ?? 'Unknown'}</dd></div><div><dt>Bytes</dt><dd>{attachment.byteSize ?? 'Unknown'}</dd></div></>}
        {attachment.kind === 'external-link' && <div><dt>Archive state</dt><dd>{attachment.archived ? 'Archived' : 'Current source link'}</dd></div>}
        <div><dt>Source updated</dt><dd>{entry?.sourceUpdatedAt ? fmtDateTime(entry.sourceUpdatedAt) : 'Unknown'}</dd></div>
        <div><dt>Retrieved</dt><dd>{entry ? fmtDateTime(entry.retrievedAt) : 'Unknown'}</dd></div>
      </dl></aside>
    </div>
  </Modal>;
}
