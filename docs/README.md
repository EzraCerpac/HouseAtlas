# Documentation index

Status of every Markdown file under `docs/`. Current is the default.
Historical and superseded files also carry a status line under their
title, linking the current document where one exists.
Those that no tool, pin or current content ties to their path are kept
under `history/`, in their original subdirectory. `contracts/history/` is
the current HTTP history contract, not a record.

## Top level

| Document | Status | Covers |
| --- | --- | --- |
| [README.md](README.md) | current | This index |
| [ci-performance.md](ci-performance.md) | current | Synthetic PR performance report lane |

## architecture/

| Document | Status | Covers |
| --- | --- | --- |
| [property-network-connections.md](architecture/property-network-connections.md) | current | Network associations in the unified Atlas property view |

## canonical-ifc/

| Document | Status | Covers |
| --- | --- | --- |
| [scene-read-contract-v1.md](canonical-ifc/scene-read-contract-v1.md) | current | IFC scene read proposal, one space per room; routes not implemented |
| [scene-read-contract-v2.md](canonical-ifc/scene-read-contract-v2.md) | current | Multi-occurrence room extension of v1; routes not implemented |

## contracts/

| Document | Status | Covers |
| --- | --- | --- |
| [adoption-and-open-decisions.md](contracts/adoption-and-open-decisions.md) | current | Contract 1.1.0 boundaries and open deployment decisions |
| [client-schema-subsets.md](contracts/client-schema-subsets.md) | current | Generated browser schema resources |
| [geodata-document-v2-proposal.md](contracts/geodata-document-v2-proposal.md) | superseded | Native geodata Document v2 proposal |
| [mutations-and-api.md](contracts/mutations-and-api.md) | current | Atlas v1 mutations and OpenAPI |
| [ownership-and-identity.md](contracts/ownership-and-identity.md) | current | Authority and identity contract 1.1.0 |

## contracts/history/

| Document | Status | Covers |
| --- | --- | --- |
| [http-history.v1.1.0.md](contracts/history/http-history.v1.1.0.md) | current | HTTP audit-history sidecar 1.1.0 |

## contributing/

| Document | Status | Covers |
| --- | --- | --- |
| [cargo-modes.md](contributing/cargo-modes.md) | current | Optional Cargo modes |
| [cargo-timings.md](contributing/cargo-timings.md) | current | Cargo timing diagnostics |
| [ci-path-selection.md](contributing/ci-path-selection.md) | current | PR check lane selection |
| [formatting.md](contributing/formatting.md) | current | Formatting before publishing |
| [verification.md](contributing/verification.md) | current | Complete verification command guide |

## coordination/

| Document | Status | Covers |
| --- | --- | --- |
| [worker-handoff.md](coordination/worker-handoff.md) | current | Standalone maintenance and publication handoff |
| [workspace-policy.md](coordination/workspace-policy.md) | current | Publication workspace policy |

## core-integration/

| Document | Status | Covers |
| --- | --- | --- |
| [README.md](core-integration/README.md) | current | Offline core composition |
| [upload-diagnostics.md](core-integration/upload-diagnostics.md) | current | Private upload diagnostics |

## demo/

| Document | Status | Covers |
| --- | --- | --- |
| [README.md](demo/README.md) | current | Synthetic interface demo and its capture |

## geodata/

| Document | Status | Covers |
| --- | --- | --- |
| [full-document-server-selection.md](geodata/full-document-server-selection.md) | current | Full Document server selection |
| [native-document-persistence-v2.md](geodata/native-document-persistence-v2.md) | current | Native Document v2 dataset and storage |
| [native-document-reader.md](geodata/native-document-reader.md) | current | Native Document reader boundary |
| [native-documents.md](geodata/native-documents.md) | current | Native geodata document seam |
| [native-full-profile.md](geodata/native-full-profile.md) | current | Full native Document profile |
| [reviewed-source-policy.md](geodata/reviewed-source-policy.md) | current | Reviewed original-source policy |
| [source-documents-service-availability.md](geodata/source-documents-service-availability.md) | current | Source Document service availability |

## geometry/

