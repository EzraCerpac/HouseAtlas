/** Bounded generic positive only; no listener/provider/private input. */
import assert from 'node:assert/strict';
import Ajv2020 from '../node_modules/ajv/dist/2020.js';
import addFormats from '../node_modules/ajv-formats/dist/index.js';
import atlas from '../../packages/contracts/schemas/atlas.schema.json' with { type: 'json' };
import agent from '../../contracts/stock-wire3/agent/agent.schema.json' with { type: 'json' };
import { createTopologyClient } from '../src/api/topology-client.ts';
import { buildTopologyIndex, buildBuildingModel, metres } from '../src/lantern/topology/model.ts';
import { projectView } from '../src/lantern/adapters/read.ts';
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
const ajv = new Ajv2020({ strict:true, allErrors:true, allowUnionTypes:true });
addFormats(ajv); ajv.addSchema(atlas); ajv.addSchema(agent);
const schemas = { validate(ref, value) { const check=ajv.getSchema(agent.$id+ref); assert(check); assert(check(value), JSON.stringify(check.errors)); } };
const session = { schemaVersion: 1, actorId: '00000000-0000-4000-8000-000000000802', csrfToken:'synthetic-unused', expiresAt:'2099-01-01T00:00:00Z' };
const calls = [];
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
    const result={schemaVersion:3,commandId:request.commandId,requestId:request.requestId,resolvedScope:fixture.scope,status:'read',replayed:false,
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
assert.equal(model.memberCount,10);assert.equal(model.levels.length,5);
const sameDatum=model.levels.filter(l=>l.elevation.status==='known'&&l.elevation.elevation.datumAtlasId===fixture.members[0]);
assert.deepEqual(sameDatum.map(l=>l.elevation.elevation.metres),[2.7,0]);
assert(model.levels.some(l=>l.elevation.status==='known'&&l.elevation.elevation.metres===-0.45));
assert(model.levels.some(l=>l.elevation.status==='unknown'));assert(model.levels.some(l=>l.elevation.status==='omitted'));
assert.equal(model.direct.length,2);assert.deepEqual(model.direct.map(l=>l.id),[fixture.members[4],fixture.members[8]]);assert.equal(model.direct.find(l=>l.entry?.entity.archived)?.selectId,undefined);
assert(model.outsideUnassigned.some(l=>l.name==='Unassigned place'));assert.equal(model.outsideElsewhere.length,2);
assert.equal(index.access.find(r=>r.payload.accessKind==='stair').payload.direction,'from-to');
assert.equal(index.access.find(r=>r.payload.accessKind==='opening').payload.assertion,'unknown');
assert.equal(index.access.filter(r=>r.payload.assertion==='absent').length,1);
assert.equal(metres(0),'0 m');assert.equal(metres(-0.45),'−0.45 m');
assert.equal(calls.length,10);assert(calls.filter(r=>r.payload.buildingId!==undefined).every(r=>r.commandId==='atlas.identity.list'));
console.log('PASS bounded positive canonical topology invoke, two-page original IDs/correlation, exact source binding, separate Alpha/Beta names, zero/negative/same-datum elevations, unknown and omitted levels, direct and unassigned members, typed access, archived source without invented availability');
