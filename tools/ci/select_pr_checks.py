#!/usr/bin/env python3
"""Small PR lane selector. Unknown input means full coverage; no network/API use."""
import json
import os
from pathlib import Path
import re
import subprocess

MANIFEST = 'docs/publication/source-manifest.json'
FULL = {'backend': True, 'frontend': True, 'loopback': 'full'}
# These frontend paths are presentation/cache code or their generated fixtures.
# API, host composition, agent, draft and mutation paths deliberately stay full.
FRONTEND = ('frontend/src/lantern/unified-atlas/', 'frontend/src/lantern/styles/',
            'frontend/src/styles/', 'frontend/src/numeric/',
            'frontend/src/offline/', 'frontend/lantern-tests/')
BACKEND = ('backend/src/', 'backend/examples/', 'backend/tests/')
SHARED = ('backend/src/contracts/',)


def full(reason):
    return dict(FULL, reason=reason)


def classify(records):
    """Records are (git status, path). Only additions/modifications narrow lanes."""
    kinds = set()
    for status, path in records:
        if status not in ('A', 'M'):
            return full('rename, deletion or unsupported change status')
        if (not path or path.startswith('/') or '\\' in path
                or any(part in ('', '.', '..') for part in path.split('/'))
                or any(ord(char) < 32 for char in path)):
            return full('unrecognized path encoding')
        if path == MANIFEST:
            continue
        if path.startswith(SHARED):
            return full('shared generated contract')
        if path.startswith(FRONTEND):
            kinds.add('frontend')
        elif path.startswith(BACKEND):
            kinds.add('backend')
        elif path == 'README.md' or (path.startswith('docs/') and path.endswith('.md')):
            kinds.add('docs')
        else:
            return full('shared configuration, tooling or unrecognized path')
    if not kinds:
        return full('empty or manifest-only change')
    if 'frontend' in kinds and 'backend' in kinds:
        return full('both stacks changed')
    if 'backend' in kinds:
        return {'backend': True, 'frontend': False, 'loopback': 'full', 'reason': 'backend source with all cross-stack loopbacks'}
    if 'frontend' in kinds:
        return {'backend': False, 'frontend': True, 'loopback': 'smoke', 'reason': 'frontend presentation with existing loopback shard 1'}
    return {'backend': False, 'frontend': False, 'loopback': 'none', 'reason': 'documentation; ordinary-core integrity/build checks remain'}


def git(repo, *args):
    return subprocess.run(['git', '-C', str(repo), *args], check=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30).stdout


def changed_records(repo, base, head):
    if not all(isinstance(sha, str) and re.fullmatch(r'[0-9a-fA-F]{40}', sha) for sha in (base, head)):
        raise ValueError('missing event commit')
    # The checkout has full history of the PR merge ref, whose parents include
    # the fork head and target base. No fork remote, credentials or API needed.
    ancestors = git(repo, 'merge-base', '--all', base, head).decode('ascii').splitlines()
    if len(ancestors) != 1:
        raise ValueError('missing or ambiguous merge base')
    raw = git(repo, 'diff', '--name-status', '-z', '--find-renames', ancestors[0], head, '--')
    fields = raw.decode('utf-8', errors='strict').split('\0')
    if fields.pop() != '':
        raise ValueError('unterminated change list')
    records = []
    while fields:
        status = fields.pop(0)
        if not fields:
            raise ValueError('truncated change list')
        path = fields.pop(0)
        if status.startswith(('R', 'C')):
            if not fields:
                raise ValueError('truncated rename')
            fields.pop(0)
        records.append((status, path))
    return records


def select(event_name, event, repo):
    if event_name != 'pull_request':
        return full('main push or non-PR event')
    try:
        pr = event['pull_request']
        return classify(changed_records(repo, pr['base']['sha'], pr['head']['sha']))
    except (KeyError, TypeError, ValueError, UnicodeError, OSError, subprocess.SubprocessError):
        return full('change detection unavailable; full coverage')


def main():
    try:
        event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
        result = select(os.environ.get('GITHUB_EVENT_NAME', ''), event, Path.cwd())
    except (KeyError, ValueError, OSError):
        result = full('event unavailable; full coverage')
    lines = [f'{key}={str(result[key]).lower()}' for key in ('backend', 'frontend', 'loopback')]
    if output := os.environ.get('GITHUB_OUTPUT'):
        with open(output, 'a', encoding='utf-8') as stream:
            stream.write('\n'.join(lines) + '\n')
    print(json.dumps(result, sort_keys=True))
    if summary := os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(summary, 'a', encoding='utf-8') as stream:
            stream.write('### PR check selection\n\n' + result['reason'] + '\n\n'
                         + '\n'.join('- ' + line for line in lines)
                         + '\n\nOrdinary-core/publication checks always run. Main pushes always run the full suite.\n')


if __name__ == '__main__':
    main()
