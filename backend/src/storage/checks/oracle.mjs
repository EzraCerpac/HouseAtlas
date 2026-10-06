// Offline checkpoint peer only. No server, provider, SQL or control execution.
// Native Rust Contract integration replaces this bridge; it is not application
// architecture. Paths resolve only to this checkout's published pure functions.
import { createInterface } from 'node:readline';
import {
  canonicalJson, recordDigest, validateShape, validateSnapshot, assertTransition,
  assertGuards, assertFinalMutation, validateResult,
} from '../../../../packages/contracts/src/index.mjs';
import { mutationAuthorizationContext } from '../../../../packages/storage/src/mutation-context.mjs';

for await (const line of createInterface({input:process.stdin,crlfDelay:Infinity})) {
  try {
    const {operation,args}=JSON.parse(line);
    let value=null;
    switch(operation) {
      case 'shape': validateShape(args.name,args.value); break;
      case 'snapshot': validateSnapshot(args.snapshot); break;
      case 'transition': value=assertTransition(args.current,args.command,args.target).nextRevision; break;
      case 'guards': assertGuards(args.snapshot,args.current,args.command,args.target,args.created); break;
      case 'final': assertFinalMutation(args.snapshot,args.current,args.command,args.target); break;
      case 'result':
        if(args.priorKind==='unspecified') validateResult(args.result);
        else validateResult(args.result,args.prior);
        break;
      case 'canonical': value=canonicalJson(args.value); break;
      case 'digest': value=recordDigest(args.value); break;
      case 'context': value=mutationAuthorizationContext(args); break;
      default: throw new Error('Unknown checkpoint operation');
    }
    process.stdout.write(JSON.stringify({ok:true,value})+'\n');
  } catch(error) {
    process.stdout.write(JSON.stringify({ok:false,code:error.code??'checkpoint-error'})+'\n');
  }
}
