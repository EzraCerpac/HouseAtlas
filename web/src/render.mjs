import { copy, formatDate } from './copy.mjs';
import { escapeHtml as e, routeHref, visibleEntries, parentOf, ancestry, childrenOf, placeCounts, searchEntries, nativeLink, safeWebUrl } from './model.mjs';

// English-only local literals for the few labels that copy.mjs does not define.
// Placeholders are substituted first and the result is escaped, like copy().
const L = {
  placesTotal: 'Places',
  itemsTotal: 'Items',
  summary: 'In this view',
  more: 'and {0} more'
};

const PLACE_KINDS = ['room', 'floor', 'building', 'container'];

// Decorative category marks. They identify a kind of record and never depict the home.
const GLYPHS = {
  room: '<path d="M13 43V21a11 11 0 0 1 22 0v22z"/><circle class="knob" cx="30" cy="31" r="2.4"/>',
  floor: '<path d="M6 42v-8h9v-8h9v-8h9v-8h9v32z"/>',
  building: '<path d="M24 6 5 22h5v20h28V22h5z"/><rect class="knob" x="20" y="29" width="8" height="13" rx="1.5"/>',
  container: '<rect x="6" y="9" width="36" height="9" rx="2.5"/><path d="M9 20h30v18a4 4 0 0 1-4 4H13a4 4 0 0 1-4-4z"/><rect class="knob" x="18" y="25" width="12" height="4" rx="2"/>',
  place: '<circle cx="24" cy="24" r="16"/><rect class="knob" x="17" y="17" width="14" height="14" rx="3"/>',
  item: '<path d="M8 13a5 5 0 0 1 5-5h13l15 15a3 3 0 0 1 0 4L27 41a3 3 0 0 1-4 0L8 26z"/><circle class="knob" cx="16" cy="16" r="3.2"/>',
  unknown: '<circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" stroke-width="4" stroke-dasharray="6 5"/>'
};
const glyph = name => `<span class="glyph glyph-${GLYPHS[name] ? name : 'place'}" aria-hidden="true"><svg viewBox="0 0 48 48" focusable="false">${GLYPHS[name] || GLYPHS.place}</svg></span>`;
const BRAND_MARK = '<svg class="brand-mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><rect class="bm-plate" x="2" y="6" width="44" height="36" rx="7"/><rect class="bm-line" x="6" y="10" width="36" height="28" rx="4"/><path class="bm-door" d="M19 34V22a5 5 0 0 1 10 0v12z"/><circle class="bm-hole" cx="11" cy="24" r="1.8"/><circle class="bm-hole" cx="37" cy="24" r="1.8"/></svg>';
const SETTINGS_MARK = '<svg class="utility-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h9M19 7h1M4 17h3M13 17h7"/><circle cx="16" cy="7" r="2.6"/><circle cx="10" cy="17" r="2.6"/></svg>';
const SEARCH_MARK = '<svg class="search-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/></svg>';

