#!/usr/bin/env python3
"""Print an unexecuted synthetic run sheet; never inspect a host or run checks."""
import json
from pathlib import Path

matrix = json.loads((Path(__file__).resolve().parents[2] /
                     'docs/operations/acceptance-300.json').read_text())
# Deliberately no input path, network, subprocess, browser, mutation or status updater.
# A fresh run sheet always discards any edited results or private identities.
result = {
    'profile': matrix['profile'],
    'synthetic': True,
    'sourceCommit': matrix['sourceCommit'],
    'ownerResumed': False,
    'installedIdentity': None,
    'deviceIdentity': None,
    'decision': None,
    'scenarios': [
        {**{key: row[key] for key in
            ('id', 'journey', 'source', 'owners', 'requiredObservation', 'content')},
         'status': 'DEFERRED', 'evidence': None}
        for row in matrix['scenarios']
    ],
}
print(json.dumps(result, indent=2))
