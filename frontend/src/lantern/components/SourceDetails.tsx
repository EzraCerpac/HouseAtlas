import { ancestry, nativeLink, safeWebUrl, sameScope, sourceKey } from '../../app/model';
import { RecordStatus } from '../../app/components';
import { PlaceEditor } from '../../app/PlaceEditor';
import { useStore } from '../state/store';
import { fmtDateTime } from '../data/time';
import { Section } from './ui';

/** Original qualified records and independently issued capabilities are retained. */
export function SourceDetails() {
  const { projection, state, actions } = useStore();
  const entry = state.selection ? projection.entries.get(state.selection.id) : undefined;
  if (!entry) return null;
  return <div className="source-details">
    <Section title="Source record">
      <RecordStatus entry={entry} />
      <dl className="facts">
        <div><dt>Classification</dt><dd>{entry.kind === 'unknown' ? 'Unknown' : entry.kind === 'place' ? entry.semanticKind : entry.entity.entityType?.name ?? 'Unknown'}</dd></div>
        <div><dt>Source identifier</dt><dd><code>{entry.source.externalId}</code></dd></div>
        <div><dt>Source instance</dt><dd><code>{entry.source.sourceInstanceId}</code></dd></div>
        <div><dt>Collection</dt><dd><code>{entry.source.collectionId}</code></dd></div>
        <div><dt>Updated at source</dt><dd>{entry.sourceUpdatedAt ? fmtDateTime(entry.sourceUpdatedAt) : 'Unknown'}</dd></div>
        <div><dt>Retrieved</dt><dd>{fmtDateTime(entry.retrievedAt)}</dd></div>
        <div><dt>Cache</dt><dd>{entry.cacheStatus}</dd></div>
        <div><dt>Source hierarchy</dt><dd>{ancestry(projection.view, entry).map(parent => parent.entity.name).join(" / ") || "Unknown"}</dd></div>
        <div><dt>Source parent</dt><dd>{entry.entity.parent?.id ?? 'Unknown'}</dd></div>
        <div><dt>Mobility</dt><dd>{entry.mobility}</dd></div>
        <div><dt>Quantity</dt><dd>{entry.entity.quantity ?? 'Unknown'}</dd></div>
        {entry.entity.manufacturer && <div><dt>Manufacturer</dt><dd>{entry.entity.manufacturer}</dd></div>}
      </dl>
      <p className="fine">Source hierarchy does not establish physical placement.</p>
      {entry.nativeLinks.filter(link => link.verifiedRoute && sameScope(link.entity, entry) && sourceKey(link.entity.key) === entry.key).map(link => { const href = link.intent === 'view' ? safeWebUrl(link.href, true) : nativeLink(entry, link.intent, projection.view.canEdit); return href ? <a key={`${link.intent}:${link.href}`} className="btn" href={href} target="_blank" rel="noopener noreferrer">{link.intent === 'edit' ? 'Edit in HomeBox' : link.intent === 'maintenance' ? 'Upkeep in HomeBox' : 'View in HomeBox'}</a> : null; })}
      {entry.kind === 'place' && actions.editing && <PlaceEditor key={entry.key} entry={entry} client={actions.editing} refresh={actions.reload} />}
    </Section>
  </div>;
}
