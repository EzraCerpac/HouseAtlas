"""Synthetic selector cases; histories are disposable and never fetch a remote."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from select_pr_checks import FULL, MANIFEST, changed_records, classify, select


class SelectorTests(unittest.TestCase):
    def assert_lanes(self, result, backend, frontend, loopback):
        self.assertEqual({key: result[key] for key in FULL},
                         dict(backend=backend, frontend=frontend, loopback=loopback))

    def test_dependency_matrix(self):
        cases = [
            ('frontend/src/lantern/unified-atlas/View.tsx', False, True, 'smoke'),
            ('frontend/src/styles/app.css', False, True, 'smoke'),
            ('frontend/src/numeric/value.ts', False, True, 'smoke'),
            ('frontend/src/offline/cache.ts', False, True, 'smoke'),
            ('frontend/lantern-tests/healthy-read.mjs', False, True, 'smoke'),
            ('backend/src/http/read.rs', True, False, 'full'),
            ('backend/examples/healthy.rs', True, False, 'full'),
            ('backend/tests/example.rs', True, False, 'full'),
            ('README.md', False, False, 'none'),
            ('docs/contributing/notes.md', False, False, 'none'),
        ]
        for path, backend, frontend, loopback in cases:
            for status in ('A', 'M'):
                with self.subTest(path=path, status=status):
                    self.assert_lanes(classify([(status, path), ('M', MANIFEST)]), backend, frontend, loopback)

    def test_uncertainty_and_shared_paths_are_full(self):
        paths = ['frontend/src/lantern/Host.tsx', 'frontend/src/lantern/scans/native-write-types.ts',
                 'frontend/src/lantern/scans/native-ui/NativeGeometryIntake.tsx',
                 'backend/src/contracts/catalog.rs', 'packages/contracts/schema.json',
                 'frontend/src/agent/contract.ts', 'frontend/package-lock.json',
                 'frontend/vite.config.ts', 'Cargo.toml', 'Cargo.lock', 'package.json',
                 'package-lock.json', '.github/workflows/example.yml', 'tools/ci/example.py',
                 'new-stack/source.txt', '../README.md', '/README.md', 'docs//x.md',
                 'docs/../x.md', 'docs/bad\nname.md']
        for path in paths:
            with self.subTest(path=path):
                self.assert_lanes(classify([('M', path)]), True, True, 'full')
        for status in ('D', 'R100', 'C100', 'T', 'U', '?'):
            self.assert_lanes(classify([(status, 'frontend/src/lantern/unified-atlas/View.tsx')]), True, True, 'full')
        for records in ([], [('M', MANIFEST)], [('M', 'backend/src/lib.rs'), ('M', 'frontend/src/lantern/unified-atlas/View.tsx')]):
            self.assert_lanes(classify(records), True, True, 'full')

    def test_push_and_bad_events_are_full(self):
        for name, event in [('push', {}), ('workflow_dispatch', {}), ('pull_request', {}),
                            ('pull_request', None), ('pull_request', {'pull_request': {}})]:
            self.assert_lanes(select(name, event, '.'), True, True, 'full')
        with patch('select_pr_checks.changed_records', side_effect=subprocess.TimeoutExpired('git', 30)):
            event = {'pull_request': {'base': {'sha': 'a' * 40}, 'head': {'sha': 'b' * 40}}}
            self.assert_lanes(select('pull_request', event, '.'), True, True, 'full')

    def test_real_merge_base_and_event_merge_checkout(self):
        with tempfile.TemporaryDirectory() as folder:
            repo = Path(folder)
            def git(*args):
                return subprocess.check_output(['git', '-C', folder, *args], stderr=subprocess.PIPE,
                    env={**os.environ, 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull,
                         'GIT_AUTHOR_NAME': 'Synthetic', 'GIT_AUTHOR_EMAIL': 'synthetic@example.invalid',
                         'GIT_COMMITTER_NAME': 'Synthetic', 'GIT_COMMITTER_EMAIL': 'synthetic@example.invalid'}).decode().strip()
            def commit(path, text):
                target = repo / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(text)
                git('add', '--', path)
                git('commit', '-m', 'Synthetic fixture')
                return git('rev-parse', 'HEAD')
            git('init', '-b', 'main')
            ancestor = commit('README.md', 'synthetic\n')
            git('checkout', '-b', 'fork-head')
            head = commit('frontend/src/lantern/unified-atlas/View.tsx', 'synthetic\n')
            git('checkout', 'main')
            base = commit('backend/src/lib.rs', 'target-only change\n')
            git('merge', '--no-ff', 'fork-head', '-m', 'Synthetic PR merge')
            git('checkout', '--detach')
            # A target-only backend change must not pollute the PR path set.
            self.assertNotEqual(base, ancestor)
            self.assertEqual(changed_records(repo, base, head), [('A', 'frontend/src/lantern/unified-atlas/View.tsx')])
            event = {'pull_request': {'base': {'sha': base}, 'head': {'sha': head}}}
            self.assert_lanes(select('pull_request', event, repo), False, True, 'smoke')
            event['pull_request']['head']['sha'] = '0' * 40
            self.assert_lanes(select('pull_request', event, repo), True, True, 'full')
            git('checkout', 'fork-head')
            git('mv', 'frontend/src/lantern/unified-atlas/View.tsx', 'frontend/src/lantern/unified-atlas/Renamed.tsx')
            git('commit', '-m', 'Synthetic rename')
            self.assert_lanes(classify(changed_records(repo, head, git('rev-parse', 'HEAD'))), True, True, 'full')
            before_delete = git('rev-parse', 'HEAD')
            git('rm', 'frontend/src/lantern/unified-atlas/Renamed.tsx')
            git('commit', '-m', 'Synthetic deletion')
            self.assert_lanes(classify(changed_records(repo, before_delete, git('rev-parse', 'HEAD'))), True, True, 'full')


if __name__ == '__main__':
    unittest.main()
