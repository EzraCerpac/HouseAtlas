/** Bounded generic positive only; no listener/provider/private input. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from '../node_modules/ajv/dist/2020.js';
import addFormats from '../node_modules/ajv-formats/dist/index.js';
import atlas from '../../packages/contracts/schemas/atlas.schema.json' with { type: 'json' };
import agent from '../../contracts/stock-wire3/agent/agent.schema.json' with { type: 'json' };
import electrical from '../../contracts/electrical-data/generated.fixture.json' with { type: 'json' };
import { loadNumericSource } from './load-numeric-source.mjs';
import { projectView } from '../src/lantern/adapters/read.ts';
const { createTopologyClient } = await import(await loadNumericSource('api/topology-client.ts'));
const { buildTopologyIndex, buildBuildingModel, metres } = await import(await loadNumericSource('lantern/topology/model.ts'));
const { ExactDecimal } = await import(await loadNumericSource('numeric/decimal.ts'));
const fixture = {
  "scope": {
    "workspaceId": "00000000-0000-4000-8000-000000000800",
    "homeId": "00000000-0000-4000-8000-000000000801"
  },
  "view": {
    "status": "ready",
    "scope": {
      "workspaceId": "00000000-0000-4000-8000-000000000800",
      "homeId": "00000000-0000-4000-8000-000000000801"
    },
    "homeLabel": "Synthetic home",
    "now": "2026-01-02T10:05:00Z",
    "canEdit": false,
    "homes": [
      {
        "workspaceId": "00000000-0000-4000-8000-000000000800",
        "homeId": "00000000-0000-4000-8000-000000000801",
        "label": "Synthetic home"
      }
    ],
    "entries": [
      {
        "workspaceId": "00000000-0000-4000-8000-000000000800",
        "homeId": "00000000-0000-4000-8000-000000000801",
        "key": "[\"00000000-0000-4000-8000-000000000800\",\"00000000-0000-4000-8000-000000000801\",\"00000000-0000-4000-8000-000000000900\",\"synthetic-building-source\",\"homebox-entity\",\"00000000-0000-4000-8000-000000000501\"]",
        "source": {
          "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
          "collectionId": "synthetic-building-source",
          "sourceKind": "homebox-entity",
          "externalId": "00000000-0000-4000-8000-000000000501"
        },
        "entity": {
          "id": "00000000-0000-4000-8000-000000000501",
          "name": "Alpha",
          "description": "",
          "notes": null,
          "entityType": {
            "id": "00000000-0000-4000-8000-000000000901",
            "name": "Generic location",
            "isLocation": true
          },
          "parent": null,
          "archived": false,
          "quantity": null,
          "manufacturer": null,
          "modelNumber": null,
          "serialNumber": null
        },
        "kind": "place",
        "semanticKind": "building",
        "sourceState": "present",
        "cacheStatus": "stale",
        "sourceUpdatedAt": "2026-01-02T10:00:00Z",
        "retrievedAt": "2026-01-02T10:05:00Z",
        "aliases": [],
        "mobility": "unknown",
        "attachments": [],
        "maintenance": [],
        "nativeLinks": [],
        "networkBound": false,
        "networkStates": [],
        "networkRelations": []
      },
      {
        "workspaceId": "00000000-0000-4000-8000-000000000800",
        "homeId": "00000000-0000-4000-8000-000000000801",
        "key": "[\"00000000-0000-4000-8000-000000000800\",\"00000000-0000-4000-8000-000000000801\",\"00000000-0000-4000-8000-000000000900\",\"synthetic-building-source\",\"homebox-entity\",\"00000000-0000-4000-8000-000000000502\"]",
        "source": {
          "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
          "collectionId": "synthetic-building-source",
          "sourceKind": "homebox-entity",
          "externalId": "00000000-0000-4000-8000-000000000502"
        },
        "entity": {
          "id": "00000000-0000-4000-8000-000000000502",
          "name": "Beta",
          "description": "",
          "notes": null,
          "entityType": {
            "id": "00000000-0000-4000-8000-000000000901",
            "name": "Generic location",
            "isLocation": true
          },
          "parent": null,
          "archived": false,
          "quantity": null,
          "manufacturer": null,
          "modelNumber": null,
          "serialNumber": null
        },
        "kind": "place",
        "semanticKind": "building",
        "sourceState": "present",
        "cacheStatus": "stale",
        "sourceUpdatedAt": "2026-01-02T10:00:00Z",
        "retrievedAt": "2026-01-02T10:05:00Z",
        "aliases": [],
        "mobility": "unknown",
        "attachments": [],
        "maintenance": [],
        "nativeLinks": [],
        "networkBound": false,
        "networkStates": [],
        "networkRelations": []
      },
      {
        "workspaceId": "00000000-0000-4000-8000-000000000800",
        "homeId": "00000000-0000-4000-8000-000000000801",
        "key": "[\"00000000-0000-4000-8000-000000000800\",\"00000000-0000-4000-8000-000000000801\",\"00000000-0000-4000-8000-000000000900\",\"synthetic-building-source\",\"homebox-entity\",\"00000000-0000-4000-8000-000000000503\"]",
        "source": {
          "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
          "collectionId": "synthetic-building-source",
          "sourceKind": "homebox-entity",
          "externalId": "00000000-0000-4000-8000-000000000503"
        },
        "entity": {
          "id": "00000000-0000-4000-8000-000000000503",
          "name": "Beta",
          "description": "",
          "notes": null,
          "entityType": {
            "id": "00000000-0000-4000-8000-000000000901",
            "name": "Generic location",
            "isLocation": true
          },
          "parent": null,
          "archived": false,
          "quantity": null,
          "manufacturer": null,
          "modelNumber": null,
          "serialNumber": null
        },
        "kind": "place",
        "semanticKind": "building",
        "sourceState": "present",
        "cacheStatus": "stale",
        "sourceUpdatedAt": "2026-01-02T10:00:00Z",
        "retrievedAt": "2026-01-02T10:05:00Z",
        "aliases": [],
        "mobility": "unknown",
        "attachments": [],
        "maintenance": [],
        "nativeLinks": [],
        "networkBound": false,
        "networkStates": [],
        "networkRelations": []
      },
      {
        "workspaceId": "00000000-0000-4000-8000-000000000800",
        "homeId": "00000000-0000-4000-8000-000000000801",
        "key": "[\"00000000-0000-4000-8000-000000000800\",\"00000000-0000-4000-8000-000000000801\",\"00000000-0000-4000-8000-000000000900\",\"synthetic-building-source\",\"homebox-entity\",\"00000000-0000-4000-8000-000000000504\"]",
        "source": {
          "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
          "collectionId": "synthetic-building-source",
          "sourceKind": "homebox-entity",
          "externalId": "00000000-0000-4000-8000-000000000504"
        },
        "entity": {
          "id": "00000000-0000-4000-8000-000000000504",
          "name": "Lower level",
          "description": "",
          "notes": null,
          "entityType": {
            "id": "00000000-0000-4000-8000-000000000901",
            "name": "Generic location",
            "isLocation": true
          },
          "parent": null,
          "archived": false,
          "quantity": null,
          "manufacturer": null,
          "modelNumber": null,
          "serialNumber": null
        },
        "kind": "place",
        "semanticKind": "floor",
        "sourceState": "present",
        "cacheStatus": "stale",
        "sourceUpdatedAt": "2026-01-02T10:00:00Z",
        "retrievedAt": "2026-01-02T10:05:00Z",
        "aliases": [],
        "mobility": "unknown",
        "attachments": [],
        "maintenance": [],
        "nativeLinks": [],
        "networkBound": false,
        "networkStates": [],
        "networkRelations": []
      },
      {
        "workspaceId": "00000000-0000-4000-8000-000000000800",
        "homeId": "00000000-0000-4000-8000-000000000801",
        "key": "[\"00000000-0000-4000-8000-000000000800\",\"00000000-0000-4000-8000-000000000801\",\"00000000-0000-4000-8000-000000000900\",\"synthetic-building-source\",\"homebox-entity\",\"00000000-0000-4000-8000-000000000505\"]",
        "source": {
          "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
          "collectionId": "synthetic-building-source",
          "sourceKind": "homebox-entity",
          "externalId": "00000000-0000-4000-8000-000000000505"
        },
        "entity": {
          "id": "00000000-0000-4000-8000-000000000505",
          "name": "Upper level",
          "description": "",
          "notes": null,
          "entityType": {
            "id": "00000000-0000-4000-8000-000000000901",
            "name": "Generic location",
            "isLocation": true
          },
          "parent": null,
          "archived": false,
          "quantity": null,
          "manufacturer": null,
          "modelNumber": null,
          "serialNumber": null
        },
        "kind": "place",
        "semanticKind": "floor",
        "sourceState": "present",
        "cacheStatus": "stale",
        "sourceUpdatedAt": "2026-01-02T10:00:00Z",
        "retrievedAt": "2026-01-02T10:05:00Z",
        "aliases": [],
        "mobility": "unknown",
        "attachments": [],
        "maintenance": [],
        "nativeLinks": [],
        "networkBound": false,
        "networkStates": [],
        "networkRelations": []
      },
      {
        "workspaceId": "00000000-0000-4000-8000-000000000800",
        "homeId": "00000000-0000-4000-8000-000000000801",
        "key": "[\"00000000-0000-4000-8000-000000000800\",\"00000000-0000-4000-8000-000000000801\",\"00000000-0000-4000-8000-000000000900\",\"synthetic-building-source\",\"homebox-entity\",\"00000000-0000-4000-8000-000000000506\"]",
        "source": {
          "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
          "collectionId": "synthetic-building-source",
          "sourceKind": "homebox-entity",
          "externalId": "00000000-0000-4000-8000-000000000506"
        },
        "entity": {
          "id": "00000000-0000-4000-8000-000000000506",
          "name": "Unknown level",
          "description": "",
          "notes": null,
          "entityType": {
            "id": "00000000-0000-4000-8000-000000000901",
            "name": "Generic location",
            "isLocation": true
          },
          "parent": null,
          "archived": false,
          "quantity": null,
          "manufacturer": null,
          "modelNumber": null,
          "serialNumber": null
        },
        "kind": "place",
        "semanticKind": "floor",
        "sourceState": "present",
        "cacheStatus": "stale",
        "sourceUpdatedAt": "2026-01-02T10:00:00Z",
        "retrievedAt": "2026-01-02T10:05:00Z",
        "aliases": [],
        "mobility": "unknown",
        "attachments": [],
        "maintenance": [],
        "nativeLinks": [],
        "networkBound": false,
        "networkStates": [],
        "networkRelations": []
      },
      {
        "workspaceId": "00000000-0000-4000-8000-000000000800",
        "homeId": "00000000-0000-4000-8000-000000000801",
        "key": "[\"00000000-0000-4000-8000-000000000800\",\"00000000-0000-4000-8000-000000000801\",\"00000000-0000-4000-8000-000000000900\",\"synthetic-building-source\",\"homebox-entity\",\"00000000-0000-4000-8000-000000000507\"]",
        "source": {
          "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
          "collectionId": "synthetic-building-source",
          "sourceKind": "homebox-entity",
          "externalId": "00000000-0000-4000-8000-000000000507"
        },
        "entity": {
          "id": "00000000-0000-4000-8000-000000000507",
          "name": "Direct room",
          "description": "",
          "notes": null,
          "entityType": {
            "id": "00000000-0000-4000-8000-000000000901",
            "name": "Generic location",
            "isLocation": true
          },
          "parent": null,
          "archived": false,
          "quantity": null,
          "manufacturer": null,
          "modelNumber": null,
          "serialNumber": null
        },
        "kind": "place",
        "semanticKind": "room",
        "sourceState": "present",
        "cacheStatus": "stale",
        "sourceUpdatedAt": "2026-01-02T10:00:00Z",
        "retrievedAt": "2026-01-02T10:05:00Z",
        "aliases": [],
        "mobility": "unknown",
        "attachments": [],
        "maintenance": [],
        "nativeLinks": [],
        "networkBound": false,
        "networkStates": [],
        "networkRelations": []
      },
      {
        "workspaceId": "00000000-0000-4000-8000-000000000800",
        "homeId": "00000000-0000-4000-8000-000000000801",
        "key": "[\"00000000-0000-4000-8000-000000000800\",\"00000000-0000-4000-8000-000000000801\",\"00000000-0000-4000-8000-000000000900\",\"synthetic-building-source\",\"homebox-entity\",\"00000000-0000-4000-8000-000000000508\"]",
        "source": {
          "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
          "collectionId": "synthetic-building-source",
          "sourceKind": "homebox-entity",
          "externalId": "00000000-0000-4000-8000-000000000508"
        },
        "entity": {
          "id": "00000000-0000-4000-8000-000000000508",
          "name": "Lower room",
          "description": "",
          "notes": null,
          "entityType": {
            "id": "00000000-0000-4000-8000-000000000901",
            "name": "Generic location",
            "isLocation": true
          },
          "parent": null,
          "archived": false,
          "quantity": null,
          "manufacturer": null,
          "modelNumber": null,
          "serialNumber": null
        },
        "kind": "place",
        "semanticKind": "room",
        "sourceState": "present",
        "cacheStatus": "stale",
        "sourceUpdatedAt": "2026-01-02T10:00:00Z",
        "retrievedAt": "2026-01-02T10:05:00Z",
        "aliases": [],
        "mobility": "unknown",
        "attachments": [],
        "maintenance": [],
        "nativeLinks": [],
        "networkBound": false,
        "networkStates": [],
        "networkRelations": []
      },
      {
        "workspaceId": "00000000-0000-4000-8000-000000000800",
        "homeId": "00000000-0000-4000-8000-000000000801",
        "key": "[\"00000000-0000-4000-8000-000000000800\",\"00000000-0000-4000-8000-000000000801\",\"00000000-0000-4000-8000-000000000900\",\"synthetic-building-source\",\"homebox-entity\",\"00000000-0000-4000-8000-000000000509\"]",
        "source": {
          "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
          "collectionId": "synthetic-building-source",
          "sourceKind": "homebox-entity",
          "externalId": "00000000-0000-4000-8000-000000000509"
        },
        "entity": {
          "id": "00000000-0000-4000-8000-000000000509",
          "name": "Unassigned place",
          "description": "",
          "notes": null,
          "entityType": {
            "id": "00000000-0000-4000-8000-000000000901",
            "name": "Generic location",
            "isLocation": true
          },
          "parent": null,
          "archived": false,
          "quantity": null,
          "manufacturer": null,
          "modelNumber": null,
          "serialNumber": null
        },
        "kind": "place",
        "semanticKind": "room",
        "sourceState": "present",
        "cacheStatus": "stale",
        "sourceUpdatedAt": "2026-01-02T10:00:00Z",
        "retrievedAt": "2026-01-02T10:05:00Z",
        "aliases": [],
        "mobility": "unknown",
        "attachments": [],
        "maintenance": [],
        "nativeLinks": [],
        "networkBound": false,
        "networkStates": [],
        "networkRelations": []
      },
      {
        "workspaceId": "00000000-0000-4000-8000-000000000800",
        "homeId": "00000000-0000-4000-8000-000000000801",
        "key": "[\"00000000-0000-4000-8000-000000000800\",\"00000000-0000-4000-8000-000000000801\",\"00000000-0000-4000-8000-000000000900\",\"synthetic-building-source\",\"homebox-entity\",\"00000000-0000-4000-8000-000000000510\"]",
        "source": {
          "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
          "collectionId": "synthetic-building-source",
          "sourceKind": "homebox-entity",
          "externalId": "00000000-0000-4000-8000-000000000510"
        },
        "entity": {
          "id": "00000000-0000-4000-8000-000000000510",
          "name": "Separate datum level",
          "description": "",
          "notes": null,
          "entityType": {
            "id": "00000000-0000-4000-8000-000000000901",
            "name": "Generic location",
            "isLocation": true
          },
          "parent": null,
          "archived": false,
          "quantity": null,
          "manufacturer": null,
          "modelNumber": null,
          "serialNumber": null
        },
        "kind": "place",
        "semanticKind": "floor",
        "sourceState": "present",
        "cacheStatus": "stale",
        "sourceUpdatedAt": "2026-01-02T10:00:00Z",
        "retrievedAt": "2026-01-02T10:05:00Z",
        "aliases": [],
        "mobility": "unknown",
        "attachments": [],
        "maintenance": [],
        "nativeLinks": [],
        "networkBound": false,
        "networkStates": [],
        "networkRelations": []
      },
      {
        "workspaceId": "00000000-0000-4000-8000-000000000800",
        "homeId": "00000000-0000-4000-8000-000000000801",
        "key": "[\"00000000-0000-4000-8000-000000000800\",\"00000000-0000-4000-8000-000000000801\",\"00000000-0000-4000-8000-000000000900\",\"synthetic-building-source\",\"homebox-entity\",\"00000000-0000-4000-8000-000000000511\"]",
        "source": {
          "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
          "collectionId": "synthetic-building-source",
          "sourceKind": "homebox-entity",
          "externalId": "00000000-0000-4000-8000-000000000511"
        },
        "entity": {
          "id": "00000000-0000-4000-8000-000000000511",
          "name": "Survey datum",
          "description": "",
          "notes": null,
          "entityType": {
            "id": "00000000-0000-4000-8000-000000000901",
            "name": "Generic location",
            "isLocation": true
          },
          "parent": null,
          "archived": false,
          "quantity": null,
          "manufacturer": null,
          "modelNumber": null,
          "serialNumber": null
        },
        "kind": "place",
        "semanticKind": "other",
        "sourceState": "present",
        "cacheStatus": "stale",
        "sourceUpdatedAt": "2026-01-02T10:00:00Z",
        "retrievedAt": "2026-01-02T10:05:00Z",
        "aliases": [],
        "mobility": "unknown",
        "attachments": [],
        "maintenance": [],
        "nativeLinks": [],
        "networkBound": false,
        "networkStates": [],
        "networkRelations": []
      },
      {
        "workspaceId": "00000000-0000-4000-8000-000000000800",
        "homeId": "00000000-0000-4000-8000-000000000801",
        "key": "[\"00000000-0000-4000-8000-000000000800\",\"00000000-0000-4000-8000-000000000801\",\"00000000-0000-4000-8000-000000000900\",\"synthetic-building-source\",\"homebox-entity\",\"00000000-0000-4000-8000-000000000512\"]",
        "source": {
          "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
          "collectionId": "synthetic-building-source",
          "sourceKind": "homebox-entity",
          "externalId": "00000000-0000-4000-8000-000000000512"
        },
        "entity": {
          "id": "00000000-0000-4000-8000-000000000512",
          "name": "Undated level",
          "description": "",
          "notes": null,
          "entityType": {
            "id": "00000000-0000-4000-8000-000000000901",
            "name": "Generic location",
            "isLocation": true
          },
          "parent": null,
          "archived": false,
          "quantity": null,
          "manufacturer": null,
          "modelNumber": null,
          "serialNumber": null
        },
        "kind": "place",
        "semanticKind": "floor",
        "sourceState": "present",
        "cacheStatus": "stale",
        "sourceUpdatedAt": "2026-01-02T10:00:00Z",
        "retrievedAt": "2026-01-02T10:05:00Z",
        "aliases": [],
        "mobility": "unknown",
        "attachments": [],
        "maintenance": [],
        "nativeLinks": [],
        "networkBound": false,
        "networkStates": [],
        "networkRelations": []
      },
      {
        "workspaceId": "00000000-0000-4000-8000-000000000800",
        "homeId": "00000000-0000-4000-8000-000000000801",
        "key": "[\"00000000-0000-4000-8000-000000000800\",\"00000000-0000-4000-8000-000000000801\",\"00000000-0000-4000-8000-000000000900\",\"synthetic-building-source\",\"homebox-entity\",\"00000000-0000-4000-8000-000000000513\"]",
        "source": {
          "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
          "collectionId": "synthetic-building-source",
          "sourceKind": "homebox-entity",
          "externalId": "00000000-0000-4000-8000-000000000513"
        },
        "entity": {
          "id": "00000000-0000-4000-8000-000000000513",
          "name": "Archived source place",
          "description": "",
          "notes": null,
          "entityType": {
            "id": "00000000-0000-4000-8000-000000000901",
            "name": "Generic location",
            "isLocation": true
          },
          "parent": null,
          "archived": true,
          "quantity": null,
          "manufacturer": null,
          "modelNumber": null,
          "serialNumber": null
        },
        "kind": "place",
        "semanticKind": "room",
        "sourceState": "archived",
        "cacheStatus": "stale",
        "sourceUpdatedAt": "2026-01-02T10:00:00Z",
        "retrievedAt": "2026-01-02T10:05:00Z",
        "aliases": [],
        "mobility": "unknown",
        "attachments": [],
        "maintenance": [],
        "nativeLinks": [],
        "networkBound": false,
        "networkStates": [],
        "networkRelations": []
      },
      {
        "workspaceId": "00000000-0000-4000-8000-000000000800",
        "homeId": "00000000-0000-4000-8000-000000000801",
        "key": "[\"00000000-0000-4000-8000-000000000800\",\"00000000-0000-4000-8000-000000000801\",\"00000000-0000-4000-8000-000000000900\",\"synthetic-building-source\",\"homebox-entity\",\"00000000-0000-4000-8000-000000000514\"]",
        "source": {
          "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
          "collectionId": "synthetic-building-source",
          "sourceKind": "homebox-entity",
          "externalId": "00000000-0000-4000-8000-000000000514"
        },
        "entity": {
          "id": "00000000-0000-4000-8000-000000000514",
          "name": "Unknown-level room",
          "description": "",
          "notes": null,
          "entityType": {
            "id": "00000000-0000-4000-8000-000000000901",
            "name": "Generic location",
            "isLocation": true
          },
          "parent": null,
          "archived": false,
          "quantity": null,
          "manufacturer": null,
          "modelNumber": null,
          "serialNumber": null
        },
        "kind": "place",
        "semanticKind": "room",
        "sourceState": "present",
        "cacheStatus": "stale",
        "sourceUpdatedAt": "2026-01-02T10:00:00Z",
        "retrievedAt": "2026-01-02T10:05:00Z",
        "aliases": [],
        "mobility": "unknown",
        "attachments": [],
        "maintenance": [],
        "nativeLinks": [],
        "networkBound": false,
        "networkStates": [],
        "networkRelations": []
      }
    ],
    "caches": [
      {
        "owner": "homebox",
        "status": "stale",
        "displayStatus": "stale",
        "lastSuccessfulFetchAt": "2026-01-02T10:05:00Z"
      }
    ]
  },
  "records": {
    "identity": [
      {
        "target": {
          "authority": "atlas",
          "recordType": "identity",
          "recordId": "00000000-0000-4000-8000-000000000001"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "location",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "identity",
          "recordId": "00000000-0000-4000-8000-000000000002"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "location",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "identity",
          "recordId": "00000000-0000-4000-8000-000000000003"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "location",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "identity",
          "recordId": "00000000-0000-4000-8000-000000000004"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "location",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "identity",
          "recordId": "00000000-0000-4000-8000-000000000005"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "location",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "identity",
          "recordId": "00000000-0000-4000-8000-000000000006"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "location",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "identity",
          "recordId": "00000000-0000-4000-8000-000000000007"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "location",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "identity",
          "recordId": "00000000-0000-4000-8000-000000000008"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "location",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "identity",
          "recordId": "00000000-0000-4000-8000-000000000009"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "location",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "identity",
          "recordId": "00000000-0000-4000-8000-000000000010"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "location",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "identity",
          "recordId": "00000000-0000-4000-8000-000000000011"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "location",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "identity",
          "recordId": "00000000-0000-4000-8000-000000000012"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "location",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "identity",
          "recordId": "00000000-0000-4000-8000-000000000013"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "location",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "identity",
          "recordId": "00000000-0000-4000-8000-000000000014"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "location",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      }
    ],
    "binding": [
      {
        "target": {
          "authority": "atlas",
          "recordType": "binding",
          "recordId": "00000000-0000-4000-8000-000000000101"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000001",
          "source": {
            "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
            "collectionId": "synthetic-building-source",
            "sourceKind": "homebox-entity",
            "externalId": "00000000-0000-4000-8000-000000000501"
          },
          "reviewStatus": "accepted",
          "sourceState": "present",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "binding",
          "recordId": "00000000-0000-4000-8000-000000000102"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000002",
          "source": {
            "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
            "collectionId": "synthetic-building-source",
            "sourceKind": "homebox-entity",
            "externalId": "00000000-0000-4000-8000-000000000502"
          },
          "reviewStatus": "accepted",
          "sourceState": "present",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "binding",
          "recordId": "00000000-0000-4000-8000-000000000103"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000003",
          "source": {
            "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
            "collectionId": "synthetic-building-source",
            "sourceKind": "homebox-entity",
            "externalId": "00000000-0000-4000-8000-000000000503"
          },
          "reviewStatus": "accepted",
          "sourceState": "present",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "binding",
          "recordId": "00000000-0000-4000-8000-000000000104"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000004",
          "source": {
            "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
            "collectionId": "synthetic-building-source",
            "sourceKind": "homebox-entity",
            "externalId": "00000000-0000-4000-8000-000000000504"
          },
          "reviewStatus": "accepted",
          "sourceState": "present",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "binding",
          "recordId": "00000000-0000-4000-8000-000000000105"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000005",
          "source": {
            "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
            "collectionId": "synthetic-building-source",
            "sourceKind": "homebox-entity",
            "externalId": "00000000-0000-4000-8000-000000000505"
          },
          "reviewStatus": "accepted",
          "sourceState": "present",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "binding",
          "recordId": "00000000-0000-4000-8000-000000000106"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000006",
          "source": {
            "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
            "collectionId": "synthetic-building-source",
            "sourceKind": "homebox-entity",
            "externalId": "00000000-0000-4000-8000-000000000506"
          },
          "reviewStatus": "accepted",
          "sourceState": "present",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "binding",
          "recordId": "00000000-0000-4000-8000-000000000107"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000007",
          "source": {
            "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
            "collectionId": "synthetic-building-source",
            "sourceKind": "homebox-entity",
            "externalId": "00000000-0000-4000-8000-000000000507"
          },
          "reviewStatus": "accepted",
          "sourceState": "present",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "binding",
          "recordId": "00000000-0000-4000-8000-000000000108"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000008",
          "source": {
            "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
            "collectionId": "synthetic-building-source",
            "sourceKind": "homebox-entity",
            "externalId": "00000000-0000-4000-8000-000000000508"
          },
          "reviewStatus": "accepted",
          "sourceState": "present",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "binding",
          "recordId": "00000000-0000-4000-8000-000000000109"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000009",
          "source": {
            "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
            "collectionId": "synthetic-building-source",
            "sourceKind": "homebox-entity",
            "externalId": "00000000-0000-4000-8000-000000000509"
          },
          "reviewStatus": "accepted",
          "sourceState": "present",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "binding",
          "recordId": "00000000-0000-4000-8000-000000000110"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000010",
          "source": {
            "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
            "collectionId": "synthetic-building-source",
            "sourceKind": "homebox-entity",
            "externalId": "00000000-0000-4000-8000-000000000510"
          },
          "reviewStatus": "accepted",
          "sourceState": "present",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "binding",
          "recordId": "00000000-0000-4000-8000-000000000111"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000011",
          "source": {
            "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
            "collectionId": "synthetic-building-source",
            "sourceKind": "homebox-entity",
            "externalId": "00000000-0000-4000-8000-000000000511"
          },
          "reviewStatus": "accepted",
          "sourceState": "present",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "binding",
          "recordId": "00000000-0000-4000-8000-000000000112"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000012",
          "source": {
            "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
            "collectionId": "synthetic-building-source",
            "sourceKind": "homebox-entity",
            "externalId": "00000000-0000-4000-8000-000000000512"
          },
          "reviewStatus": "accepted",
          "sourceState": "present",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "binding",
          "recordId": "00000000-0000-4000-8000-000000000113"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000013",
          "source": {
            "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
            "collectionId": "synthetic-building-source",
            "sourceKind": "homebox-entity",
            "externalId": "00000000-0000-4000-8000-000000000513"
          },
          "reviewStatus": "accepted",
          "sourceState": "archived",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "binding",
          "recordId": "00000000-0000-4000-8000-000000000114"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000014",
          "source": {
            "sourceInstanceId": "00000000-0000-4000-8000-000000000900",
            "collectionId": "synthetic-building-source",
            "sourceKind": "homebox-entity",
            "externalId": "00000000-0000-4000-8000-000000000514"
          },
          "reviewStatus": "accepted",
          "sourceState": "present",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      }
    ],
    "location-semantics": [
      {
        "target": {
          "authority": "atlas",
          "recordType": "location-semantics",
          "recordId": "00000000-0000-4000-8000-000000000201"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000001",
          "semanticKind": "building",
          "reviewStatus": "accepted",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "location-semantics",
          "recordId": "00000000-0000-4000-8000-000000000202"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000002",
          "semanticKind": "building",
          "reviewStatus": "accepted",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "location-semantics",
          "recordId": "00000000-0000-4000-8000-000000000203"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000003",
          "semanticKind": "building",
          "reviewStatus": "accepted",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "location-semantics",
          "recordId": "00000000-0000-4000-8000-000000000204"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000004",
          "semanticKind": "floor",
          "reviewStatus": "accepted",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ],
          "elevation": {
            "status": "known",
            "metres": 0,
            "datumAtlasId": "00000000-0000-4000-8000-000000000001"
          }
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "location-semantics",
          "recordId": "00000000-0000-4000-8000-000000000205"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000005",
          "semanticKind": "floor",
          "reviewStatus": "accepted",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ],
          "elevation": {
            "status": "known",
            "metres": 2.7,
            "datumAtlasId": "00000000-0000-4000-8000-000000000001"
          }
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "location-semantics",
          "recordId": "00000000-0000-4000-8000-000000000206"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000006",
          "semanticKind": "floor",
          "reviewStatus": "accepted",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ],
          "elevation": {
            "status": "unknown"
          }
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "location-semantics",
          "recordId": "00000000-0000-4000-8000-000000000207"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000007",
          "semanticKind": "room",
          "reviewStatus": "accepted",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "location-semantics",
          "recordId": "00000000-0000-4000-8000-000000000208"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000008",
          "semanticKind": "room",
          "reviewStatus": "accepted",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "location-semantics",
          "recordId": "00000000-0000-4000-8000-000000000209"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000009",
          "semanticKind": "room",
          "reviewStatus": "accepted",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "location-semantics",
          "recordId": "00000000-0000-4000-8000-000000000210"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000010",
          "semanticKind": "floor",
          "reviewStatus": "accepted",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ],
          "elevation": {
            "status": "known",
            "metres": -0.45,
            "datumAtlasId": "00000000-0000-4000-8000-000000000011"
          }
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "location-semantics",
          "recordId": "00000000-0000-4000-8000-000000000211"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000011",
          "semanticKind": "other",
          "reviewStatus": "accepted",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "location-semantics",
          "recordId": "00000000-0000-4000-8000-000000000212"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000012",
          "semanticKind": "floor",
          "reviewStatus": "accepted",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "location-semantics",
          "recordId": "00000000-0000-4000-8000-000000000213"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000013",
          "semanticKind": "room",
          "reviewStatus": "accepted",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "location-semantics",
          "recordId": "00000000-0000-4000-8000-000000000214"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "atlasId": "00000000-0000-4000-8000-000000000014",
          "semanticKind": "room",
          "reviewStatus": "accepted",
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      }
    ],
    "relation": [
      {
        "target": {
          "authority": "atlas",
          "recordType": "relation",
          "recordId": "00000000-0000-4000-8000-000000000300"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "location-membership",
          "membershipKind": "building",
          "from": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000001"
            }
          },
          "to": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000004"
            }
          },
          "reviewStatus": "accepted",
          "uncertainty": {
            "status": "unknown",
            "explanation": "Generic supplied membership uncertainty"
          },
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "relation",
          "recordId": "00000000-0000-4000-8000-000000000301"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "location-membership",
          "membershipKind": "building",
          "from": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000001"
            }
          },
          "to": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000005"
            }
          },
          "reviewStatus": "accepted",
          "uncertainty": {
            "status": "unknown",
            "explanation": "Generic supplied membership uncertainty"
          },
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "relation",
          "recordId": "00000000-0000-4000-8000-000000000302"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "location-membership",
          "membershipKind": "building",
          "from": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000001"
            }
          },
          "to": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000006"
            }
          },
          "reviewStatus": "accepted",
          "uncertainty": {
            "status": "unknown",
            "explanation": "Generic supplied membership uncertainty"
          },
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "relation",
          "recordId": "00000000-0000-4000-8000-000000000303"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "location-membership",
          "membershipKind": "building",
          "from": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000001"
            }
          },
          "to": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000007"
            }
          },
          "reviewStatus": "accepted",
          "uncertainty": {
            "status": "unknown",
            "explanation": "Generic supplied membership uncertainty"
          },
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "relation",
          "recordId": "00000000-0000-4000-8000-000000000304"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "location-membership",
          "membershipKind": "level",
          "from": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000004"
            }
          },
          "to": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000008"
            }
          },
          "reviewStatus": "accepted",
          "uncertainty": {
            "status": "unknown",
            "explanation": "Generic supplied membership uncertainty"
          },
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "relation",
          "recordId": "00000000-0000-4000-8000-000000000305"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "location-membership",
          "membershipKind": "building",
          "from": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000001"
            }
          },
          "to": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000010"
            }
          },
          "reviewStatus": "accepted",
          "uncertainty": {
            "status": "unknown",
            "explanation": "Generic supplied membership uncertainty"
          },
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "relation",
          "recordId": "00000000-0000-4000-8000-000000000306"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "location-membership",
          "membershipKind": "building",
          "from": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000001"
            }
          },
          "to": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000012"
            }
          },
          "reviewStatus": "accepted",
          "uncertainty": {
            "status": "unknown",
            "explanation": "Generic supplied membership uncertainty"
          },
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "relation",
          "recordId": "00000000-0000-4000-8000-000000000307"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "location-membership",
          "membershipKind": "building",
          "from": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000001"
            }
          },
          "to": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000013"
            }
          },
          "reviewStatus": "accepted",
          "uncertainty": {
            "status": "unknown",
            "explanation": "Generic supplied membership uncertainty"
          },
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "relation",
          "recordId": "00000000-0000-4000-8000-000000000308"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "location-membership",
          "membershipKind": "level",
          "from": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000006"
            }
          },
          "to": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000014"
            }
          },
          "reviewStatus": "accepted",
          "uncertainty": {
            "status": "unknown",
            "explanation": "Generic supplied membership uncertainty"
          },
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "relation",
          "recordId": "00000000-0000-4000-8000-000000000350"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "physical-access",
          "accessKind": "door",
          "assertion": "present",
          "direction": "bidirectional",
          "from": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000007"
            }
          },
          "to": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000008"
            }
          },
          "reviewStatus": "accepted",
          "uncertainty": {
            "status": "unknown",
            "explanation": null
          },
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "relation",
          "recordId": "00000000-0000-4000-8000-000000000351"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "physical-access",
          "accessKind": "stair",
          "assertion": "present",
          "direction": "from-to",
          "from": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000004"
            }
          },
          "to": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000005"
            }
          },
          "reviewStatus": "accepted",
          "uncertainty": {
            "status": "unknown",
            "explanation": null
          },
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "relation",
          "recordId": "00000000-0000-4000-8000-000000000352"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "physical-access",
          "accessKind": "opening",
          "assertion": "unknown",
          "direction": "from-to",
          "from": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000007"
            }
          },
          "to": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000009"
            }
          },
          "reviewStatus": "accepted",
          "uncertainty": {
            "status": "unknown",
            "explanation": null
          },
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      },
      {
        "target": {
          "authority": "atlas",
          "recordType": "relation",
          "recordId": "00000000-0000-4000-8000-000000000353"
        },
        "revision": 1,
        "lifecycle": "active",
        "payload": {
          "kind": "physical-access",
          "accessKind": "door",
          "assertion": "absent",
          "direction": "bidirectional",
          "from": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000005"
            }
          },
          "to": {
            "kind": "atlas-record",
            "ref": {
              "recordType": "identity",
              "recordId": "00000000-0000-4000-8000-000000000006"
            }
          },
          "reviewStatus": "accepted",
          "uncertainty": {
            "status": "unknown",
            "explanation": null
          },
          "evidenceIds": [
            "00000000-0000-4000-8000-000000000999"
          ]
        }
      }
    ]
  },
  "members": [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000004",
    "00000000-0000-4000-8000-000000000005",
    "00000000-0000-4000-8000-000000000006",
    "00000000-0000-4000-8000-000000000007",
    "00000000-0000-4000-8000-000000000008",
    "00000000-0000-4000-8000-000000000010",
    "00000000-0000-4000-8000-000000000012",
    "00000000-0000-4000-8000-000000000013",
    "00000000-0000-4000-8000-000000000014"
  ]
};
for (const kind of ['circuit', 'evidence']) {
  fixture.records[kind] = electrical.context.records.filter(row => row.recordType === kind).map(row => ({
    target: { authority: 'atlas', recordType: kind, recordId: row.recordId },
    revision: row.revision, lifecycle: row.lifecycle, payload: structuredClone(row.payload),
  }));
}
// Generated supporting evidence for the existing synthetic topology and circuits.
const evidenceIds = new Set(fixture.records.evidence.map(row => row.target.recordId));
for (const kind of ['identity', 'location-semantics', 'circuit']) {
  for (const row of fixture.records[kind]) for (const id of row.payload.evidenceIds) {
    if (evidenceIds.has(id)) continue;
    const evidence = structuredClone(fixture.records.evidence[0]);
    evidence.target.recordId = id; fixture.records.evidence.push(evidence); evidenceIds.add(id);
  }
}
// Keep the JSON integer token exact before the real lossless response decoder sees it.
fixture.records.evidence[0].payload.provenance.sourceRevision = JSON.rawJSON('9007199254740993');
const ajv = new Ajv2020({ strict:true, allErrors:true, allowUnionTypes:true });
addFormats(ajv); ajv.addSchema(atlas); ajv.addSchema(agent);
const schemas = { validate(ref, value) { const check=ajv.getSchema(agent.$id+ref); assert(check); assert(check(value), JSON.stringify(check.errors)); } };
const session = { schemaVersion: 1, actorId: '00000000-0000-4000-8000-000000000802', csrfToken:'synthetic-unused', expiresAt:'2099-01-01T00:00:00Z' };
const calls = [];
let electricalFault = null;
const snapshotSha256 = 'a'.repeat(64); // Shared synthetic positive-fixture comparison metadata.
const client = createTopologyClient({ schemas, getSessionBinding:()=>({session,scope:fixture.scope}), subscribeSessionBinding:()=>()=>{},
  transport:async (url, init)=>{
    const parsed=new URL(url,'https://atlas.invalid');
    assert.equal(parsed.pathname, `/api/atlas/stock/v3/workspaces/${fixture.scope.workspaceId}/homes/${fixture.scope.homeId}/invoke`);
    assert.deepEqual([...parsed.searchParams.keys()],['request']);
    assert.equal(init.method,'GET');assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');
    assert.deepEqual(init.headers,{Accept:'application/json'});assert.equal(init.body,undefined);assert(init.signal instanceof AbortSignal);
    const request=JSON.parse(parsed.searchParams.get('request'));calls.push(request);
    assert.deepEqual(request.context,fixture.scope);assert.equal(request.schemaVersion,3);assert.equal(request.payload.pageSize,100);assert.equal(request.payload.includeArchived,false);
    const kind=request.target.recordType;
    let rows=fixture.records[kind];
    if (request.payload.buildingId !== undefined) {assert.equal(kind,'identity');assert.equal(request.payload.buildingId,fixture.members[0]);rows=rows.filter(r=>fixture.members.includes(r.target.recordId));}
    const midpoint=Math.ceil(rows.length/2);const continued=request.payload.cursor!==null;
    if (continued) assert.equal(request.payload.cursor,'opaque+/topology==');
    if (electricalFault === 'duplicate' && kind === 'circuit') rows = [rows[0], rows[0]];
    if (electricalFault === 'tombstone' && kind === 'evidence') rows = rows.map(row => ({ ...row, lifecycle:'tombstoned' }));
    if (electricalFault === 'bad-payload' && kind === 'circuit') rows = rows.map(row => ({ ...row, payload: { ...row.payload, evidenceIds: [] } }));
    const result={schemaVersion:3,commandId:request.commandId,requestId:electricalFault === 'correlation' && kind === 'circuit' ? fixture.scope.homeId : request.requestId,resolvedScope:fixture.scope,status:'read',replayed:false,
      data:{records:continued?rows.slice(midpoint):rows.slice(0,midpoint),nextCursor:continued?null:'opaque+/topology==',sourceStatus:'current'}};
    return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json','x-atlas-snapshot-sha256':snapshotSha256}});
  } });
const binding=client.getBinding(),signal=new AbortController().signal;
const [identity,bindings,semantics,relations] = await Promise.all(['identity','binding','location-semantics','relation'].map(k=>client.listAll(binding,k,signal)));
for (const result of [identity,bindings,semantics,relations]) { assert.equal(result.status,'ready'); assert.equal(result.snapshotSha256,snapshotSha256); }
const projection=projectView(fixture.view);
const selectable=new Map(projection.house.spaces.map(s=>[s.id,projection.entries.get(s.id)]));
const index=buildTopologyIndex({identities:identity.records,bindings:bindings.records,semantics:semantics.records,relations:relations.records,sourceStatuses:['current']},fixture.view,selectable);
assert.equal(index.buildings.length,3);assert.notEqual(index.buildings[1].label,index.buildings[2].label);
const selected=await client.buildingMembers(binding,fixture.members[0],signal);assert.equal(selected.status,'ready');
assert.equal(selected.snapshotSha256,snapshotSha256);
const model=buildBuildingModel(index,fixture.members[0],selected.records);assert(model);
assert.deepEqual(selected.records.map(r=>r.target.recordId),fixture.members);
assert.equal(model.memberCount,9);assert.equal(model.levels.length,5);
const sameDatum=model.levels.filter(l=>l.elevation.status==='known'&&l.elevation.elevation.datumAtlasId===fixture.members[0]);
assert.deepEqual(sameDatum.map(l=>l.elevation.elevation.metres.token),['2.7','0']);
assert(model.levels.some(l=>l.elevation.status==='known'&&l.elevation.elevation.metres.token==='-0.45'));
assert(model.levels.some(l=>l.elevation.status==='unknown'));assert(model.levels.some(l=>l.elevation.status==='omitted'));
assert.equal(model.direct.length,2);assert.deepEqual(model.direct.map(l=>l.id),[fixture.members[4],fixture.members[8]]);assert.equal(model.direct.find(l=>l.entry?.entity.archived)?.selectId,undefined);
assert(model.outsideUnassigned.some(l=>l.name==='Unassigned place'));assert.equal(model.outsideElsewhere.length,0);
assert.equal(index.access.find(r=>r.payload.accessKind==='stair').payload.direction,'from-to');
assert.equal(index.access.find(r=>r.payload.accessKind==='opening').payload.assertion,'unknown');
assert.equal(index.access.filter(r=>r.payload.assertion==='absent').length,1);
assert.equal(metres(ExactDecimal.parse('0')),'0 m');assert.equal(metres(ExactDecimal.parse('-0.45')),'−0.45 m');
assert.equal(calls.length,10);assert(calls.filter(r=>r.payload.buildingId!==undefined).every(r=>r.commandId==='atlas.identity.list'));
console.log('PASS bounded positive canonical topology invoke, two-page original IDs/correlation, exact source binding, separate Alpha/Beta names, zero/negative/same-datum elevations, unknown and omitted levels, direct and unassigned members, typed access, archived source without invented availability');

const { electricalRecordOwnerCases } = await import('./electrical-record-owner-healthy.mjs');
await electricalRecordOwnerCases(client, binding, identity.records[0], semantics.records[0], fixture.records.circuit[0], fixture.records.evidence[0]);
console.log('PASS partial electrical record reads, unavailable review authority, stale pins and withdrawal');

for (const [fault, kind] of [['duplicate', 'circuit'], ['tombstone', 'evidence'], ['bad-payload', 'circuit'], ['correlation', 'circuit']]) {
  electricalFault = fault;
  assert.equal((await client.listAll(binding, kind, signal)).status, 'unavailable');
}
electricalFault = null;
console.log('PASS electrical native list rejects duplicate, tombstoned, malformed and uncorrelated results');

// Offline, an unavailable building read states the saved copy's limit and both
// surfaces choose its text through one hook (source check; no browser).
const section = readFileSync(new URL('../src/lantern/topology/BuildingSection.tsx', import.meta.url), 'utf8');
const scope = readFileSync(new URL('../src/lantern/topology/BuildingScope.tsx', import.meta.url), 'utf8');
assert.match(section, /Offline: building records are not held in this saved copy\./);
assert.match(section, /navigator\.onLine === false/);
for (const source of [section, scope]) assert.doesNotMatch(source, /messages\[(status|memberStatus)\]/);

// Room belongings join: an Atlas place reaches a HomeBox place only through an
// active, accepted binding on the complete source key, within the view's scope.
// Atlas place IDs here are distinct from every HomeBox ID except the one case
// that checks an equal-looking ID without a binding never joins.
{
  const { homeboxPlaceOf, homeboxContents, homeboxCacheFor, homeboxPlaceRecords } = await import('../src/lantern/topology/homebox-place.ts');
  const room = fixture.view.entries.find(e => e.entity.name === 'Direct room'), other = fixture.view.entries.find(e => e.entity.name === 'Lower room');
  const atlas = n => `00000000-0000-4000-8000-0000000b70${String(n).padStart(2, '0')}`;
  const identityOf = id => ({ target: { authority: 'atlas', recordType: 'identity', recordId: id }, revision: 1, lifecycle: 'active', payload: { kind: 'location', evidenceIds: [] } });
  let next = 0;
  const bind = (atlasId, source, extra = {}) => ({ target: { authority: 'atlas', recordType: 'binding', recordId: `00000000-0000-4000-8000-0000000b71${String(next++).padStart(2, '0')}` },
    revision: 1, lifecycle: extra.lifecycle ?? 'active', payload: { atlasId, source, reviewStatus: extra.reviewStatus ?? 'accepted', sourceState: 'present', evidenceIds: [] } });
  const { sourceKind: _kind, ...noKind } = room.source, { collectionId: _collection, ...noCollection } = room.source;
  const cases = {
    linked: [bind(atlas(1), { ...room.source })],
    otherCollection: [bind(atlas(2), { ...room.source, collectionId: 'another-collection' })],
    otherSource: [bind(atlas(3), { ...room.source, sourceInstanceId: '00000000-0000-4000-8000-0000000b7299' })],
    proposed: [bind(atlas(4), { ...room.source }, { reviewStatus: 'proposed' })],
    retired: [bind(atlas(5), { ...room.source }, { reviewStatus: 'retired' })],
    tombstoned: [bind(atlas(6), { ...room.source }, { lifecycle: 'tombstoned' })],
    noKind: [bind(atlas(7), noKind)],
    noCollection: [bind(atlas(8), noCollection)],
    otherKind: [bind(atlas(9), { ...room.source, sourceKind: 'network-device' })],
    ambiguous: [bind(atlas(10), { ...room.source }), bind(atlas(10), { ...other.source })],
    repeated: [bind(atlas(11), { ...room.source }), bind(atlas(11), { ...room.source })],
    noBinding: [],
  };
  const ids = { linked: 1, otherCollection: 2, otherSource: 3, proposed: 4, retired: 5, tombstoned: 6, noKind: 7, noCollection: 8, otherKind: 9, ambiguous: 10, repeated: 11, noBinding: 12 };
  // An Atlas identity that reuses the HomeBox place's own ID, with no binding.
  const sameId = room.entity.id;
  const joinIndex = buildTopologyIndex({ identities: [...Object.values(ids).map(n => identityOf(atlas(n))), identityOf(sameId)],
    bindings: Object.values(cases).flat(), semantics: [], relations: [], sourceStatuses: ['current'] }, fixture.view, selectable);
  const status = id => homeboxPlaceOf(joinIndex, fixture.view, id).status;
  assert.equal(homeboxPlaceOf(joinIndex, fixture.view, atlas(1)).place, room);
  assert.equal(status(atlas(11)), 'linked');
  for (const name of ['otherCollection', 'otherSource', 'noCollection']) assert.equal(status(atlas(ids[name])), 'absent', name);
  for (const name of ['proposed', 'retired', 'tombstoned', 'noKind', 'otherKind', 'noBinding']) assert.equal(status(atlas(ids[name])), 'unlinked', name);
  assert.equal(status(atlas(10)), 'ambiguous');
  assert.equal(status(sameId), 'unlinked', 'An Atlas ID equal to a HomeBox ID never joins without a binding');
  assert.equal(status(atlas(99)), 'unlinked', 'No Atlas identity, no link');
  // A view of another home never supplies the place.
  assert.equal(homeboxPlaceOf(joinIndex, { ...fixture.view, scope: { ...fixture.view.scope, homeId: '00000000-0000-4000-8000-0000000b7298' } }, atlas(1)).status, 'absent');

  // Contents: HomeBox's own parentage in the place's collection, direct only.
  const child = (name, kind, parent, source = room.source) => ({ ...room, kind, key: name, source: { ...source, externalId: name },
    entity: { ...room.entity, id: name, name, parent: { id: parent } } });
  const entries = [['it-lamp', child('lamp', 'item', room.entity.id)], ['sp-shelf', child('shelf', 'place', room.entity.id)],
    ['it-book', child('book', 'item', 'shelf')], ['it-elsewhere', child('elsewhere', 'item', room.entity.id, { ...room.source, collectionId: 'another-collection' })],
    ['it-loose', child('loose', 'item', other.entity.id)]];
  const contents = homeboxContents(entries, room);
  assert.deepEqual(contents.belongings.map(row => row.id), ['it-lamp']);
  assert.equal(contents.innerPlaces, 1);

  // Retained records keep their state: confirmed-deleted, unresolved, unreviewed
  // and archived belongings are flagged and listed after present ones; archived
  // ones appear only while archive visibility includes them.
  const kept = (name, sourceState, archived = false) => ({ ...child(name, 'item', room.entity.id), sourceState,
    entity: { ...room.entity, id: name, name, parent: { id: room.entity.id }, archived } });
  const stated = { ...fixture.view, entries: [...fixture.view.entries, kept('deleted-chair', 'confirmed-deleted'), kept('unresolved-rug', 'unresolved'),
    kept('unreviewed-vase', 'unreviewed'), kept('archived-lamp', 'archived', true), kept('present-desk', 'present')] };
  const listed = includeArchived => {
    const entries = [...projectView(stated, undefined, undefined, null, includeArchived).entries].filter(([id]) => id.startsWith('it-') || id.startsWith('sp-'));
    return homeboxContents(entries, room).belongings.map(row => [row.entry.entity.name, row.flagged]);
  };
  assert.deepEqual(listed(false), [['present-desk', false], ['deleted-chair', true], ['unresolved-rug', true], ['unreviewed-vase', true]]);
  assert.deepEqual(listed(true), [['present-desk', false], ['deleted-chair', true], ['unresolved-rug', true], ['unreviewed-vase', true], ['archived-lamp', true]]);
  // The panel names each flagged row's state through the shared RecordStatus and counts flagged rows apart.
  const inspector = readFileSync(new URL('../src/lantern/unified-atlas/AtlasInspector.tsx', import.meta.url), 'utf8');
  assert.match(inspector, /row\.flagged && <span className="ua-belonging-state"><RecordStatus entry=\{row\.entry\} compact \/>/);
  assert.match(inspector, /Show all \{state\.belongings\.length\.toLocaleString\(\)\}\{flagged > 0 && `, \$\{flagged\.toLocaleString\(\)\} flagged`\}/);

  // A direct record of unknown kind is listed as unclassified, never dropped.
  const unknownOnly = homeboxContents([['uk-crate', child('crate', 'unknown', room.entity.id)]], room);
  assert.deepEqual(unknownOnly.belongings.map(row => [row.id, row.unclassified]), [['uk-crate', true]]);
  assert.equal(homeboxContents([['it-lamp', child('lamp', 'item', room.entity.id)]], room).belongings[0].unclassified, false);

  // The linked place's own state: flagged when deleted, unresolved, unreviewed
  // or archived; an archived place is hidden while archived records are not included.
  const placeAs = (sourceState, archived = false) => ({ ...room, sourceState, entity: { ...room.entity, archived } });
  const visibleOf = (view, includeArchived) => [...projectView(view, undefined, undefined, null, includeArchived).entries].filter(([id]) => /^(it|sp|uk)-/.test(id));
  for (const state of ['confirmed-deleted', 'unresolved', 'unreviewed']) {
    const place = placeAs(state), view = { ...fixture.view, entries: fixture.view.entries.map(e => e === room ? place : e) };
    const records = homeboxPlaceRecords(place, visibleOf(view, false), []);
    assert.equal(records.hidden, false, state); assert.equal(records.flagged, true, state);
  }
  const archivedPlace = placeAs('archived', true), archivedView = { ...fixture.view, entries: fixture.view.entries.map(e => e === room ? archivedPlace : e) };
  assert.deepEqual(homeboxPlaceRecords(archivedPlace, visibleOf(archivedView, false), []), { hidden: true });
  const shownArchived = homeboxPlaceRecords(archivedPlace, visibleOf(archivedView, true), []);
  assert.equal(shownArchived.hidden, false); assert.equal(shownArchived.flagged, true);
  assert.equal(homeboxPlaceRecords(room, visibleOf(fixture.view, false), []).flagged, false);
  assert.match(inspector, /placeFlagged && <div className="ua-belonging-state"><RecordStatus entry=\{state\.placeEntry\} compact \/>/);
  assert.match(inspector, /The linked HomeBox place is archived\. Include archived records to list its belongings\./);

  // Freshness only from a cache that is the place's collection, or the one cache whose unnamed identifiers fit it.
  const cache = (sourceInstanceId, collectionId) => ({ owner: 'homebox', status: 'stale', displayStatus: 'stale', lastSuccessfulFetchAt: '2026-01-02T10:00:00Z',
    ...(sourceInstanceId === undefined ? {} : { sourceInstanceId }), ...(collectionId === undefined ? {} : { collectionId }) });
  const { sourceInstanceId: own, collectionId: ownCollection } = room.source;
  assert.equal(homeboxCacheFor(room, [cache(own, 'another-collection')]), null, 'Another collection is never this place\'s freshness');
  assert.equal(homeboxCacheFor(room, [cache('00000000-0000-4000-8000-0000000b7297', ownCollection)]), null);
  const unnamed = cache(); assert.equal(homeboxCacheFor(room, [unnamed]), unnamed);
  const partly = cache(own); assert.equal(homeboxCacheFor(room, [partly]), partly);
  const exact = cache(own, ownCollection); assert.equal(homeboxCacheFor(room, [unnamed, exact, cache(own, 'another-collection')]), exact);
  assert.equal(homeboxCacheFor(room, [cache(), cache()]), null, 'Two unnamed caches do not say which is this collection');
  assert.equal(homeboxCacheFor(room, [{ ...exact, owner: 'network' }]), null);
  assert.match(inspector, /'update state for this collection not supplied'/);

  // When the settled retry offers no retry (success or a terminal failure), focus left on the body goes to the heading.
  assert.match(inspector, /const canRetryNow = state\.status === 'failed' && RETRY\.has\(state\.reason\);/);
  assert.match(inspector, /if \(!canRetryNow && document\.activeElement === document\.body\) heading\.current\?\.focus\(\);/);
}
console.log('PASS room belongings join: complete reviewed source key only; other collection/source, unreviewed, retired, tombstoned, incomplete key, other kind, ambiguous, equal-looking ID and other home never join; direct contents only; deleted, unresolved, unreviewed and archived (archive visibility on and off) records flagged after present ones; unknown-kind records listed as unclassified; linked place state flagged or hidden while archived; freshness only from a fitting cache; retry focus');
