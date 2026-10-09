import type { ReactNode } from 'react';
import type { Claim, Doc, EntityKind, WriteStatus } from '../data/types';
import { CLAIM_HELP, CLAIM_LABEL, KIND_LABEL, kindOf, nameOf } from '../data/query';
import { useSelect, useStore, type ViewId } from '../state/store';
import { Icon } from './Icon';

export const KIND_ICON: Record<EntityKind, string> = {
  space: 'rooms',
  item: 'box',
  unknown: 'file',
  container: 'box',
  panel: 'plug',
  circuit: 'plug',
  outlet: 'plug',
  valve: 'valve',
  device: 'wifi',
  cable: 'link',
  doc: 'file',
  task: 'upkeep',
};

function ClaimMark({ claim }: { claim: Claim }) {
  const common = { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true } as const;
  switch (claim) {
    case 'confirmed':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="5.5" fill="currentColor" />
          <path d="M3.5 6.2 5.2 7.8 8.6 4.4" stroke="#fff" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'owner':
      return (
        <svg {...common}>
          <circle cx="6" cy="4" r="2.2" fill="currentColor" />
          <path d="M1.8 11a4.2 4.2 0 0 1 8.4 0Z" fill="currentColor" />
        </svg>
      );
    case 'source':
      return (
        <svg {...common}>
          <path d="M2.5 1h5l2 2v8h-7Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M4.2 6h3.6 M4.2 8.4h3.6" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case 'disputed':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M6 1a5 5 0 0 1 0 10Z" fill="currentColor" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 1.6" />
        </svg>
      );
  }
}

export function ClaimBadge({ claim, prefix }: { claim: Claim; prefix?: string }) {
  return (
    <span className={`claim claim-${claim}`} title={CLAIM_HELP[claim]}>
      <ClaimMark claim={claim} />
      {prefix ? `${prefix}: ` : ''}
      {CLAIM_LABEL[claim]}
    </span>
  );
}

export function EntityLink({ id, label, view, sub }: { id: string; label?: string | undefined; view?: ViewId | undefined; sub?: string | undefined }) {
  const { house } = useStore();
  const select = useSelect();
  const kind = kindOf(id);
  if (!kind) return <span>{label ?? id}</span>;
  return (
    <button type="button" className="entity-link" onClick={() => select(id, view ? { view } : undefined)}>
      <Icon name={KIND_ICON[kind]} size={15} />
      <span className="entity-link-text">
        <span>{label ?? nameOf(house, id)}</span>
        {sub && <span className="entity-link-sub">{sub}</span>}
      </span>
    </button>
  );
}

export function KindTag({ kind }: { kind: EntityKind }) {
  return (
    <span className={`kind-tag kind-${kind}`}>
      <Icon name={KIND_ICON[kind]} size={14} />
      {KIND_LABEL[kind]}
    </span>
  );
}

export const WRITE_LABEL: Record<WriteStatus, string> = {
  queued: 'Queued',
  running: 'Sending',
  completed: 'Saved',
  uncertain: 'Result unknown',
  conflict: 'Needs review',
  discarded: 'Discarded',
};

export function WritePill({ status }: { status: WriteStatus }) {
  return (
    <span className={`write-pill write-${status}`}>
      <span className="write-dot" aria-hidden="true" />
      {WRITE_LABEL[status]}
    </span>
  );
}

export function StorageTag({ doc }: { doc: Doc }) {
  if (doc.storage === 'link') {
    return (
      <span className="storage storage-link" title="Only the address is kept. The file lives elsewhere.">
        <Icon name="link" size={13} />
        External link
      </span>
    );
  }
  return (
    <span className="storage storage-stored" title="A copy of the file is stored with the household records.">
      <Icon name={doc.kind === 'photo' ? 'photo' : 'file'} size={13} />
      Stored {doc.sizeKb !== undefined ? fmtSize(doc.sizeKb) : ''}
    </span>
  );
}

export function fmtSize(kb: number) {
  return kb >= 1000 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
}

export function Section({ title, count, children, action }: { title: string; count?: number; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="section">
      <header className="section-head">
        <h3>
          {title}
          {count !== undefined && <span className="section-count">{count}</span>}
        </h3>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Note({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <p className={`note note-${tone}`}>
      <Icon name={tone === 'warn' ? 'alert' : 'info'} size={15} />
      <span>{children}</span>
    </p>
  );
}
