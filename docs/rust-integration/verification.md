# Historical first read slice verification

This records the first read-slice checkpoint, before the native core continuation
described in core-continuation.md. The local ordinary lane passed with Rust/cargo 1.99.0, Node 26.10.0,
npm 11.19.1, bundled application SQLite 3.53.2 and Chrome 151.0.7922.173.
The checked-in runner names its source and coverage explicitly.

| Check | Result and scope |
| --- | --- |
| Deterministic contract generation | No drift against corrected baseline |
| Canonical schema/history checks | Existing valid fixtures and 14 HTTP history checks passed |
| Rust source | Actual library, binary, modules and two declared examples compiled with locked dependencies |
| Rust format/Clippy | rustfmt check and warnings-denied Clippy passed |
| Named Rust examples | Existing healthy typed contracts and in-memory dependency example passed |
| React source | Strict TypeScript and actual Vite application bundle passed |
| Real browser smoke | Home, Rooms & places, room detail and item detail rendered |
| Actual API reads | view, rooms, items, homes, session and scoped view returned 200 |
| Persistence | Six record rows, two projections, zero seed audits and one actual session row after both DBs reopened |
| Browser requests | Fourteen observed page requests stayed on the disposable loopback origin |
| Lifecycle | Graceful ordinary shutdown returned 0; disposable state removed |

The healthy first run exposed a blocking socket registration error, then an
HTTP/2 authority adaptation error. Both were corrected in the host. A typed-peer
rerun also exposed an omitted scope adapter case, which was restored. The final
runner passed; these debugging outcomes are not deliberate failure/crash or
rejection controls. Favicon requests return an explicit empty 204 response.

The exact scoped feature bytes are unchanged from the heads recorded in
README.md. The publication manifest adds explicit new-source rows and owners;
the verifier's file/mode/digest/template assertions are preserved.
Hosted Linux/macOS CI outcomes are reported separately at the candidate PR,
not inferred from this local run. No target macOS runtime claim follows from
cloud Linux results.

Missing implementation and qualification are listed in README.md. Every stopped
guard, adversarial, rejection, replay, expiry, revocation, failure injection,
crash and concurrency control remains unrun, including the jobs replay example.
No remote listener, provider, NAS, live login/grant, deployment or main merge
was performed. A native read-only peer is demonstrated; command, presence,
provider, media, AI, security, recovery, target and product acceptance remain open.
