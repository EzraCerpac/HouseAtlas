/** Shared generated topology: the synthetic home, its buildings and an
 * in-page read transport. No native transport, session cookie, provider or
 * external fallback. */
import type { AtlasSessionInfo } from '../../src/app/session';
import { createTopologyClient } from '../../src/api/topology-client';
import { createStockSchemas } from '../../integration/stock-schemas';
import fixture from './fixture.json';

export { fixture };
export const session: AtlasSessionInfo = { schemaVersion: 1, actorId: '00000000-0000-4000-8000-000000000802', csrfToken: 'synthetic-unused', expiresAt: '2099-01-01T00:00:00Z' };
const records = fixture.records as Record<string, readonly unknown[]>;
const snapshotSha256 = 'a'.repeat(64); // Shared synthetic positive-fixture comparison metadata.
export const createSyntheticTopology = () => createTopologyClient({ schemas:createStockSchemas(), getSessionBinding:()=>({session,scope:fixture.scope}), subscribeSessionBinding:()=>()=>{},
  transport:async (url)=>{
    const query=new URL(String(url),'https://atlas.invalid').searchParams;
    const request=JSON.parse(query.get('request')!);
    const rows=records[request.target.recordType]!;
    const filtered=request.payload.buildingId === undefined ? rows : rows.filter((r:any)=>r.target.recordId===request.payload.buildingId || request.payload.buildingId===fixture.members[0] && fixture.members.includes(r.target.recordId));
    return new Response(JSON.stringify({schemaVersion:3,commandId:request.commandId,requestId:request.requestId,resolvedScope:fixture.scope,status:'read',replayed:false,
      data:{records:filtered,nextCursor:null,sourceStatus:'current'}}),{status:200,headers:{'Content-Type':'application/json','x-atlas-snapshot-sha256':snapshotSha256}});
  } });
