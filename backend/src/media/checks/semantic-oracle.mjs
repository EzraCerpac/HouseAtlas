// Test-only semantic/JCS peer for the healthy native SQLite composition.
// Database backup/validation never uses JS. AT52 native semantics remain a peer
// input; this pure published oracle is neither a runtime fallback nor a test aggregate.
import { createInterface } from 'node:readline';
import {
  canonicalJson, validateShape, validateSnapshot, assertTransition,
  assertGuards, assertFinalMutation, validateResult,
} from '../../../../packages/contracts/src/index.mjs';

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
      case 'timestamp': value=Number.isFinite(Date.parse(args.value))?Date.parse(args.value):null; break;
      default: throw new Error('Unknown checkpoint operation');
    }
    process.stdout.write(JSON.stringify({ok:true,value})+'\n');
  } catch(error) {
    process.stdout.write(JSON.stringify({ok:false,code:error.code??'checkpoint-error'})+'\n');
  }
}
