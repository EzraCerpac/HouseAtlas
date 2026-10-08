import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { QuantityPreview } from '../components/QuantityPreview';
import { createQuantityClient } from '../../../integration/quantity-client';
import { equalQuantityJson } from '../../api/quantity-client';
import type { QuantitySessionBinding } from '../../api/quantity-client';
/** Literal synthetic positive protocol. No real auth, issuer, provider or HTTP.
 * Import is inert. Run only after review of this complete body. */
export const healthyQuantityFixture = {
  "source": {
    "workspaceId": "00000000-0000-4000-8000-000000000001",
    "homeId": "00000000-0000-4000-8000-000000000002",
    "key": {
      "sourceInstanceId": "00000000-0000-4000-8000-000000000003",
      "collectionId": "00000000-0000-4000-8000-000000000004",
      "sourceKind": "homebox-entity",
      "externalId": "00000000-0000-4000-8000-000000000005"
    }
  },
  "availability": {
    "format": "atlas-homebox-quantity-availability/1",
    "resolvedScope": {
      "workspaceId": "00000000-0000-4000-8000-000000000001",
      "homeId": "00000000-0000-4000-8000-000000000002"
    },
    "source": {
      "workspaceId": "00000000-0000-4000-8000-000000000001",
      "homeId": "00000000-0000-4000-8000-000000000002",
      "key": {
        "sourceInstanceId": "00000000-0000-4000-8000-000000000003",
        "collectionId": "00000000-0000-4000-8000-000000000004",
        "sourceKind": "homebox-entity",
        "externalId": "00000000-0000-4000-8000-000000000005"
      }
    },
    "state": "available"
  },
  "preview": {
    "format": "atlas-homebox-quantity-preview/1",
    "resolvedScope": {
      "workspaceId": "00000000-0000-4000-8000-000000000001",
      "homeId": "00000000-0000-4000-8000-000000000002"
    },
    "source": {
      "workspaceId": "00000000-0000-4000-8000-000000000001",
      "homeId": "00000000-0000-4000-8000-000000000002",
      "key": {
        "sourceInstanceId": "00000000-0000-4000-8000-000000000003",
        "collectionId": "00000000-0000-4000-8000-000000000004",
        "sourceKind": "homebox-entity",
        "externalId": "00000000-0000-4000-8000-000000000005"
      }
    },
    "previewId": "00000000-0000-4000-8000-000000000009",
    "requestDigest": "ba46afa02497a1bab98969080f84cc96c58a51fbafe5e161d38e5768afd98a15",
    "planDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "request": {
      "schemaVersion": 3,
      "commandId": "homebox.entity.quantity.set",
      "context": {
        "workspaceId": "00000000-0000-4000-8000-000000000001",
        "homeId": "00000000-0000-4000-8000-000000000002"
      },
      "target": {
        "authority": "homebox",
        "sourceInstanceId": "00000000-0000-4000-8000-000000000003",
        "collectionId": "00000000-0000-4000-8000-000000000004",
        "resourceKind": "entity",
        "resourceId": "00000000-0000-4000-8000-000000000005"
      },
      "payload": {
        "quantity": 3
      },
      "idempotencyKey": "00000000-0000-4000-8000-000000000006",
      "reason": "Synthetic reviewed quantity change",
      "preconditions": {
        "providerObservation": {
          "kind": "provider-observation",
          "handle": "00000000-0000-4000-8000-000000000007"
        },
        "atlasGuards": []
      },
      "approvalReceiptId": null,
      "requestId": "00000000-0000-4000-8000-000000000008"
    },
    "observed": {
      "quantity": "2.00",
      "updatedAt": "2026-10-08T10:00:00.000+02:00",
      "retrievedAt": "2026-10-08T08:01:00.000Z"
    },
    "effect": {
      "quantity": 3,
      "method": "PATCH",
      "path": "/api/v1/entities/00000000-0000-4000-8000-000000000005",
      "body": {
        "quantity": 3
      }
    },
    "policy": {
      "id": "synthetic-policy",
      "version": "7",
      "epoch": 1,
      "approval": "human-required",
      "maximumQuantity": 10
    },
    "assurance": {
      "installedBuild": "configured-not-runtime-attested",
      "causality": false,
      "atomicCompareAndSet": false
    },
    "lifetime": {
      "remainingMs": 60000
    }
  },
  "approval": {
    "format": "atlas-homebox-quantity-approval/1",
    "resolvedScope": {
      "workspaceId": "00000000-0000-4000-8000-000000000001",
      "homeId": "00000000-0000-4000-8000-000000000002"
    },
    "source": {
      "workspaceId": "00000000-0000-4000-8000-000000000001",
      "homeId": "00000000-0000-4000-8000-000000000002",
      "key": {
        "sourceInstanceId": "00000000-0000-4000-8000-000000000003",
        "collectionId": "00000000-0000-4000-8000-000000000004",
        "sourceKind": "homebox-entity",
        "externalId": "00000000-0000-4000-8000-000000000005"
      }
    },
    "previewId": "00000000-0000-4000-8000-000000000009",
    "requestDigest": "ba46afa02497a1bab98969080f84cc96c58a51fbafe5e161d38e5768afd98a15",
    "planDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "approvalReceiptId": "00000000-0000-4000-8000-000000000010",
    "evidenceDigest": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "result": {
    "format": "atlas-homebox-quantity-result/1",
    "resolvedScope": {
      "workspaceId": "00000000-0000-4000-8000-000000000001",
      "homeId": "00000000-0000-4000-8000-000000000002"
    },
    "source": {
      "workspaceId": "00000000-0000-4000-8000-000000000001",
      "homeId": "00000000-0000-4000-8000-000000000002",
      "key": {
        "sourceInstanceId": "00000000-0000-4000-8000-000000000003",
        "collectionId": "00000000-0000-4000-8000-000000000004",
        "sourceKind": "homebox-entity",
        "externalId": "00000000-0000-4000-8000-000000000005"
      }
    },
    "previewId": "00000000-0000-4000-8000-000000000009",
    "requestDigest": "ba46afa02497a1bab98969080f84cc96c58a51fbafe5e161d38e5768afd98a15",
    "planDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "result": {
      "schemaVersion": 3,
      "commandId": "homebox.entity.quantity.set",
      "requestId": "00000000-0000-4000-8000-000000000008",
      "operationId": "00000000-0000-4000-8000-000000000011",
      "resolvedScope": {
        "workspaceId": "00000000-0000-4000-8000-000000000001",
        "homeId": "00000000-0000-4000-8000-000000000002"
      },
      "requestDigest": "ba46afa02497a1bab98969080f84cc96c58a51fbafe5e161d38e5768afd98a15",
      "causalityProven": false,
      "atomicProviderCAS": false,
      "nativeEditorRacePossible": true,
      "knownEffects": [],
      "observedAt": "2026-10-08T08:02:00.000Z",
      "responseDigest": null,
      "readbackDigest": null,
      "generatedIdentityResolved": true,
      "unknownScopeFenceRetained": false,
      "remoteActivity": {
        "state": "not-dispatched",
        "terminationEvidenceDigest": null
      },
      "storageLiability": {
        "accountingComplete": true,
        "metadataCommitEvidence": "not-dispatched",
        "byteDisposition": "none",
        "referenceClosureEvidence": "unassessed",
        "orphanCandidateId": null,
        "unresolvedAttempts": 0,
        "knownBytes": 0,
        "reservedBytes": 0
      },
      "state": "prepared",
      "verification": "unresolved",
      "responseSuccess": false,
      "readbackAgrees": false,
      "resolutionEvidenceDigest": null,
      "resolutionActorId": null
    }
  }
} as const;
const assertPositive = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
/** Explicit mounted UI actions; sole four fake requests, no lifecycle cases. */
export async function healthyQuantityExample(container: HTMLElement) {
  const fixture = healthyQuantityFixture;
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const identity = {};
  const binding: QuantitySessionBinding = { identity, scope: fixture.source, session: {
    schemaVersion: 1, actorId: 'synthetic-actor', csrfToken: 'synthetic-csrf', expiresAt: '2099-01-01T00:00:00Z',
  } };
  const transport: typeof fetch = async (input, init) => {
    const path = String(input), method = init?.method ?? 'GET';
    assertPositive(init?.credentials === 'same-origin' && init.cache === 'no-store' && init.redirect === 'error', 'Synthetic transport uses exact private same-origin options');
    const headers = new Headers(init?.headers);
    assertPositive(method === 'GET' ? !headers.has('X-Atlas-CSRF') : headers.get('X-Atlas-CSRF') === 'synthetic-csrf', 'CSRF exists only on explicit synthetic POST');
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, method, body });
    const action = path.split('?')[0]!.split('/').at(-1)!;
    const payload = fixture[action as 'availability' | 'preview' | 'approval' | 'result'] ?? (action === 'dispatch' ? fixture.result : undefined);
    assertPositive(payload, 'Only literal synthetic quantity routes are used');
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
  };
  const client = createQuantityClient({ getSessionBinding: () => binding, subscribeSessionBinding: () => () => {}, transport });
  const mounted = createRoot(container);
  const cacheQuantity = 2;
  flushSync(() => { mounted.render(<><p data-synthetic-cache>Cached quantity: {cacheQuantity}</p><QuantityPreview client={client} source={fixture.source} renderIdentity={fixture} sourceIdentity={fixture.source} /></>); });
  assertPositive(calls.length === 0, 'Mount and browsing send no request');
  const until = async (condition: () => boolean) => {
    for (let i = 0; i < 200; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 0)); }
    throw new Error('Positive UI action did not settle');
  };
  const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find(node => node.textContent === label);
    assertPositive(button && !button.disabled, `Available explicit action: ${label}`);
    flushSync(() => { button!.click(); });
    await until(() => container.querySelector('section[aria-label="HomeBox quantity"]')?.getAttribute('aria-busy') === 'false');
  };
  const change = async (selector: string, value: string) => {
    const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    flushSync(() => {
      Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  await click('Check quantity availability');
  assertPositive(calls.length === 1 && calls[0]!.method === 'GET', 'Explicit availability is the only GET');
  const query = new URL(calls[0]!.path, 'https://synthetic.invalid').searchParams;
  assertPositive([...query.keys()].length === 5 && query.get('workspaceId') === fixture.source.workspaceId && query.get('homeId') === fixture.source.homeId && query.get('sourceInstanceId') === fixture.source.key.sourceInstanceId && query.get('collectionId') === fixture.source.key.collectionId && query.get('externalId') === fixture.source.key.externalId, 'Full original selectors survive');
  await change('input[aria-label="Proposed quantity"]', '3');
  await change('textarea[aria-label="Quantity change reason"]', fixture.preview.request.reason);
  await click('Preview quantity change');
  assertPositive(calls.length === 2 && equalQuantityJson(calls[1]!.body, { source: fixture.source, quantity: 3, reason: fixture.preview.request.reason }), 'Preview body is exact');
  assertPositive(container.textContent?.includes('2.00') && container.textContent.includes(fixture.preview.observed.updatedAt) && container.textContent.includes(fixture.preview.observed.retrievedAt), 'Original lexical quantity and source dates are visible');
  const saved = container.querySelector('details pre')!.textContent!;
  assertPositive(equalQuantityJson(JSON.parse(saved), fixture.preview.request), 'Original full request including observation and idempotency survives');
  await click('Approve this exact quantity change');
  assertPositive(calls.length === 3 && equalQuantityJson(calls[2]!.body, { previewId: fixture.preview.previewId, requestDigest: fixture.preview.requestDigest, planDigest: fixture.preview.planDigest, policyId: 'synthetic-policy', policyVersion: '7', policyEpoch: 1, acknowledgement: true }), 'Approval body is exact');
  assertPositive(container.textContent?.includes('Approval issued; quantity not dispatched by approval.') && !container.textContent.includes('Native result'), 'Approval-issued is separate from native result');
  await click('Submit quantity change');
  assertPositive(calls.length === 4 && equalQuantityJson(calls[3]!.body, { previewId: fixture.preview.previewId, requestDigest: fixture.preview.requestDigest, planDigest: fixture.preview.planDigest, approvalReceiptId: fixture.approval.approvalReceiptId }), 'Dispatch body is exact and dispatched separately');
  assertPositive(calls.slice(1).every(call => call.method === 'POST'), 'Each explicit mutation sent exactly one POST');
  assertPositive(container.textContent?.includes('Native result') && container.textContent.includes('prepared') && container.textContent.includes('not-dispatched'), 'Prepared native outcome is displayed without updated-quantity claims');
  assertPositive(container.querySelector('[data-synthetic-cache]')!.textContent === 'Cached quantity: 2', 'Cached quantity is unchanged');
  return { synthetic: true as const, requestCounts: { GET: 1, POST: 3 }, calls, unmount: () => mounted.unmount() };
}