export function renderAtlas(view, route, { refreshing = false, notice = '', canRefresh = false, canSignIn = false, canSwitchHome = false, canRetryHome = false } = {}) {
  const language = 'en';
  const t = (key, ...args) => e(copy(language, key, ...args));
  const l = (key, ...args) => e(L[key].replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? '')));
  const date = value => e(formatDate(value, language));
  const link = (label, page, key = null, extra = {}) => `<a data-focus-id="${e(page + (key || '') + (extra.query || '') + (extra.documentId || ''))}"${page === route.page && key === route.key ? ' aria-current="page"' : ''} href="${e(routeHref(page, key, { archived: route.archived, ...extra }))}">${label}</a>`;
  const external = (href, label, download = false) => `<a href="${e(href)}"${download ? ' download' : ' target="_blank" rel="noopener noreferrer"'}>${label}</a>`;
  const heading = (title, cls = '') => `<h1 id="page-heading" tabindex="-1"${cls ? ` class="${cls}"` : ''}>${title}</h1>`;
  const empty = key => `<p class="empty">${t(key)}</p>`;
  const badge = text => `<span class="badge">${text}</span>`;

  // Whole home or session unavailable: no private shell, names or home choices.
  if (view.status !== 'ready') {
    const stateKey = ['expired', 'revoked', 'denied'].includes(view.status) ? view.status : view.status === 'unavailable' ? 'viewUnavailable' : 'loading';
    const retry = canRetryHome && view.status === 'unavailable' ? `<button type="button" data-action="retry-home">${t('retry')}</button>` : '';
    const signIn = canSignIn && ['expired', 'revoked'].includes(stateKey) ? `<button type="button" data-action="sign-in">${t('signIn')}</button>` : '';
    return `<a class="skip" href="#page-heading">${t('skip')}</a><main class="access-state"><div class="access-panel"><p class="access-brand">${BRAND_MARK}<span>HouseAtlas</span></p>${heading(t(stateKey))}${retry || signIn ? `<div class="access-actions">${retry}${signIn}</div>` : ''}</div></main>`;
  }

  const caches = view.caches || [];
  const homeboxCaches = caches.filter(c => c.owner === 'homebox');
  const hasGeneration = homeboxCaches.some(c => c.lastSuccessfulFetchAt);
  const entries = visibleEntries(view, route.archived);
  const places = entries.filter(p => p.kind === 'place');

  const pageOf = p => p.kind === 'place' ? 'place' : 'item';
  const glyphKey = p => p.kind === 'place' ? (PLACE_KINDS.includes(p.semanticKind) ? p.semanticKind : 'place') : p.kind === 'unknown' ? 'unknown' : 'item';
  const kind = p => p.kind === 'place' ? t(PLACE_KINDS.includes(p.semanticKind) ? p.semanticKind : 'place') : t(p.kind === 'unknown' ? 'unknownType' : 'item');
  const typeName = p => p.entity.entityType?.name ? e(p.entity.entityType.name) : '';
  const isRootPlace = p => { const parent = parentOf(view, p); return !parent || parent.kind !== 'place'; };
  // Revoked markers carry no source identifiers, so they never match an entry.
  const cacheFor = p => p.source ? caches.find(c => c.sourceInstanceId && c.sourceInstanceId === p.source.sourceInstanceId && c.collectionId === p.source.collectionId) : undefined;

  const placement = p => {
    if (parentOf(view, p)) return ancestry(view, p).map(a => e(a.entity.name)).join(' › ');
    if (p.entity.parent) return t('missingParent');
    return t(p.mobility === 'mobile' ? 'mobile' : p.kind === 'place' ? 'root' : 'missingPlace');
  };
  const sourceFlag = p => p.sourceState !== 'present' ? t({ unresolved: 'unresolved', 'confirmed-deleted': 'deleted', unreviewed: 'review' }[p.sourceState] || 'review') : '';
  const recordStatus = p => `${p.entity.archived ? badge(t('archived')) : ''}${sourceFlag(p) ? `<p class="warning">${sourceFlag(p)}</p>` : ''}`;
  const flags = p => `${p.entity.archived ? `<span class="flag">${t('archived')}</span>` : ''}${sourceFlag(p) ? `<span class="flag flag-review">${sourceFlag(p)}</span>` : ''}`;
  const meta = p => `<p class="entry-meta"><span>${kind(p)}</span>${typeName(p) ? `<span class="entry-type">${typeName(p)}</span>` : ''}</p>`;

  // Enamel plate: cobalt for top-level places, inverse for places inside another place.
  const plate = (p, title, inset = !isRootPlace(p)) => `<div class="plate${inset ? ' plate-inset' : ''}"><p class="plate-kind"><span>${kind(p)}</span>${typeName(p) ? `<span class="plate-type">${typeName(p)}</span>` : ''}</p>${title}</div>`;

  const entry = (p, level = 3, tag = 'li') => {
    const k = glyphKey(p);
    const name = link(e(p.entity.name), pageOf(p), p.key);
    if (p.kind === 'place') {
      const counts = placeCounts(view, p, route.archived);
      return `<${tag} class="entry is-place kind-${k}">${plate(p, `<h${level} class="plate-name">${name}</h${level}>`)}<div class="entry-body"><p class="muted">${placement(p)}</p><p class="count">${t('counts', counts.direct, counts.nested)}</p>${recordStatus(p)}</div></${tag}>`;
    }
    return `<${tag} class="entry is-item kind-${k}">${glyph(k)}<div class="entry-body">${meta(p)}<h${level} class="entry-name">${name}</h${level}><p class="muted">${placement(p)}</p>${p.entity.modelNumber ? `<p class="model">${t('model')}: ${e(p.entity.modelNumber)}</p>` : ''}${recordStatus(p)}</div></${tag}>`;
  };
  const plateList = list => `<ul class="plate-list">${list.map(p => entry(p)).join('')}</ul>`;
  const rowList = (list, level = 3) => `<ul class="row-list">${list.map(p => entry(p, level)).join('')}</ul>`;

  const byKind = list => [...list].sort((a, b) => (a.kind === 'place' ? 0 : 1) - (b.kind === 'place' ? 0 : 1));
  const tree = (node, seen, limit = Infinity, depth = 1) => {
    const kids = byKind(childrenOf(view, node, route.archived)).filter(k => !seen.has(k.key));
    if (!kids.length) return '';
    const shown = kids.slice(0, limit);
    shown.forEach(k => seen.add(k.key));
    const rest = kids.length - shown.length;
    const deeper = limit === Infinity && depth < 8;
    return `<ul class="tree">${shown.map(k => `<li class="tree-${k.kind === 'place' ? 'place' : 'item'}">${glyph(glyphKey(k))}<span class="tree-label">${link(e(k.entity.name), pageOf(k), k.key)}${flags(k)}</span>${deeper ? tree(k, seen, limit, depth + 1) : ''}</li>`).join('')}${rest > 0 ? `<li class="tree-more">${l('more', rest)}</li>` : ''}</ul>`;
  };
  const roomBlock = (p, full, level) => {
    const counts = placeCounts(view, p, route.archived);
    return `<li class="room kind-${glyphKey(p)}">${plate(p, `<h${level} class="plate-name">${link(e(p.entity.name), 'place', p.key)}</h${level}>`, false)}<p class="muted">${placement(p)}</p><p class="count">${t('counts', counts.direct, counts.nested)}</p>${recordStatus(p)}${tree(p, new Set([p.key]), full ? Infinity : 5)}</li>`;
  };

  const cacheBlock = (c, inline = false) => {
    const status = c?.status === 'access-revoked' ? 'access-revoked' : c?.displayStatus || 'empty';
    const state = status === 'access-revoked' ? t('sourceDenied')
      : status === 'error' ? (c.lastSuccessfulFetchAt ? t('unavailable', formatDate(c.lastSuccessfulFetchAt, language)) : t('noCache'))
      : status === 'stale' ? t('stale', formatDate(c.lastSuccessfulFetchAt, language))
      : status === 'empty' ? t('emptySource')
      : `${t('success')}: ${date(c.lastSuccessfulFetchAt)}`;
    const tone = status === 'fresh' ? 'fresh' : status === 'access-revoked' ? 'warning denied' : 'warning';
    const note = !inline && (status === 'stale' || status === 'error') ? `<p class="source-note">${t('cacheNote')}</p>` : '';
    return `<div class="source-state ${tone}${inline ? ' compact' : ''}"><p>${state}</p>${note}</div>`;
  };
  const freshness = p => `<details class="source-details"><summary>${t('details')}</summary><dl><dt>${t('success')}</dt><dd>${date(cacheFor(p)?.lastSuccessfulFetchAt)}</dd><dt>${t('sourceUpdated')}</dt><dd>${date(p.sourceUpdatedAt)}</dd><dt>${t('retrieved')}</dt><dd>${date(p.retrievedAt)}</dd></dl></details>`;
  const actionLinks = p => {
    const edit = nativeLink(p, 'edit', view.canEdit), maintenanceLink = nativeLink(p, 'maintenance', view.canEdit);
    return view.canEdit ? `<div class="actions">${edit ? external(edit, t('edit')) : `<span class="muted">${t('linkUnavailable')}</span>`}${maintenanceLink ? external(maintenanceLink, t('maintenanceEdit')) : ''}</div>` : '';
  };

  const docs = (list, place = false) => list.length ? `<ul class="document-list">${list.map(a => {
    const web = a.kind === 'external-link' && safeWebUrl(a.url);
    const type = a.contentType || copy(language, 'unknownFormat');
    const stored = a.kind === 'stored-file' && a.downloadHref;
    const about = a.kind === 'external-link' ? `<p class="doc-kind"><span>${t('external')}</span></p>` : `<p class="doc-kind"><span>${t('storedFile')}</span><span>${e(type)}</span></p>`;
    const access = web ? `<p class="destination">${e(new URL(web).hostname)}</p>${external(web, t('externalOpen'))}` : stored ? external(a.downloadHref, t('download'), true) : `<p class="warning">${t(a.kind === 'external-link' ? 'unavailableLinkReference' : 'unavailableReference')}</p>`;
    return `<li id="doc-${e(a.attachmentId)}" class="${web ? 'doc-web' : stored ? 'doc-file' : 'doc-missing'}"><h3 id="doc-heading-${e(a.attachmentId)}" tabindex="-1">${e(a.title || type)}</h3>${about}${access}</li>`;
  }).join('')}</ul>` : empty(place ? 'emptyPlaceDocuments' : 'emptyDocuments');

  const maintenance = p => {
    if (!p.maintenance.length) return empty(p.kind === 'place' ? 'emptyPlaceMaintenance' : 'emptyMaintenance');
    return [{ key: 'scheduled', list: p.maintenance.filter(m => !m.completedDate) }, { key: 'completed', list: p.maintenance.filter(m => m.completedDate) }]
      .filter(s => s.list.length)
      .map(s => `<h3 class="log-title">${t(s.key)}</h3><ul class="log log-${s.key}">${s.list.map(m => `<li><h4>${e(m.name)}</h4><p class="log-date">${m.completedDate ? t('done', formatDate(m.completedDate, language)) : m.scheduledDate ? t('due', formatDate(m.scheduledDate, language)) : t('unscheduled')}</p>${m.description ? `<p>${e(m.description)}</p>` : ''}${m.cost !== null && m.cost !== undefined ? `<p class="log-cost">${t('cost')}: ${e(m.cost)} <span class="muted">(${t('currencyUnknown')})</span></p>` : ''}</li>`).join('')}</ul>`).join('');
  };

  // Network details come only from this entry's bound partitions and never change placement.
  const network = p => {
    const relations = p.networkRelations || [];
    if (!relations.length && !p.networkBound) return '';
    const states = p.networkStates || [];
    const state = !states.length || states.some(s => ['empty', 'error'].includes(s)) ? t('networkUnavailable') : states.includes('stale') ? t('networkSaved') : '';
    return `<section class="network"><h2>${t('network')}</h2>${state ? `<p class="warning">${state}</p>` : ''}<p class="muted">${t('networkIndependent')}</p>${relations.map(n => `<details><summary>${t(n.kind === 'network-segment-membership' ? 'membership' : n.temporalStatus !== 'current-claim' ? 'historical' : 'connection')}</summary><dl><dt>${t('revision')}</dt><dd>${e(n.sourceRevision ?? copy(language, 'unknown'))}</dd><dt>${t('sourceConfidence')}</dt><dd>${t({ confirmed: 'confirm', reported: 'reported', inferred: 'inferred' }[n.sourceConfidence] || 'confidenceUnknown')}</dd><dt>${t('evidenceBasis')}</dt><dd>${t({ 'owner-report': 'ownerReport', observation: 'observation', inference: 'inference' }[n.evidenceBasis] || 'evidenceUnknown')}</dd><dt>${t('factAt')}</dt><dd>${date(n.factAt)}</dd><dt>${t('retrieved')}</dt><dd>${date(n.retrievedAt)}</dd><dt>${t('snapshot')}</dt><dd>${date(n.sourceSnapshotAt)}</dd><dt>${t('vantage')}</dt><dd>${e(n.vantage ?? copy(language, 'unknown'))}</dd></dl>${n.notes ? `<p>${e(n.notes)}</p>` : ''}</details>`).join('')}</section>`;
  };

  const resources = p => {
    const photos = p.attachments.filter(a => a.kind === 'stored-file' && /^image\//.test(a.contentType || ''));
    return `<section class="photos-section"><h2>${t('photo')}</h2>${photos.length ? `<div class="photos">${photos.map(a => `<figure>${a.previewHref ? `<img data-media data-media-kind="${p.kind === 'place' ? 'place' : 'item'}" alt="${t('photoAlt', p.entity.name, a.title)}" src="${e(a.previewHref)}" width="640" height="400"><figcaption>${e(a.title ?? '')}</figcaption>` : `<div class="photo-placeholder"><p class="photo-title">${e(a.title ?? '')}</p><p>${t(p.kind === 'place' ? 'placeFileUnavailable' : 'fileUnavailable')}</p></div>`}</figure>`).join('')}</div>` : empty(p.kind === 'place' ? 'noPlacePhotos' : 'noPhotos')}</section><section id="documents"><h2>${t('documents')}</h2>${docs(p.attachments, p.kind === 'place')}</section><section><h2>${t('maintenance')}</h2>${maintenance(p)}</section>${network(p)}`;
  };

  // Where an item is kept, read top-down like an address. Text only; the breadcrumbs carry the links.
  const address = p => {
    if (!parentOf(view, p)) return `<p class="where-note${p.entity.parent || p.mobility !== 'mobile' ? ' warning' : ''}">${placement(p)}</p>`;
    const chain = ancestry(view, p);
    return `<ol class="address">${chain.map((a, i) => `<li class="step-${Math.min(i, 6)}${i === 0 && a.kind === 'place' ? ' address-room' : ''}">${glyph(glyphKey(a))}<span>${e(a.entity.name)}</span></li>`).join('')}<li class="address-here step-${Math.min(chain.length, 6)}">${glyph(glyphKey(p))}<span>${e(p.entity.name)}</span></li></ol>`;
  };

  let content = '';
  if (route.page === 'settings') {
    const homes = view.homes || [];
    content = `${heading(t('settings'))}<div class="settings-list"><section class="setting"><div class="setting-text"><h2>${t('homeSelect')}</h2></div><select data-action="home" aria-label="${t('homeSelect')}"${canSwitchHome ? '' : ' disabled'}>${homes.map(h => `<option value="${e(h.homeId)}"${h.homeId === view.scope?.homeId ? ' selected' : ''}>${e(h.label)}</option>`).join('')}</select></section><section class="setting"><div class="setting-text"><h2>${t('saved')}</h2></div><div class="setting-sources">${homeboxCaches.length ? homeboxCaches.map(c => cacheBlock(c, true)).join('') : cacheBlock(null, true)}</div></section></div>`;
  } else if (['place', 'item'].includes(route.page)) {
    const p = entries.find(p => p.key === route.key);
    if (!p) content = heading(t('notFound')) + ((view.entries || []).some(p => p.key === route.key && p.entity.archived) ? empty('archivedHidden') : '');
    else {
      const ancestors = ancestry(view, p);
      const crumbs = `<nav class="breadcrumbs" aria-label="${t('location')}">${link(t('home'), 'home')}${ancestors.map(a => `<span class="crumb-sep" aria-hidden="true">›</span>${link(e(a.entity.name), pageOf(a), a.key)}`).join('')}</nav>`;
      const k = glyphKey(p);
      const head = p.kind === 'place'
        ? `<div class="record-head place-head">${plate(p, heading(e(p.entity.name), 'plate-name'))}</div>`
        : `<div class="record-head item-head kind-${k}">${glyph(k)}<div class="record-title">${meta(p)}${heading(e(p.entity.name))}</div></div>`;
      const sourceCache = cacheFor(p);
      content = `${crumbs}${head}${p.entity.description ? `<p class="lead">${e(p.entity.description)}</p>` : ''}${recordStatus(p)}${sourceCache ? cacheBlock(sourceCache, true) : ''}${actionLinks(p)}`;
      if (p.kind === 'place') {
        const children = childrenOf(view, p, route.archived);
        const childPlaces = children.filter(c => c.kind === 'place');
        const childItems = children.filter(c => c.kind !== 'place');
        const nested = entries.filter(c => c.kind === 'item' && ancestry(view, c).some(a => a.key === p.key) && parentOf(view, c)?.key !== p.key);
        content += `<section><h2>${t('childPlaces')}</h2>${childPlaces.length ? plateList(childPlaces) : empty('emptyPlaces')}</section><section><h2>${t('directItems')}</h2>${childItems.length ? rowList(childItems) : empty('emptyItems')}</section>${nested.length ? `<section><h2>${t('nestedItems')}</h2>${rowList(nested)}</section>` : ''}`;
      } else {
        const specs = ['manufacturer', 'modelNumber', 'serialNumber', 'quantity', 'notes'].map(field => {
          const value = p.entity[field];
          const missing = value === null || value === undefined || value === '';
          return `<div class="spec spec-${field}${missing ? ' is-unknown' : ''}"><dt>${t({ modelNumber: 'model', serialNumber: 'serial' }[field] || field)}</dt><dd>${e(missing ? copy(language, 'unknown') : value)}</dd></div>`;
        }).join('');
        content += `<section class="whereabouts"><h2>${t('location')}</h2>${address(p)}</section><dl class="rating-plate">${specs}</dl>`;
      }
      content += resources(p) + freshness(p);
    }
  } else if (route.page === 'search') {
    const results = searchEntries(view, route.query, route.archived);
    content = `${heading(t('searchTitle'))}<p class="result-count" role="status">${results.length ? t('results', results.length) : t('noResults', route.query)}</p>${results.length ? `<ol class="results">${results.map(({ entry: p, documents }) => `<li class="result">${entry(p, 2, 'div')}${documents.length ? `<div class="search-documents"><p>${t('docOwner', p.entity.name)}</p><ul class="doc-links">${documents.map(a => `<li>${link(e(a.title || a.contentType || copy(language, 'unknownFormat')), pageOf(p), p.key, { documentId: a.attachmentId })}</li>`).join('')}</ul></div>` : ''}</li>`).join('')}</ol>` : ''}<p class="clear-search">${link(t('clear'), 'home')}</p>`;
  } else if (route.page === 'documents' || route.page === 'maintenance') {
    const isDocs = route.page === 'documents';
    const matched = entries.filter(p => isDocs ? p.attachments.length : p.maintenance.length);
    content = `${heading(t(route.page))}${matched.length ? matched.map(p => `<section class="owner"><div class="owner-head">${glyph(glyphKey(p))}<div><h2>${link(e(p.entity.name), pageOf(p), p.key)}</h2><p class="muted">${placement(p)}</p></div></div>${isDocs ? docs(p.attachments, p.kind === 'place') : maintenance(p)}</section>`).join('') : empty(isDocs ? 'noIndexDocuments' : 'noIndexMaintenance')}`;
  } else if (route.page === 'unplaced') {
    const unplaced = entries.filter(p => p.kind === 'item' && (!p.entity.parent || !parentOf(view, p)));
    content = `${heading(t('unplaced'))}${unplaced.length ? rowList(unplaced, 2) : empty('emptyUnplaced')}`;
  } else {
    const isHome = route.page === 'home';
    const roots = places.filter(p => !parentOf(view, p) || parentOf(view, p)?.kind !== 'place');
    const unknown = entries.filter(p => p.kind === 'unknown');
    const unplaced = entries.filter(p => p.kind === 'item' && (!p.entity.parent || !parentOf(view, p)));
    const sources = homeboxCaches.length ? homeboxCaches.map(c => cacheBlock(c)).join('') : cacheBlock(null);
    const itemTotal = entries.filter(p => p.kind === 'item').length;
    const docTotal = entries.reduce((n, p) => n + (p.attachments || []).length, 0);
    const maintTotal = entries.reduce((n, p) => n + (p.maintenance || []).length, 0);
    const tally = `<ul class="tally" aria-label="${l('summary')}"><li><strong>${places.length}</strong> ${l('placesTotal')}</li><li><strong>${itemTotal}</strong> ${l('itemsTotal')}</li><li><strong>${docTotal}</strong> ${t('documents')}</li><li><strong>${maintTotal}</strong> ${t('maintenance')}</li></ul>`;
    const rooms = roots.length ? `<ul class="room-grid">${roots.map(p => roomBlock(p, !isHome, isHome ? 3 : 2)).join('')}</ul>` : hasGeneration ? empty('emptyPlaces') : '';
    content = isHome
      ? `<div class="opening">${heading(t('home'))}${tally}<div class="opening-sources">${sources}</div></div><section class="rooms"><h2>${t('places')}</h2>${rooms}</section><section class="unplaced-preview"><h2>${link(t('unplaced'), 'unplaced')}</h2>${unplaced.length ? rowList(unplaced) : empty('emptyUnplaced')}</section>`
      : `${heading(t('places'))}${sources}<section class="rooms rooms-all">${rooms}</section>`;
    if (unknown.length) content += `<section><h2>${t('unknownRecords')}</h2>${rowList(unknown)}</section>`;
    if (hasGeneration && !roots.length) content += `<p>${t(view.canEdit ? 'editorHelp' : 'readerHelp')}</p>`;
  }
  if (route.page !== 'settings' && !hasGeneration) content = heading(t('home')) + (homeboxCaches.map(c => cacheBlock(c)).join('') || cacheBlock(null));

  const navigation = ['home', 'places', 'documents', 'maintenance', 'unplaced'];
  const pathName = p => [...ancestry(view, p).map(a => a.entity.name), p.entity.name].join(' / ');
  const orderedPlaces = hasGeneration ? [...places].sort((a, b) => pathName(a).localeCompare(pathName(b))) : [];
  const rail = orderedPlaces.map(p => `<li class="depth-${Math.min(ancestry(view, p).length, 6)}">${link(e(p.entity.name), 'place', p.key)}</li>`).join('');
  const houseIndex = rail ? `<nav class="house-index" aria-label="${t('places')}"><p class="index-title">${t('allPlaces')}</p><ul class="place-rail">${rail}</ul></nav>` : '';
  const networkDenied = caches.some(c => c.owner === 'network' && c.status === 'access-revoked') ? `<p class="warning source-denied">${t('networkDenied')}</p>` : '';

  return `<a class="skip" href="#page-heading">${t('skip')}</a><header class="masthead"><div class="masthead-inner"><a class="brand" href="#home">${BRAND_MARK}<span class="brand-text"><span class="brand-name">HouseAtlas</span><span class="brand-home">${e(view.homeLabel ?? '')}</span></span></a><form id="search-form" role="search"><label class="sr-only" for="atlas-search">${t('search')}</label><div class="search-row">${SEARCH_MARK}<input id="atlas-search" name="q" type="search" maxlength="512" placeholder="${t('search')}" value="${e(route.query ?? '')}"><button type="submit">${t('searchButton')}</button></div><div class="search-meta"><label class="archive-toggle"><input id="atlas-archives" type="checkbox" name="archived"${route.archived ? ' checked' : ''}><span>${t('archives')}</span></label></div></form><nav class="utility" aria-label="${t('settings')}">${link(`${SETTINGS_MARK}<span>${t('settings')}</span>`, 'settings')}</nav></div></header><div class="frame"><nav class="sections" aria-label="${t('home')}"><ul>${navigation.map(page => `<li>${link(t(page), page)}</li>`).join('')}</ul></nav><main id="main-content"><div class="statusline">${canRefresh ? `<button type="button" class="refresh" data-action="refresh"${refreshing ? ' disabled' : ''}>${t(refreshing ? 'refreshing' : 'refresh')}</button>` : ''}<p id="notice" role="status" aria-live="polite">${e(notice)}</p></div>${networkDenied}${content}</main>${houseIndex}</div>`;
}