| Document | Status | Covers |
| --- | --- | --- |
| [assistant-native-place-intake.md](geometry/assistant-native-place-intake.md) | current | Assistant-managed native place intake |
| [assistant-native-scan-import.md](geometry/assistant-native-scan-import.md) | current | Assistant-managed native scan intake |
| [assistant-native-scan-scene.md](geometry/assistant-native-scan-scene.md) | current | Assistant scene intake |
| [assistant-scan-replacement.md](geometry/assistant-scan-replacement.md) | current | Assistant scan replacement planning |
| [drawing-evidence-lookup-150.md](geometry/drawing-evidence-lookup-150.md) | current | Drawing evidence lookup (#150) |
| [issue-149-room-anchor-acceptance.md](geometry/issue-149-room-anchor-acceptance.md) | current | Room anchor save validation (#149) |
| [native-document-read.md](geometry/native-document-read.md) | current | Native original document read port |
| [native-evidence-document-ui.md](geometry/native-evidence-document-ui.md) | current | Saved native evidence original |
| [native-geometry-association.md](geometry/native-geometry-association.md) | current | Building geometry association port |
| [native-geometry-produced-read.md](geometry/native-geometry-produced-read.md) | current | Synthetic native-produced geometry reader |
| [native-geometry-read.md](geometry/native-geometry-read.md) | current | Native geometry read client |
| [native-geometry-write.md](geometry/native-geometry-write.md) | current | Native geometry custody write port |
| [native-scan-intake-ui.md](geometry/native-scan-intake-ui.md) | current | Native scan intake |
| [native-scan-room-targets.md](geometry/native-scan-room-targets.md) | current | Native targets for reviewed scan rooms |
| [native-scan-succession.md](geometry/native-scan-succession.md) | current | Native scan succession |
| [native-scene-association.md](geometry/native-scene-association.md) | current | Native scene association |
| [native-scene-source.md](geometry/native-scene-source.md) | current | Native scene source |

## mcp-bridge/

| Document | Status | Covers |
| --- | --- | --- |
| [NAS-HANDOFF.md](mcp-bridge/NAS-HANDOFF.md) | current | NAS bridge source handoff, no activation |
| [README.md](mcp-bridge/README.md) | current | Persistent scoped MCP bridge |

## models/

| Document | Status | Covers |
| --- | --- | --- |
| [model-overview-read-v1.md](models/model-overview-read-v1.md) | current | Selected model overview read v1 |
| [unified-atlas-room-links-v1.md](models/unified-atlas-room-links-v1.md) | current | Reviewed unified Atlas room links |
| [unified-atlas-scene-v1.md](models/unified-atlas-scene-v1.md) | current | Unified Atlas scene export v1 |

## offline/

| Document | Status | Covers |
| --- | --- | --- |
| [home-read-pack-v1.md](offline/home-read-pack-v1.md) | current | Home read pack v1 |
| [live-atlas-cache.md](offline/live-atlas-cache.md) | current | Live Atlas cache and returning starts |
| [native-house-acquisition.md](offline/native-house-acquisition.md) | current | House copy acquisition |
| [root-offline-entry.md](offline/root-offline-entry.md) | current | Root offline entry worker |
| [saved-atlas-consumer-v2.md](offline/saved-atlas-consumer-v2.md) | current | Saved Atlas consumer v2 |
| [saved-atlas-mounting.md](offline/saved-atlas-mounting.md) | current | Saved Atlas mounting |
| [saved-atlas-overlays.md](offline/saved-atlas-overlays.md) | current | Saved documentary overlays |
| [saved-atlas-presentation.md](offline/saved-atlas-presentation.md) | current | Saved Atlas presentation facade |

## operations/

| Document | Status | Covers |
| --- | --- | --- |
| [acceptance-300.md](operations/acceptance-300.md) | current | Acceptance preparation (#300) |
| [access-read-only-validation.md](operations/access-read-only-validation.md) | current | Read-only native Access validation |
| [adoption-and-decisions.md](operations/adoption-and-decisions.md) | current | Operations decisions |
| [combined-capture-drafts.md](operations/combined-capture-drafts.md) | current | Contextual capture drafts |
| [contextual-evidence-capture.md](operations/contextual-evidence-capture.md) | current | Contextual evidence capture |
| [icloud-backup.md](operations/icloud-backup.md) | current | Nightly iCloud backup |
| [local-capture-drafts.md](operations/local-capture-drafts.md) | current | Local capture drafts |
| [media-and-offline.md](operations/media-and-offline.md) | current | Media and offline expectations |
| [native-evidence-request-inspection.md](operations/native-evidence-request-inspection.md) | current | Native evidence request inspection |
| [native-evidence-upload-diagnostics.md](operations/native-evidence-upload-diagnostics.md) | current | Native evidence upload observations |
| [native-geometry-custody-first.md](operations/native-geometry-custody-first.md) | current | Geometry custody and building reads |
| [native-session-policy.md](operations/native-session-policy.md) | current | Native session policy |
| [persistent-server.md](operations/persistent-server.md) | current | Persistent server startup |
| [qualification-and-rollout.md](operations/qualification-and-rollout.md) | current | Qualification and rollout requirements |
| [quantity-application.md](operations/quantity-application.md) | current | HomeBox quantity application flow |
| [recovery-and-rollback.md](operations/recovery-and-rollback.md) | current | Recovery and rollback requirements |
| [scenario-validation.md](operations/scenario-validation.md) | current | Scenario requirements and verification limits |
| [target-and-access.md](operations/target-and-access.md) | current | Target and access configuration |

## providers/

| Document | Status | Covers |
| --- | --- | --- |
| [homebox-partition-admission-view.md](providers/homebox-partition-admission-view.md) | current | HomeBox partition admission view |
| [internal-homebox-partition-catalog.md](providers/internal-homebox-partition-catalog.md) | current | Internal HomeBox partition catalog |
| [persistent-cached-provider-selection.md](providers/persistent-cached-provider-selection.md) | current | Persistent cached-provider selection |
| [read-support-matrix.md](providers/read-support-matrix.md) | current | Provider read support, dated snapshot |

## publication/

| Document | Status | Covers |
| --- | --- | --- |
| [provenance.md](publication/provenance.md) | current | Source provenance and manifest |

## rust-baseline/

| Document | Status | Covers |
| --- | --- | --- |
| [README.md](rust-baseline/README.md) | historical | AT51 Rust scaffold; type conventions still current |
| [numeric-semantics.md](rust-baseline/numeric-semantics.md) | current | Checked numeric semantics |
| [verification.md](rust-baseline/verification.md) | historical | AT51 verification; geodata v2 commands still current |

## rust-integration/

| Document | Status | Covers |
| --- | --- | --- |
| [README.md](rust-integration/README.md) | current | Native Rust/React core and host |
| [agents.md](rust-integration/agents.md) | current | Native stock agent composition |
| [ai-host-integration.md](rust-integration/ai-host-integration.md) | current | AI host composition |
| [atlas-specialized-writes.md](rust-integration/atlas-specialized-writes.md) | current | Specialized Atlas writes |
| [credential-platform.md](rust-integration/credential-platform.md) | current | Credential platform composition |
| [dev-composition.md](rust-integration/dev-composition.md) | current | Development composition |
| [media-policy-archive.md](rust-integration/media-policy-archive.md) | current | Media policy archive |
| [native-owner-composition.md](rust-integration/native-owner-composition.md) | current | Native owner composition |
| [native-storage-composition.md](rust-integration/native-storage-composition.md) | current | Native storage composition |
| [network-archive-custody.md](rust-integration/network-archive-custody.md) | current | Network original archive |
| [queue-original-preparation.md](rust-integration/queue-original-preparation.md) | current | Queue preparation retention |
| [stock-downloads.md](rust-integration/stock-downloads.md) | current | Managed stock asset downloads |
| [stock-history.md](rust-integration/stock-history.md) | current | Native stock audit history |
| [stock-reads.md](rust-integration/stock-reads.md) | current | Native stock record reads |
| [stock-writes.md](rust-integration/stock-writes.md) | current | Fresh native stock writes |
| [upload-preparation.md](rust-integration/upload-preparation.md) | current | Owned attachment upload |
| [upload-review-composition.md](rust-integration/upload-review-composition.md) | current | Attachment intake composition |

## history/coordination/

| Document | Status | Covers |
| --- | --- | --- |
| [agent-write-amendment-proposal.md](history/coordination/agent-write-amendment-proposal.md) | superseded | Early agent and provider command boundaries |
| [baseline-scope.md](history/coordination/baseline-scope.md) | historical | Initial snapshot scope |
| [runtime-and-module-contracts.md](history/coordination/runtime-and-module-contracts.md) | historical | Initial runtime pins and module owners |

## history/core-integration/

| Document | Status | Covers |
| --- | --- | --- |
| [correction-3.md](history/core-integration/correction-3.md) | historical | Core `0.1.1-at13.3` correction |

## history/geometry/

| Document | Status | Covers |
| --- | --- | --- |
| [electricity-overlay.md](history/geometry/electricity-overlay.md) | historical | Retired electricity overlay UI |
| [network-overlay.md](history/geometry/network-overlay.md) | historical | Retired network overlay UI |

## history/rust-baseline/

| Document | Status | Covers |
| --- | --- | --- |
| [correction-1.md](history/rust-baseline/correction-1.md) | historical | AT51 contract serialization correction |
| [correction-2.md](history/rust-baseline/correction-2.md) | historical | AT51 numeric processing correction |

## history/rust-integration/

| Document | Status | Covers |
| --- | --- | --- |
| [access-session-binding.md](history/rust-integration/access-session-binding.md) | historical | Access session binding candidate |
| [atlas-list-handlers.md](history/rust-integration/atlas-list-handlers.md) | historical | Atlas list handlers candidate |
| [core-continuation.md](history/rust-integration/core-continuation.md) | historical | Native core checkpoint evidence |
| [host-corrections.md](history/rust-integration/host-corrections.md) | historical | Native host corrections |
| [intake-correction.md](history/rust-integration/intake-correction.md) | historical | HTTP intake correction |
| [mcp-lifecycle-mount.md](history/rust-integration/mcp-lifecycle-mount.md) | historical | MCP lifecycle mount continuation |
| [native-reader-and-webmcp.md](history/rust-integration/native-reader-and-webmcp.md) | historical | Reader and WebMCP continuation |
| [owned-media.md](history/rust-integration/owned-media.md) | historical | Owned-media checkpoint evidence |
| [read-corrections.md](history/rust-integration/read-corrections.md) | historical | Read slice corrections |
| [review-source-ledger.md](history/rust-integration/review-source-ledger.md) | historical | Review thread disposition ledger |
| [verification.md](history/rust-integration/verification.md) | historical | First read slice verification |
| [webmcp-gateway-source.md](history/rust-integration/webmcp-gateway-source.md) | superseded | WebMCP gateway source candidate |
