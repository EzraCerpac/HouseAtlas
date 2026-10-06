import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareAtlasView } from '../src/prepare.mjs';
import { renderAtlas } from '../src/render.mjs';
import { parseRoute, routeHref, entityKey, parentOf, placeCounts, searchEntries, nativeLink, safeMediaUrl, safeWebUrl } from '../src/model.mjs';
import { messages } from '../src/copy.mjs';
import { demoSnapshot, demoOptions, demoScope, namedEntry } from '../demo/fixtures.mjs';
const render=(view,page='home',key=null,extra={})=>renderAtlas(view,{page,key,query:'',archived:false,...extra});
const fixture=(scenario='normal')=>{const snapshot=demoSnapshot(scenario),options=demoOptions(snapshot,scenario);return {snapshot,options,view:prepareAtlasView(snapshot,options)};};

test('unmodified frozen projection snapshot is consumed without changing its shape or timestamps',()=>{
  const snapshot=JSON.parse(readFileSync(new URL('../../packages/contracts/fixtures/plan-free.snapshot.json',import.meta.url)));
  const before=JSON.stringify(snapshot),{options}=fixture();const view=prepareAtlasView(snapshot,options);
  assert.equal(JSON.stringify(snapshot),before);assert.equal(view.entries.length,4);assert.equal(view.caches[0].lastSuccessfulFetchAt,snapshot.caches[0].lastSuccessfulFetchAt);
});
test('arbitrary containers and direct/nested counts need no floor or drawing',()=>{
  const {view}=fixture(),room=namedEntry(view,'Sitting room'),cabinet=namedEntry(view,'Display cabinet');
  assert.equal(cabinet.semanticKind,'unclassified');assert.equal(parentOf(view,cabinet).key,room.key);
  assert.deepEqual(placeCounts(view,room),{direct:1,nested:1});
  assert.match(render(view,'place',room.key),/Items here/);assert.match(render(view,'place',room.key),/Items in child places/);
  assert.match(render(view,'place',cabinet.key),/Cabinet/);assert.doesNotMatch(render(view),/floor selector|floorplan|Create floor/i);
});
test('current interface is English only and home selection lives in Settings',()=>{
  assert.deepEqual(Object.keys(messages.en).sort(),Object.keys(messages.nl).sort());
  const {view}=fixture();const html=renderAtlas(view,parseRoute('#home'),{language:'nl'});
  assert.match(html,/Rooms &amp; places/);assert.match(html,/Sitting room/);assert.doesNotMatch(html,/data-action="language"|data-action="home"/);
  assert.match(render(view,'settings'),/data-action="home"/);assert.equal(parseRoute('#settings').page,'settings');
});
test('search matches name, model, reviewed alias and document title within home',()=>{
  const {view}=fixture();for(const query of ['Portable','Audio 12','travel radio','manual']) assert.ok(searchEntries(view,query).some(r=>r.entry.entity.name==='Portable radio'));
  assert.equal(searchEntries(view,'manual')[0].documents[0].title,'Audio 12 manual');
  assert.equal(searchEntries(view,'does-not-exist').length,0);
});
test('mobile requires reviewed scoped hints; missing fixed placement and missing type stay distinct',()=>{
  const {view,snapshot,options}=fixture();const html=render(view,'unplaced');assert.match(html,/Moves around; no fixed place/);assert.match(html,/Place not recorded/);
  const noHint=prepareAtlasView(snapshot,{...options,hints:[]});assert.equal(namedEntry(noHint,'Portable radio').mobility,'unknown');
  const wrongHint=structuredClone(options.hints);wrongHint[0].entity.homeId='00000000-0000-4000-8000-000000000003';
  assert.equal(namedEntry(prepareAtlasView(snapshot,{...options,hints:wrongHint}),'Portable radio').mobility,'unknown');
  assert.match(render(view),/Type not recorded/);assert.equal(namedEntry(view,'Record with type missing').kind,'unknown');
});
test('archived results require explicit opt in, including direct URLs',()=>{
  const {view}=fixture();const archived=namedEntry(view,'Archived drawer');
  assert.equal(searchEntries(view,'Archived').length,0);assert.equal(searchEntries(view,'Archived',true).length,1);
  assert.doesNotMatch(render(view,'item',archived.key),/Archived drawer/);assert.match(render(view,'place',archived.key,{archived:true}),/Archived in HomeBox/);
});
test('duplicate names and UUIDs in other homes/sources never merge hierarchy or search',()=>{
  const {snapshot,options}=fixture();const extra=structuredClone(snapshot.homeboxEntities[0]);
  extra.homeId='00000000-0000-4000-8000-000000000003';extra.source.sourceInstanceId='00000000-0000-4000-8000-000000000011';extra.source.collectionId='synthetic-collection-b';extra.entity.name='Other home secret';extra.entity.parent=null;extra.nativeLinks=[];
  snapshot.homeboxEntities.push(extra);const cache=structuredClone(snapshot.caches[0]);cache.homeId=extra.homeId;cache.sourceInstanceId=extra.source.sourceInstanceId;cache.collectionId=extra.source.collectionId;snapshot.caches.push(cache);
  const view=prepareAtlasView(snapshot,options);assert.doesNotMatch(JSON.stringify(view),/Other home secret/);assert.equal(searchEntries(view,'secret').length,0);
  const sameHome=structuredClone(snapshot.homeboxEntities[0]);sameHome.source.sourceInstanceId='00000000-0000-4000-8000-000000000013';sameHome.source.collectionId='other';sameHome.nativeLinks=[];
  snapshot.sources.push({...snapshot.sources[0],sourceInstanceId:sameHome.source.sourceInstanceId,collectionId:'other'});
  snapshot.caches.push({...snapshot.caches[0],sourceInstanceId:sameHome.source.sourceInstanceId,collectionId:'other'});snapshot.homeboxEntities.push(sameHome);
  const scoped=prepareAtlasView(snapshot,options);assert.equal(scoped.entries.filter(p=>p.entity.name==='Display cabinet').length,2);assert.notEqual(entityKey(sameHome),entityKey(snapshot.homeboxEntities[0]));
});
test('denied and expired access precede snapshot parsing and reveal no private titles, counts or home choices',()=>{
  for(const reason of ['denied','expired','revoked']) {
    const view=prepareAtlasView({sensitive:'secret'},{authorization:{allowed:false,reason},homeLabel:'Hidden home'});
    assert.doesNotMatch(JSON.stringify(view),/secret|Hidden/);const html=render(view);assert.doesNotMatch(html,/Hidden|search-form|option|records/);
  }
});
test('true home revocation discards private data even though persisted projections remain',()=>{
  const {view,snapshot}=fixture('revoked');assert.ok(snapshot.homeboxEntities.length);assert.equal(view.status,'revoked');
  assert.doesNotMatch(JSON.stringify(view),/Portable radio|sourceInstanceId|Example home/);assert.doesNotMatch(render(view),/search-form|Display cabinet/);
});
test('Network-only quarantine retains authorized HomeBox browsing and removes all denied evidence',()=>{
  const {view,snapshot}=fixture('network-quarantine'),radio=namedEntry(view,'Portable radio');
  assert.equal(view.status,'ready');assert.equal(view.homes.length,1);assert.equal(radio.networkBound,false);assert.deepEqual(radio.networkRelations,[]);assert.deepEqual(radio.networkStates,[]);
  assert.equal(view.caches[0].lastSuccessfulFetchAt,snapshot.caches[0].lastSuccessfulFetchAt);
  assert.equal(radio.attachments.at(-1).previewHref,'/api/atlas/media/example-photo');assert.equal(searchEntries(view,'manual').length,1);
  const encoded=JSON.stringify(view);assert.doesNotMatch(encoded,/device-a|segment-a|member-a|source-reported|Synthetic source denial|00000000-0000-4000-8000-000000000012/);
  assert.deepEqual(view.caches.at(-1),{owner:'network',status:'access-revoked',displayStatus:'access-revoked'});
  assert.match(render(view,'item',radio.key),/Network source is unavailable/);assert.match(render(view,'documents'),/Audio 12 manual/);
});
test('HomeBox quarantine hides only its exact collection including capabilities, search and hierarchy',()=>{
  const {snapshot,options}=fixture('editor'),clone=structuredClone(snapshot.homeboxEntities[1]);
  clone.source.collectionId='denied-collection';clone.entity.name='Denied private item';clone.entity.description='Denied private description';clone.nativeLinks=[];
  snapshot.sources.push({...snapshot.sources[0],collectionId:clone.source.collectionId});snapshot.homeboxEntities.push(clone);
  snapshot.caches.push({...snapshot.caches[0],collectionId:clone.source.collectionId,status:'access-revoked'});
  const entity={...demoScope,key:clone.source};options.hints.push({entity,reviewed:true,aliases:['denied alias']});options.media.push({entity,attachmentId:clone.attachments[0].attachmentId,authorized:true,downloadHref:'/api/atlas/media/denied-file'});
  options.navigation.push({kind:'homebox-native',intent:'edit',entity,verifiedRoute:true,href:'https://synthetic.example.invalid/denied-editor'});
  const view=prepareAtlasView(snapshot,options),radio=namedEntry(view,'Portable radio');
  assert.equal(view.status,'ready');assert.equal(view.entries.length,8);assert.ok(nativeLink(radio,'edit',true));assert.equal(parentOf(view,namedEntry(view,'Display cabinet')).entity.name,'Sitting room');
  assert.doesNotMatch(JSON.stringify(view),/Denied private|denied alias|denied-file|denied-editor|denied-collection/);assert.equal(searchEntries(view,'denied').length,0);
  assert.match(render(view,'documents'),/Audio 12 manual/);assert.match(render(view),/saved details are hidden/);
});
test('all HomeBox partitions quarantined give explicit denial without empty-inventory claims',()=>{
  const {view}=fixture('homebox-quarantine');assert.equal(view.status,'ready');assert.deepEqual(view.entries,[]);assert.equal(view.homes.length,1);
  for(const page of ['home','documents','maintenance','search','unplaced']) {const html=render(view,page,null,{query:'manual'});assert.match(html,/saved details are hidden/);assert.doesNotMatch(html,/No places recorded|No documents|No maintenance|No matches|Last successful update/);}
  assert.match(render(view,'settings'),/data-action="home"/);
});
test('Network binding revocation removes relation and association data without hiding inventory',()=>{
  const {snapshot,options}=fixture();snapshot.records.find(r=>r.recordType==='binding' && r.payload.source.sourceKind==='network-device').payload.sourceState='access-revoked';
  const view=prepareAtlasView(snapshot,options),radio=namedEntry(view,'Portable radio');assert.equal(radio.networkBound,false);assert.deepEqual(radio.networkRelations,[]);assert.doesNotMatch(JSON.stringify(view),/device-a|member-a/);assert.match(render(view,'documents'),/Audio 12 manual/);
});
test('permitted Network partition retains its own status when another collection is denied',()=>{
  const {snapshot,options}=fixture('network-quarantine'),registration=snapshot.sources.find(s=>s.owner==='network');
  snapshot.sources.push({...registration,collectionId:'permitted-network'});
  snapshot.caches.push({...snapshot.caches[0],sourceInstanceId:registration.sourceInstanceId,collectionId:'permitted-network',status:'stale'});
  const binding=structuredClone(snapshot.records.find(r=>r.recordType==='binding' && r.payload.source.sourceKind==='network-device'));binding.recordId='00000000-0000-4000-8000-000000000399';binding.payload.source.collectionId='permitted-network';snapshot.records.push(binding);
  const relation=structuredClone(snapshot.networkRelations[0]);relation.collectionId='permitted-network';relation.notes='Permitted saved relation';snapshot.networkRelations.push(relation);
  const view=prepareAtlasView(snapshot,options),radio=namedEntry(view,'Portable radio');assert.equal(radio.networkRelations.length,1);assert.equal(radio.networkRelations[0].notes,'Permitted saved relation');assert.deepEqual(radio.networkStates,['stale']);
  assert.match(render(view,'item',radio.key),/Older Network information/);assert.doesNotMatch(JSON.stringify(view),/"collectionId":"inventory"/);
});
test('individual source binding revocation hides the record',()=>{
  const {snapshot,options}=fixture();snapshot.records.find(r=>r.recordType==='binding' && r.payload.source.externalId===snapshot.homeboxEntities[1].entity.id).payload.sourceState='access-revoked';
  assert.doesNotMatch(JSON.stringify(prepareAtlasView(snapshot,options)),/Portable radio|Audio 12/);
});
test('failed refresh preserves exact last success while showing saved lookup; no-cache failure has no zero-item claim',()=>{
  const {view}=fixture('outage');assert.equal(view.caches[0].lastSuccessfulFetchAt,'2026-01-02T12:00:00Z');
  assert.match(render(view),/HomeBox is unavailable/);assert.equal(searchEntries(view,'manual').length,1);
  const unavailable=fixture('no-cache').view;assert.match(render(unavailable),/no saved information is available/);assert.doesNotMatch(render(unavailable),/No places recorded yet|0 here|No items recorded/);
  for(const page of ['documents','maintenance','search','unplaced']) assert.doesNotMatch(render(unavailable,page,null,{query:'manual'}),/No documents|No maintenance|No matches|0 matching/);
});
test('freshness ages from injected time without mutating stored source status',()=>{
  const {snapshot,options}=fixture();const view=prepareAtlasView(snapshot,{...options,now:'2026-01-02T13:00:00Z'});
  assert.equal(snapshot.caches[0].status,'fresh');assert.equal(view.caches[0].displayStatus,'stale');assert.match(render(view),/older saved information/);
});
test('unresolved upstream records remain saved with native navigation withheld',()=>{
  const {snapshot,options}=fixture('unresolved');const view=prepareAtlasView(snapshot,{...options,authorization:{...options.authorization,canEditHomebox:true},navigation:demoOptions(snapshot,'editor').navigation});
  const radio=namedEntry(view,'Portable radio');assert.equal(nativeLink(radio,'edit',true),null);assert.match(render(view,'item',radio.key),/could not be found in the latest check/);
});
test('native links require actual verified route, accepted present source, freshness and editor capability',()=>{
  const {view}=fixture();const p=namedEntry(view,'Portable radio');assert.equal(nativeLink(p,'edit',true),null);
  const editor=fixture('editor').view,radio=namedEntry(editor,'Portable radio');assert.ok(nativeLink(radio,'edit',true));assert.equal(nativeLink(radio,'edit',false),null);
  assert.match(render(editor,'item',radio.key),/Edit in HomeBox/);assert.match(render(editor,'item',radio.key),/Open maintenance in HomeBox/);assert.doesNotMatch(render(view,'item',p.key),/Edit in HomeBox/);
  assert.equal(nativeLink({...radio,cacheStatus:'stale'},'edit',true),null);
  assert.equal(nativeLink({...radio,nativeLinks:radio.nativeLinks.map(l=>({...l,entity:{...l.entity,homeId:'other'}}))},'edit',true),null);
});
test('media capabilities are scoped; opaque source refs, raw origins and active SVG/PDF never become previews',()=>{
  const {snapshot,options,view}=fixture();const radio=namedEntry(view,'Portable radio');const html=render(view,'item',radio.key);
  assert.doesNotMatch(JSON.stringify(view),/opaque-never-a-browser-url|proxyRef/);assert.match(html,/data-media/);assert.match(html,/Download file/);assert.doesNotMatch(html,/<iframe|<object|<embed/);
  for(const url of ['https://source/private','//evil.test/file','/api/atlas/media/../secret','/api/atlas/media/a?token=secret','data:image/png;base64,x']) assert.equal(safeMediaUrl(url),null);
  const wrong=structuredClone(options.media);wrong.forEach(c=>c.entity.homeId='00000000-0000-4000-8000-000000000003');
  assert.equal(namedEntry(prepareAtlasView(snapshot,{...options,media:wrong}),'Portable radio').attachments.at(-1).previewHref,null);
  snapshot.homeboxEntities[1].attachments.at(-1).contentType='image/svg+xml';assert.equal(namedEntry(prepareAtlasView(snapshot,options),'Portable radio').attachments.at(-1).previewHref,null);
});
test('file outage retains metadata and external links explicitly unarchived; no fetch is triggered by rendering',()=>{
  const {view}=fixture('media-unavailable');const html=render(view,'item',namedEntry(view,'Portable radio').key);
  assert.match(html,/This file is unavailable/);assert.match(html,/Stored file/);assert.match(html,/External website · not archived/);assert.match(html,/manual.example.invalid/);
});
test('external credential URLs and unsafe native URLs are rejected',()=>{
  for(const url of ['javascript:alert(1)','https://user:pass@example.test','https://example.test/?api_key=secret','https://example.test/?access_token=secret','data:text/html,x']) assert.equal(safeWebUrl(url),null);
  assert.equal(safeWebUrl('https://example.test/path?ordinary=1'), 'https://example.test/path?ordinary=1');assert.equal(safeWebUrl('https://example.test/path?ordinary=1',{native:true}),null);
});
test('Network outage is independent and source confidence is separate from owner evidence and historical relations',()=>{
  const {view}=fixture();const p=namedEntry(view,'Portable radio');assert.ok(p.networkRelations.length);const html=render(view,'item',p.key);
  assert.match(html,/Network details are unavailable/);assert.match(html,/Source confidence/);assert.match(html,/Evidence basis/);assert.match(html,/owner report/);assert.match(html,/Historical or disputed/);assert.match(html,/Audio 12 manual/);
  assert.doesNotMatch(render(view,'item',namedEntry(view,'Table lamp').key),/Source confidence/);
});
test('scheduled/completed maintenance remains source-owned, no recurrence or duplicate editor',()=>{
  const {view}=fixture();const html=render(view,'item',namedEntry(view,'Portable radio').key);
  assert.match(html,/Scheduled for/);assert.match(html,/Completed on/);assert.match(html,/Currency not recorded/);assert.doesNotMatch(html,/name="manufacturer"|Save item|Recurrence|Notify me|service worker/i);
});
test('untrusted labels/search text are escaped; malformed route decoding is bounded and safe',()=>{
  const {snapshot,options}=fixture();snapshot.homeboxEntities[1].entity.name='<img src=x onerror=alert(1)>';
  const view=prepareAtlasView(snapshot,options),html=render(view,'search',null,{query:'<script>alert(1)</script>'});
  assert.doesNotMatch(html,/<script>|onerror="/);assert.match(html,/&lt;script&gt;/);assert.match(render(view),/&lt;img/);
  assert.doesNotThrow(()=>parseRoute('#search?q=%E0%A4%A'));assert.equal(parseRoute('#unknown?key=x').page,'home');
  const key=namedEntry(view,'Display cabinet').key;assert.equal(parseRoute(routeHref('place',key)).key,key);
});
test('rename/move preserves qualified route identity and refreshed hierarchy',()=>{
  const {snapshot,options,view}=fixture();const camera=namedEntry(view,'Camera');snapshot.homeboxEntities.find(p=>entityKey(p)===camera.key).entity.name='Renamed camera';snapshot.homeboxEntities.find(p=>entityKey(p)===camera.key).entity.parent=null;
  const next=prepareAtlasView(snapshot,options);assert.equal(namedEntry(next,'Renamed camera').key,camera.key);assert.equal(parentOf(next,namedEntry(next,'Renamed camera')),null);
});
test('missing parent remains unknown rather than manufacturing room from a source name',()=>{
  const {snapshot,options}=fixture();snapshot.homeboxEntities.find(p=>p.entity.name==='Camera').entity.parent={id:'00000000-0000-4000-8000-000000009999'};
  const view=prepareAtlasView(snapshot,options);assert.match(render(view,'item',namedEntry(view,'Camera').key),/Parent place is not available/);
});
test('place-owned documents and maintenance are visible without fabricating an item',()=>{
  const {snapshot,options}=fixture();const cabinet=snapshot.homeboxEntities[0];cabinet.attachments=structuredClone(snapshot.homeboxEntities[1].attachments);cabinet.maintenance=structuredClone(snapshot.homeboxEntities[1].maintenance);
  const view=prepareAtlasView(snapshot,options);const html=render(view,'place',namedEntry(view,'Display cabinet').key);assert.match(html,/Audio 12 manual/);assert.match(html,/Synthetic filter check/);
});
test('manual deep link and search result target the document heading on its owner',()=>{
  const {view}=fixture();assert.match(render(view,'search',null,{query:'manual'}),/document=00000000-0000-4000-8000-000000000800/);
  assert.equal(parseRoute(routeHref('item',namedEntry(view,'Portable radio').key,{documentId:'00000000-0000-4000-8000-000000000800'})).documentId,'00000000-0000-4000-8000-000000000800');
});
test('frozen shape validator rejects invalid graphs before preparing any browser data',()=>{
  const {snapshot,options}=fixture();snapshot.homeboxEntities[0].entity.parent={id:snapshot.homeboxEntities[0].entity.id};assert.throws(()=>prepareAtlasView(snapshot,options),/cycle/);
  const other=fixture();other.snapshot.homeboxEntities[0].source.externalId='not-a-uuid';assert.throws(()=>prepareAtlasView(other.snapshot,other.options));
});
