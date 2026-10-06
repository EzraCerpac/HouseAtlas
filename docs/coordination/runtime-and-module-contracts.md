# Runtime and module contracts

Ordinary core verification pins Node 26.10.0 and npm 11.19.1. Python 3.14.8
is used only by retained operations design tooling and is outside ordinary CI.
No root workspace hoisting is used. The root lock has no dependencies; the
contracts lock pins Ajv 8.20.0, ajv-formats 3.0.1 and their transitives.
Every install uses --ignore-scripts --no-audit --no-fund explicitly.

Logical owners are contracts, operations-policy, storage, HomeBox, Network,
web, access, media and core integration. Shared router/contracts/migration
changes require coordination; preserve module executable and fixture preimages
unless a reviewed owner delta explicitly changes them. Source partitions use
full qualified keys, never labels, IP addresses or depth.

Storage applies final graph/command guards before atomically committing owned
records, audit, receipts and asset availability. The server derives actor/home
from verified access principals; current source grants constrain projections.
Source refresh publishes only a complete validated bounded generation under
the captured epoch. HomeBox pages are non-transactional; missing records do not
prove deletion. Native links require verified routes and exact source scope.

Network GET /api/inventory is the sole current passive route. Trusted transport
configuration attests the full partition and must constrain origin/redirects,
stream bytes and cancellation. No source credential or collector capability
is supplied. web preparation remains server-side and browser views require
current authorization. Media lookup checks current scope and actual bytes.

Reviewed corrections compose canonical v1 operations, additive HTTP history,
transaction-derived source authority and three-field home DTOs. New explicit
source-presence admission remains blocked pending a separate atomic witness
extension. URL credential-key filtering is a heuristic. Read README.md for the
exact ordinary lane and stopped controls. These results do not qualify a host.
