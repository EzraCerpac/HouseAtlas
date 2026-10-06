// Browser-safe view helpers. The server validates contracts and authorizes first.
export const entityKey = p => JSON.stringify([p.source.sourceInstanceId, p.source.collectionId, p.source.sourceKind, p.source.externalId]);
export const cacheKey = p => JSON.stringify([p.sourceInstanceId, p.collectionId]);
export const sameScope = (a, b) => a.workspaceId === b.workspaceId && a.homeId === b.homeId;
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function safeWebUrl(value, { native = false } = {}) {
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || (native && (u.search || u.hash))) return null;
    // Links may never transport source credentials, including external URL attachments.
    if ([...u.searchParams.keys()].some(k => /token|key|secret|password|authorization|credential/i.test(k))) return null;
    return u.href;
  } catch { return null; }
}

export function safeMediaUrl(value) {
  // Only server-issued same-origin media capabilities, never proxyRef or source URLs.
  return typeof value === 'string' && /^\/api\/atlas\/media\/[A-Za-z0-9_/-]+$/.test(value) && !value.includes('..') ? value : null;
}

export function routeHref(page = 'home', key = null, { query = '', archived = false, documentId = null } = {}) {
  const params = new URLSearchParams();
  if (key !== null) params.set('key', key);
  if (query) params.set('q', query);
  if (archived) params.set('archived', '1');
  if (documentId) params.set('document',documentId);
  return `#${page}${params.size ? '?' + params : ''}`;
}

export function parseRoute(hash) {
  const [page, search = ''] = String(hash || '#home').slice(1).split('?');
  const params = new URLSearchParams(search);
  return { page: ['home','places','place','item','documents','maintenance','unplaced','search','settings'].includes(page) ? page : 'home', key: params.get('key'), query: (params.get('q') || '').slice(0, 512), archived: params.get('archived') === '1', documentId: /^[0-9a-f-]{36}$/.test(params.get('document') || '') ? params.get('document') : null };
}

export function visibleEntries(view, archived = false) {
  return view.status === 'ready' ? view.entries.filter(p => archived || !p.entity.archived) : [];
}

export function parentOf(view, p) {
  if (!p.entity.parent) return null;
  return view.entries.find(candidate => candidate.source.sourceInstanceId === p.source.sourceInstanceId && candidate.source.collectionId === p.source.collectionId && candidate.entity.id === p.entity.parent.id) || null;
}

export function ancestry(view, p) {
  const path = [], visited = new Set([p.key]);
  let next = parentOf(view, p);
  while (next && !visited.has(next.key)) { path.unshift(next); visited.add(next.key); next = parentOf(view, next); }
  return path;
}

export function childrenOf(view, p, archived = false) {
  return visibleEntries(view, archived).filter(candidate => parentOf(view, candidate)?.key === p.key);
}

export function placeCounts(view, p, archived = false) {
  const children = childrenOf(view, p, archived), visited = new Set([p.key]);
  let nested = 0;
  const visit = entry => {
    if (visited.has(entry.key)) return;
    visited.add(entry.key);
    for (const child of childrenOf(view, entry, archived)) {
      if (child.kind === 'item') nested++;
      visit(child);
    }
  };
  for (const child of children) if (child.kind !== 'item') visit(child);
  return { direct: children.filter(e => e.kind === 'item').length, nested };
}

export function searchEntries(view, query, archived = false) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return visibleEntries(view, archived).flatMap(p => {
    const fields = [p.entity.name, p.entity.description, p.entity.manufacturer, p.entity.modelNumber, p.entity.entityType?.name, ...p.aliases].join(' ').toLocaleLowerCase();
    const matches = text => words.every(word => text.includes(word));
    const documents = p.attachments.filter(a => matches([a.title, p.entity.name, p.entity.modelNumber, ...p.aliases].join(' ').toLocaleLowerCase()));
    return matches(fields) || documents.length ? [{ entry: p, documents }] : [];
  });
}

export function nativeLink(p, intent, canEdit) {
  if (!canEdit || p.sourceState !== 'present' || p.cacheStatus !== 'fresh') return null;
  const link = p.nativeLinks.find(l => l.intent === intent && l.verifiedRoute && entityKey({source:l.entity.key}) === p.key && sameScope(p, l.entity));
  return link ? safeWebUrl(link.href, {native:true}) : null;
}

export function sourceState(cache, now, staleAfterMs = 15 * 60 * 1000) {
  if (!cache) return 'empty';
  if (cache.status !== 'fresh') return cache.status;
  return Date.parse(now) - Date.parse(cache.lastSuccessfulFetchAt) > staleAfterMs ? 'stale' : 'fresh';
}
