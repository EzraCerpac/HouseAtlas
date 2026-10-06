import { AssetVault } from '../src/index.mjs';
import { AtlasStore } from '../../storage/src/index.mjs';
const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,scope={workspaceId:U(1),homeId:U(2)};
const [databasePath,root,phase]=process.argv.slice(2);
const vault=new AssetVault({root,fault:at=>{if(at===phase)process.kill(process.pid,'SIGKILL');}});
const identity=await vault.prepareOriginal({scope,purpose:'evidence-original',contentType:'text/plain',body:Buffer.from('synthetic interrupted original\n')});
// Explicit offline synthetic writer; this process is not authentication evidence.
const store=new AtlasStore({path:databasePath,authorize:()=>({...scope,actorId:U(50)}),verifyAvailableAsset:vault.verifyAvailableAsset});
store.execute({},scope,{recordType:'asset',recordId:U(601)},{schemaVersion:1,mutationId:U(8800),operation:'create',expectedRevision:null,reason:'Synthetic media lifecycle',guards:[{record:{recordType:'evidence',recordId:U(100)},expectedRevision:1}],value:{recordType:'asset',payload:{...identity,sourceLicense:{status:'unknown',reference:null},evidenceIds:[U(100)]}}});
if(phase==='after-commit')process.kill(process.pid,'SIGKILL');store.close();
