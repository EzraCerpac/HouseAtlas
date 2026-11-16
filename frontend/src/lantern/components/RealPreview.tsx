import { safeMediaUrl, safeWebUrl } from '../../app/model';
import { lazy, Suspense, useState } from 'react';
import { useStore } from '../state/store';
import { Modal } from './Modal';
import { PinnedFileAction } from './PinnedFileAction';
import { InlineTime, Note, StorageTag } from './ui';

const HomeboxOriginalAction = lazy(() => import('./HomeboxOriginalAction').then(module => ({ default: module.HomeboxOriginalAction })));

/** Each issued capability owns its failure state, including late image events. */
function AuthorizedImagePreview({ href, title }: { href: string; title: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? <Note>The issued preview could not be loaded.</Note> :
    <img className="authorized-preview" src={href} alt={title} onError={() => setFailed(true)} />;
}

/** No drawn demo pages: only existing authorized, decoded preview capabilities. */
export function RealPreview() {
  const { state, dispatch, house, projection, actions } = useStore();
  if (state.dialog?.type !== 'preview') return null;
  const id = state.dialog.docId, doc = house.docs.find(d => d.id === id);
  const attachment = projection.attachments.get(id), entry = projection.entries.get(id);
  if (!doc || !attachment) return null;
  const close = () => dispatch({ type: 'dialog', dialog: null });
  const times: [string, string | null | undefined][] = [['Attachment added', doc.addedAt], ['Source updated', entry?.sourceUpdatedAt], ['Retrieved', entry?.retrievedAt]];
  const recorded = times.filter((row): row is [string, string] => !!row[1]);
  const href = attachment.kind === 'external-link' ? safeWebUrl(attachment.url) : safeMediaUrl(attachment.downloadHref);
  // Opening a HomeBox file here reads it once and keeps that copy on this device.
  const opener = attachment.kind === 'stored-file' && entry?.source.sourceKind === 'homebox-entity' ? actions.homeboxOriginals : undefined;
  const opensHere = !!opener;
  const image = attachment.kind === 'stored-file' && safeMediaUrl(attachment.previewHref) && ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(attachment.contentType?.toLowerCase() ?? '');
  // Shown under the actions so it reads with them; the attachment supplies nothing more.
  const availability = attachment.kind === 'external-link' ? href ? 'Unknown; HouseAtlas does not check external addresses' : 'No usable external address supplied'
    : href ? 'Access link supplied; validity checked on use' : opensHere ? 'Checked when opened; no separate download link supplied' : 'No download link issued';
  return <Modal wide title={doc.title} kicker={<StorageTag doc={doc} />} onClose={close} footer={<button className="btn btn-primary" type="button" onClick={close}>Done</button>}>
    <div className={image ? 'preview-layout' : 'preview-layout preview-layout-stacked'}>
      {/* Without an image the actions sit in a compact row, not a preview-sized well. */}
      <div className={image ? 'preview-stage' : 'preview-stage preview-actions'}>
        {image && attachment.kind === 'stored-file' ? <AuthorizedImagePreview key={JSON.stringify([id, attachment.attachmentId, attachment.previewHref])} href={safeMediaUrl(attachment.previewHref)!} title={doc.title} /> : !opensHere && <Note>{attachment.kind === 'external-link' ? 'External address only. No stored copy is supplied.' : 'A safe image preview is unavailable.'}</Note>}
        {opener && <Suspense fallback={null}>
          <HomeboxOriginalAction key={id} docId={id} port={opener} />
        </Suspense>}
        {href ? <a className={opensHere ? 'btn' : 'btn btn-primary'} href={href} target="_blank" rel="noopener noreferrer">{attachment.kind === 'external-link' ? 'Open external link' : 'Download original'}</a> : !opensHere && <Note>File access is unavailable.</Note>}
        <p className="preview-availability"><span>Availability</span> {availability}</p>
      </div>
      <aside className="preview-aside" aria-label="Provenance"><h3>Provenance</h3><dl className="facts">
        <div><dt>Owner</dt><dd>HomeBox</dd></div>
        {attachment.kind === 'external-link' && <div><dt>Archive state</dt><dd>{attachment.archived ? 'Archived' : 'Current source link'}</dd></div>}
        <div><dt>Attachment added</dt><dd>{doc.addedAt ? <><InlineTime value={doc.addedAt} />{` by ${doc.addedBy}`}</> : 'Date and actor not supplied'}</dd></div>
        <div><dt>Source updated</dt><dd>{entry?.sourceUpdatedAt ? <InlineTime value={entry.sourceUpdatedAt} /> : 'Unknown'}</dd></div>
        <div><dt>Retrieved</dt><dd>{entry ? <InlineTime value={entry.retrievedAt} /> : 'Unknown'}</dd></div>
      </dl>
        <details className="preview-technical"><summary>{attachment.kind === 'stored-file' ? 'Attachment ID, recorded times, content type and bytes' : 'Attachment ID and recorded times'}</summary><dl className="facts">
          <div><dt>Attachment</dt><dd><code>{attachment.attachmentId}</code></dd></div>
          {/* The readable dates above, as recorded. */}
          {recorded.map(([label, value]) => <div key={label}><dt>{label}, recorded</dt><dd><code>{value}</code></dd></div>)}
          {attachment.kind === 'stored-file' && <><div><dt>Content type</dt><dd>{attachment.contentType ?? 'Unknown'}</dd></div><div><dt>Recorded bytes</dt><dd>{attachment.byteSize ?? 'Unknown'}</dd></div></>}
        </dl></details>
        {attachment.kind === 'stored-file' && <PinnedFileAction key={id} docId={id} />}
      </aside>
    </div>
  </Modal>;
}
