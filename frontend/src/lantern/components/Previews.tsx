import { useState, type ReactNode } from 'react';
import type { Doc, HouseData } from '../data/types';
import { nameOf } from '../data/query';
import { fmtDate, fmtDateTime, rel } from '../data/time';
import { useSelect, useStore } from '../state/store';
import { Modal } from './Modal';
import { MediaScene } from './Art';
import { Icon } from './Icon';
import { Note, StorageTag, fmtDocSize } from './ui';
import { PinnedFileAction } from './PinnedFileAction';

// Previews of fictional demo documents, drawn as HTML and SVG.

export function PreviewDialog({ docId }: { docId: string }) {
  const { house, dispatch, state } = useStore();
  const select = useSelect();
  const doc = house.docs.find((d) => d.id === docId);
  if (!doc) return null;
  const close = () => dispatch({ type: 'dialog', dialog: null });
  const cached = state.settings.outage && doc.owner === 'HomeBox' && doc.storage === 'stored';
  return (
    <Modal
      wide
      title={doc.title}
      kicker={<StorageTag doc={doc} />}
      onClose={close}
      footer={
        <>
          <p className="sim-note">Fictional demo document.</p>
          <button type="button" className="btn btn-primary" onClick={close}>
            Done
          </button>
        </>
      }
    >
      <div className="preview-layout">
        <div className="preview-stage">
          {cached && <Note tone="warn">HomeBox is unreachable. This is the cached preview from {rel(house.sources.homeboxSyncedAt)}.</Note>}
          {doc.storage === 'link' ? <LinkPanel doc={doc} /> : <DocSheet doc={doc} house={house} />}
        </div>
        <aside className="preview-aside" aria-label="Provenance">
          <h3>Provenance</h3>
          <dl className="facts">
            <div>
              <dt>Kind</dt>
              <dd>{doc.storage === 'link' ? 'External link, address only' : `Stored ${doc.kind}${fmtDocSize(doc) ? `, ${fmtDocSize(doc)}` : ''}`}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{doc.source}</dd>
            </div>
            <div>
              <dt>Added</dt>
              <dd>
                {fmtDateTime(doc.addedAt)} by {doc.addedBy}
              </dd>
            </div>
            {doc.capturedAt && (
              <div>
                <dt>{doc.kind === 'export' ? 'Observed' : 'Captured'}</dt>
                <dd>{fmtDateTime(doc.capturedAt)}</dd>
              </div>
            )}
            {doc.retrievedAt && (
              <div>
                <dt>Retrieved</dt>
                <dd>{fmtDateTime(doc.retrievedAt)}</dd>
              </div>
            )}
            <div>
              <dt>Version</dt>
              <dd>
                {doc.version}
                {doc.versions ? ` of ${doc.versions.length}` : ''}
              </dd>
            </div>
          </dl>
          <PinnedFileAction docId={doc.id} />
          {doc.versions && (
            <ol className="history compact">
              {[...doc.versions].reverse().map((v) => (
                <li key={v.v}>
                  <span className="history-when">
                    v{v.v}, {fmtDate(v.at)}
                  </span>
                  <span className="history-what">{v.note}</span>
                </li>
              ))}
            </ol>
          )}
          <h3>Linked to</h3>
          {doc.linkedTo.length ? (
            <ul className="rows">
              {doc.linkedTo.map((l) => (
                <li key={l}>
                  <button
                    type="button"
                    className="entity-link"
                    onClick={() => {
                      close();
                      select(l);
                    }}
                  >
                    <Icon name="chevron" size={14} />
                    <span>{nameOf(house, l)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="fine">Used as the source for reviewed room shapes.</p>
          )}
        </aside>
      </div>
    </Modal>
  );
}

function LinkPanel({ doc }: { doc: Doc }) {
  const { dispatch } = useStore();
  const copy = () => {
    const url = doc.url ?? '';
    const done = () => dispatch({ type: 'toast', text: 'Address copied.', tone: 'ok' });
    const fail = () => dispatch({ type: 'toast', text: 'Couldn’t copy. Select the address and copy it by hand.', tone: 'warn' });
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, fail);
    else fail();
  };
  return (
    <div className="link-panel">
      <Icon name="link" size={34} />
      <h3>Not stored here</h3>
      <p>Atlas keeps this address and when it was last checked. The document itself lives on another site, so there is no preview and it may change without notice.</p>
      <p className="url-box">{doc.url}</p>
      <p className="fine">Last checked {doc.linkCheckedAt ? `${fmtDate(doc.linkCheckedAt)} (${rel(doc.linkCheckedAt)})` : 'never'}. This demo address cannot be opened.</p>
      <button type="button" className="btn" onClick={copy}>
        <Icon name="copy" size={16} /> Copy address
      </button>
    </div>
  );
}

function Page({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return (
    <figure className={`sheet${className ? ` ${className}` : ''}`} aria-label={label}>
      {children}
    </figure>
  );
}

function DocSheet({ doc, house }: { doc: Doc; house: HouseData }) {
  switch (doc.preview) {
    case 'manual':
      return <Manual doc={doc} />;
    case 'receipt':
      return <Receipt doc={doc} />;
    case 'eicr':
      return <Eicr house={house} />;
    case 'boiler-report':
      return (
        <Page label="Boiler service report">
          <header className="sheet-head">
            <strong>Service report</strong>
            <span>Heatwell CX28, fictional</span>
          </header>
          <table className="sheet-table">
            <tbody>
              {[
                ['Flue check', 'Pass'],
                ['Gas pressure', 'Within range'],
                ['System pressure', 'Low, topped up to 1.3 bar'],
                ['Condensate trap', 'Cleaned'],
                ['Drain-off valve', 'Closed, noted in plant room'],
                ['Electrical supply', 'Fused spur P1'],
              ].map(([a, b]) => (
                <tr key={a}>
                  <th>{a}</th>
                  <td>{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="sheet-hand">No faults found. Next service in 12 months.</p>
          <p className="sheet-foot">Demo document. Engineer and company are fictional.</p>
        </Page>
      );
    case 'panel-photo':
      return (
        <Page label="Photo of consumer unit labels" className="sheet-photo">
          <svg viewBox="0 0 400 260" className="photo-svg" role="img" aria-label="Eight breakers with handwritten labels: Kitchen, Downstairs, Upstairs, Cooker, Lights down, Lights up, Garage, and one blank">
            <rect width="400" height="260" fill="#D9D3C7" />
            <rect x="30" y="40" width="340" height="170" rx="8" fill="#F6F4EF" stroke="#9A9286" strokeWidth="2" />
            {['Kitchen', 'Downstairs', 'Upstairs', 'Cooker', 'Lts dn', 'Lts up', 'Garage', ''].map((l, i) => (
              <g key={i} transform={`translate(${52 + i * 40} 70)`}>
                <rect width="30" height="70" rx="3" fill="#FFFFFF" stroke="#7E776C" />
                <rect x="9" y="14" width="12" height="22" rx="2" fill="#2B3142" />
                <text x="15" y="62" textAnchor="middle" fontSize="9" fill="#555">
                  C{i + 1}
                </text>
                <text x="15" y="100" textAnchor="middle" fontSize="11" className="hand" transform={`rotate(-8 15 100)`}>
                  {l}
                </text>
              </g>
            ))}
            <rect x="52" y="160" width="300" height="2" fill="#9A9286" />
          </svg>
          <figcaption>Taken {fmtDateTime(doc.capturedAt)}. Labels are handwritten.</figcaption>
        </Page>
      );
    case 'stopcock-photo':
      return (
        <Page label="Photo of the main stopcock" className="sheet-photo">
          <svg viewBox="0 0 400 260" className="photo-svg" role="img" aria-label="A brass stopcock on a pipe below an open floor hatch">
            <rect width="400" height="260" fill="#5B5248" />
            <rect x="40" y="30" width="320" height="200" fill="#3E3730" stroke="#A88F6A" strokeWidth="10" />
            <path d="M40 160h320" stroke="#B8B2A8" strokeWidth="16" />
            <rect x="170" y="140" width="60" height="40" rx="6" fill="#C9A24B" />
            <path d="M200 140v-40" stroke="#C9A24B" strokeWidth="10" />
            <rect x="160" y="88" width="80" height="16" rx="6" fill="#B12F2A" />
            <path d="M260 92c20-14 40-14 56 0" stroke="#FFE39A" strokeWidth="4" fill="none" />
            <text x="290" y="76" fontSize="14" className="hand" fill="#FFE39A">
              clockwise = off
            </text>
          </svg>
          <figcaption>Taken {fmtDateTime(doc.capturedAt)}.</figcaption>
        </Page>
      );
    case 'ap-photo':
      return (
        <Page label="Photo of the landing access point" className="sheet-photo">
          <svg viewBox="0 0 400 260" className="photo-svg" role="img" aria-label="A round white access point on a ceiling near a light fitting">
            <rect width="400" height="260" fill="#EDEAE3" />
            <circle cx="200" cy="130" r="64" fill="#FFFFFF" stroke="#C9C3B8" strokeWidth="3" />
            <circle cx="200" cy="130" r="6" fill="#4FA36B" />
            <circle cx="320" cy="60" r="18" fill="#F7F1E0" stroke="#D2C9B6" />
          </svg>
          <figcaption>Taken {fmtDateTime(doc.capturedAt)}.</figcaption>
        </Page>
      );
    case 'wallplate-photo':
      return (
        <Page label="Photo of the study wall plate" className="sheet-photo">
          <svg viewBox="0 0 400 260" className="photo-svg" role="img" aria-label="A wall plate with two network sockets, one with a cable plugged in">
            <rect width="400" height="260" fill="#E4DED2" />
            <rect x="130" y="60" width="140" height="140" rx="8" fill="#FBFAF7" stroke="#C7C0B2" strokeWidth="3" />
            <rect x="152" y="100" width="40" height="34" rx="3" fill="#2B3142" />
            <rect x="208" y="100" width="40" height="34" rx="3" fill="#2B3142" />
            <path d="M172 134v80" stroke="#3C6FD1" strokeWidth="10" strokeLinecap="round" />
            <text x="200" y="170" textAnchor="middle" fontSize="14" className="hand">
              to landing
            </text>
          </svg>
          <figcaption>Taken {fmtDateTime(doc.capturedAt)}.</figcaption>
        </Page>
      );
    case 'router-export':
      return (
        <Page label="Router client list export">
          <header className="sheet-head">
            <strong>clients_2026-10-07.csv</strong>
            <span>Observed {fmtDateTime(doc.capturedAt)}, retrieved {fmtDateTime(doc.retrievedAt)}</span>
          </header>
          <table className="sheet-table mono-free">
            <thead>
              <tr>
                <th>Hardware ID</th>
                <th>Name field</th>
                <th>Connection</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {house.devices
                .filter((d) => doc.linkedTo.includes(d.id))
                .map((d) => {
                  const ob = [...d.observations].sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
                  return (
                    <tr key={d.id}>
                      <td>…{d.hardware.match(/ending ([\w:]+)/)?.[1] ?? 'none'}</td>
                      <td>{d.name}</td>
                      <td>{house.links.find((l) => l.to === d.id)?.kind ?? 'gateway'}</td>
                      <td>{ob ? ob.observedAt.slice(11, 16) : ''}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <p className="sheet-foot">Read-only import. Names were added in Atlas; the export itself only lists hardware IDs.</p>
        </Page>
      );
    case 'leaflet':
      return (
        <Page label="Smoke alarm leaflet">
          <header className="sheet-head">
            <strong>Testing your alarm</strong>
            <span>Leaflet, fictional</span>
          </header>
          <ol className="sheet-steps">
            <li>Press and hold the test button for five seconds.</li>
            <li>The alarm should sound loudly. Release the button.</li>
            <li>If it is quiet or silent, replace the alarm.</li>
            <li>Record the test so everyone knows it was done.</li>
          </ol>
        </Page>
      );
    case 'survey':
      return (
        <Page label="Survey sketch" className="sheet-sketch">
          <svg viewBox="0 0 400 280" className="photo-svg" role="img" aria-label="Hand-drawn plan sketch with room outlines and measurements">
            <rect width="400" height="280" fill="#F8F5EC" />
            <g fill="none" stroke="#3B4A7A" strokeWidth="1.6" strokeLinejoin="round">
              <rect x="40" y="40" width="300" height="210" />
              <path d="M165 40v95 M40 135h125 M115 135v115 M40 190h75 M165 135v115 M215 135v115 M165 135h175" />
            </g>
            <g className="hand" fontSize="13" fill="#3B4A7A">
              <text x="70" y="90">Kitchen</text>
              <text x="220" y="90">Living</text>
              <text x="50" y="165">Utility</text>
              <text x="55" y="225">Study</text>
              <text x="250" y="200">Garden rm</text>
              <text x="160" y="30">12.00</text>
              <text x="8" y="150" transform="rotate(-90 14 150)">9.00</text>
            </g>
          </svg>
          <figcaption>Version {doc.version}. Sketch measured with a laser measure. Fictional.</figcaption>
        </Page>
      );
    case 'note':
      return (
        <Page label="Owner note" className="sheet-note">
          <p className="sheet-hand big">
            Bath panel: think the isolation valve is behind the end nearest the basin. Didn’t take the panel off. Check before any plumbing work.
          </p>
          <p className="sheet-hand">Tomas, Sept 2025</p>
        </Page>
      );
    case 'insurance':
      return (
        <Page label="Contents insurance schedule">
          <header className="sheet-head">
            <strong>Schedule of specified items</strong>
            <span>Fictional policy, demo only</span>
          </header>
          <table className="sheet-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Room on schedule</th>
              </tr>
            </thead>
            <tbody>
              {doc.linkedTo.map((id) => (
                <tr key={id}>
                  <td>{nameOf(house, id)}</td>
                  <td>{house.items.find((i) => i.id === id)?.spaceId ? nameOf(house, house.items.find((i) => i.id === id)!.spaceId!) : 'Not stated'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="sheet-foot">Values omitted in this demo.</p>
        </Page>
      );
    case 'media':
      return (
        <Page label={doc.title} className="sheet-photo">
          <div className="photo-media">
            <MediaScene scene={doc.mediaVariant ?? 'wide'} />
          </div>
          <figcaption>
            {doc.title}. Taken {fmtDate(doc.capturedAt)}. Sample picture from the demo tray.
          </figcaption>
        </Page>
      );
    default:
      return <Note>No preview for this file type.</Note>;
  }
}

function Manual({ doc }: { doc: Doc }) {
  const [page, setPage] = useState(0);
  const isDw = doc.id === 'doc-dw-manual';
  const pages: { n: number; body: ReactNode }[] = [
    {
      n: 1,
      body: (
        <div className="manual-cover">
          <span className="manual-brand">{isDw ? 'Brightwash' : 'Emberline'}</span>
          <strong>{doc.title}</strong>
          <span>{isDw ? 'DW-400 integrated' : 'Emberline 5 stove'}, fictional model</span>
        </div>
      ),
    },
    {
      n: 3,
      body: (
        <>
          <h4>Contents</h4>
          <ol className="sheet-toc">
            <li>
              <span>Safety</span>
              <span>4</span>
            </li>
            <li>
              <span>Installation</span>
              <span>9</span>
            </li>
            <li>
              <span>Everyday use</span>
              <span>17</span>
            </li>
            <li>
              <span>{isDw ? 'Cleaning the filter' : 'Sweeping and ash'}</span>
              <span>31</span>
            </li>
            <li>
              <span>Troubleshooting</span>
              <span>36</span>
            </li>
          </ol>
        </>
      ),
    },
    {
      n: 31,
      body: (
        <>
          <h4>{isDw ? 'Cleaning the filter' : 'Sweeping and ash'}</h4>
          <svg viewBox="0 0 200 90" className="manual-fig" aria-hidden="true">
            <rect x="20" y="20" width="160" height="56" rx="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="100" cy="48" r="16" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M100 32v-18 M92 14h16 M124 40a24 24 0 0 1 0 16" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          <ol className="sheet-steps">
            {isDw ? (
              <>
                <li>Turn the filter anticlockwise and lift it out.</li>
                <li>Rinse under running water. Use a soft brush for grease.</li>
                <li>Refit and turn clockwise until it clicks.</li>
                <li>Clean monthly, or sooner if water is left in the base.</li>
              </>
            ) : (
              <>
                <li>Let the stove cool completely.</li>
                <li>Remove the ash pan and empty into a metal bucket.</li>
                <li>Have the flue swept once a year before winter.</li>
              </>
            )}
          </ol>
        </>
      ),
    },
  ];
  const p = pages[page];
  if (!p) return null;
  return (
    <div className="manual">
      <Page label={`${doc.title}, page ${p.n}`}>
        {p.body}
        <p className="sheet-foot">
          Page {p.n} of {doc.pages ?? '?'}. Demo excerpt.
        </p>
      </Page>
      <div className="pager" role="group" aria-label="Pages">
        <button type="button" className="btn btn-small" disabled={page === 0} onClick={() => setPage(page - 1)}>
          Previous page
        </button>
        <span aria-live="polite">
          Excerpt {page + 1} of {pages.length}
        </span>
        <button type="button" className="btn btn-small" disabled={page === pages.length - 1} onClick={() => setPage(page + 1)}>
          Next page
        </button>
      </div>
    </div>
  );
}

function Receipt({ doc }: { doc: Doc }) {
  const piano = doc.id === 'doc-piano-receipt';
  const lines = piano
    ? [
        ['Piano tuning, upright', '1'],
        ['Minor regulation', '1'],
      ]
    : [
        ['Integrated dishwasher DW-400', '1'],
        ['Installation kit', '1'],
        ['Removal of old unit', '1'],
      ];
  return (
    <Page label={doc.title} className="sheet-receipt">
      <p className="receipt-shop">{piano ? 'Tuneful Keys (fictional)' : 'Brightwash Store (fictional)'}</p>
      <p className="receipt-date">{fmtDate(doc.capturedAt)}</p>
      <table className="receipt-lines">
        <tbody>
          {lines.map(([a, b]) => (
            <tr key={a}>
              <td>{a}</td>
              <td>x{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="receipt-foot">Amounts removed from demo copy</p>
    </Page>
  );
}

function Eicr({ house }: { house: HouseData }) {
  const notes: Record<string, string> = {
    C1: 'Kitchen and utility ring',
    C2: 'Ground floor ring',
    C3: 'Page not scanned',
    C4: 'Cooker radial',
    C5: 'Lighting',
    C6: 'Lighting',
    C7: 'Cellar radial',
    C8: 'Not identified',
  };
  return (
    <Page label="Electrical condition report, schedule of circuits">
      <header className="sheet-head">
        <strong>Schedule of circuits</strong>
        <span>Page 7, Lumen & Sons (fictional)</span>
      </header>
      <table className="sheet-table">
        <thead>
          <tr>
            <th>Way</th>
            <th>Description in report</th>
            <th>Rating</th>
          </tr>
        </thead>
        <tbody>
          {house.circuits.map((c) => (
            <tr key={c.id} className={c.ref === 'C3' ? 'is-missing' : undefined}>
              <td>{c.ref}</td>
              <td>{notes[c.ref] ?? ''}</td>
              <td>{c.rating}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sheet-hand">Overall: satisfactory. Socket A2 stayed live with C3 off, investigate.</p>
      <p className="sheet-foot">Demo document. Inspector and firm are fictional.</p>
    </Page>
  );
}
