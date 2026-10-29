"""Synthetic check_lanes cases; every repository is a disposable temporary folder."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

_spec = importlib.util.spec_from_file_location('check_lanes', Path(__file__).resolve().with_name('check_lanes.py'))
check_lanes = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_lanes)

WORKFLOW = """name: Synthetic core
on:
  pull_request:
jobs:
  core:
    runs-on: ubuntu-24.04
    steps:
      - name: Checkout
        uses: actions/checkout@0000000000000000000000000000000000000000 # v6
        with:
          fetch-depth: 1
      - name: Run sample tests
        run: python3 -m unittest discover -s tools/sample -p 'test_*.py'
      - name: Run two node lines
        if: always()
        run: |
          node tools/sample/a.mjs
          node tools/sample/a.mjs --again
      - name: Run folded
        run: >-
          node tools/sample/a.mjs
          --folded
"""

TEST_FILE = """import unittest


class Sample(unittest.TestCase):
    def test_one(self):
        pass

    def test_two(self):
        pass

    def helper(self):
        pass
"""


def manifest():
    return {
        'format': 'houseatlas-ci-lanes/1',
        'toolchains': {
            'node': {'version': '26.10.0', 'pins': [['.node-version', '26.10.0']]},
            'npm': {'version': None, 'pins': []},
            'rust': {'version': None, 'pins': []},
            'python3': {'version': None, 'pins': []},
        },
        'lanes': {},
        'workflows': {'core.yml': {'name': 'Synthetic core', 'jobs': {
            'core': {'runsOn': 'ubuntu-24.04', 'if': None, 'matrix': None, 'lane': None}}}},
        'outOfScopeWorkflows': {'other.yml': 'synthetic opt-in workflow'},
        'steps': [
            {'id': 'core.sample', 'workflow': 'core.yml', 'job': 'core', 'step': 'Run sample tests',
             'kind': 'test', 'if': None,
             'run': ["python3 -m unittest discover -s tools/sample -p 'test_*.py'"],
             'toolchain': ['python3'], 'files': ['tools/sample/test_sample.py'],
             'scope': 'Two synthetic methods.',
             'cases': {'counter': 'python-unittest-methods', 'dir': 'tools/sample',
                       'pattern': 'test_*.py', 'expected': 2},
             'claims': [['docs/notes.md', 'runs the two sample methods']]},
            {'id': 'core.lines', 'workflow': 'core.yml', 'job': 'core', 'step': 'Run two node lines',
             'kind': 'check', 'if': 'always()',
             'run': ['node tools/sample/a.mjs', 'node tools/sample/a.mjs --again'],
             'toolchain': ['node'], 'files': ['tools/sample/a.mjs'], 'scope': 'Two lines.'},
            {'id': 'core.folded', 'workflow': 'core.yml', 'job': 'core', 'step': 'Run folded',
             'kind': 'plumbing', 'if': None, 'run': ['node tools/sample/a.mjs --folded'],
             'toolchain': ['node'], 'files': ['tools/sample/a.mjs'], 'scope': 'Folded line.'},
        ],
    }


class CheckLanesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        files = {
            '.node-version': '26.10.0\n',
            '.github/workflows/core.yml': WORKFLOW,
            '.github/workflows/other.yml': 'name: Other\non:\n  workflow_dispatch:\n',
            'tools/sample/test_sample.py': TEST_FILE,
            'tools/sample/a.mjs': '',
            'docs/notes.md': 'CI runs the two sample\nmethods.\n',
            'docs/contributing/verification.md': '# Guide\n\n' + check_lanes.BEGIN + '\n' + check_lanes.END + '\n',
        }
        for relative, text in files.items():
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding='utf-8')
        self.write_manifest(manifest())
        self.assertEqual(self.run_checker('--write'), (0, ''))

    def write_manifest(self, data):
        path = self.root / check_lanes.MANIFEST
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data), encoding='utf-8')

    def edit(self, relative, old, new):
        path = self.root / relative
        text = path.read_text(encoding='utf-8')
        self.assertIn(old, text)
        path.write_text(text.replace(old, new, 1), encoding='utf-8')

    def run_checker(self, mode='--check'):
        errors = io.StringIO()
        with contextlib.redirect_stderr(errors), contextlib.redirect_stdout(io.StringIO()):
            code = check_lanes.main([mode, '--root', str(self.root)])
        return code, errors.getvalue()

    def assert_fails(self, fragment, mode='--check'):
        code, errors = self.run_checker(mode)
        self.assertEqual(code, 1, errors)
        self.assertIn(fragment, errors)

    def test_exact_match_passes_and_renders_shown_kinds_only(self):
        self.assertEqual(self.run_checker(), (0, ''))
        guide = (self.root / check_lanes.DOCS).read_text(encoding='utf-8')
        self.assertIn('| core / core | Run sample tests | `python3 -m unittest discover -s tools/sample -p \'test_*.py\'` '
                      '| every run | 2 unittest methods | Two synthetic methods. |', guide)
        self.assertIn('`node tools/sample/a.mjs`<br>`node tools/sample/a.mjs --again` | every run; `always()`', guide)
        self.assertNotIn('--folded', guide)
        self.assertIn('`other.yml` (synthetic opt-in workflow)', guide)

    def test_changed_command_fails(self):
        self.edit('.github/workflows/core.yml', 'a.mjs --again', 'a.mjs --changed')
        self.assert_fails("step core.lines: run differs")

    def test_extra_run_step_fails(self):
        self.edit('.github/workflows/core.yml', '      - name: Run folded',
                  '      - name: Unlisted\n        run: node tools/sample/a.mjs\n      - name: Run folded')
        self.assert_fails("run step 'Unlisted' has no tools/ci/lanes.json row")

    def test_missing_step_leaves_a_stale_row(self):
        self.edit('.github/workflows/core.yml', "      - name: Run two node lines\n        if: always()\n        run: |\n"
                  "          node tools/sample/a.mjs\n          node tools/sample/a.mjs --again\n", '')
        self.assert_fails("step core.lines: stale row")

    def test_folded_scalar_decoding(self):
        workflow = check_lanes.read_workflow('core.yml', WORKFLOW)
        steps = {step['step']: step for step in workflow['jobs']['core']['steps']}
        self.assertEqual(steps['Run folded']['run'], ['node tools/sample/a.mjs --folded'])
        self.assertEqual(steps['Run two node lines']['run'], ['node tools/sample/a.mjs', 'node tools/sample/a.mjs --again'])
        self.assertEqual(steps['Run two node lines']['if'], 'always()')
        with self.assertRaisesRegex(check_lanes.LaneError, 'more-indented'):
            check_lanes.read_workflow('core.yml', WORKFLOW.replace('          --folded', '            --folded'))

    def test_rejects_tabs_anchors_quoted_run_and_unnamed_run_steps(self):
        cases = {
            'tab character': WORKFLOW.replace('    runs-on', '\trunson', 1),
            'anchor, alias or tag': WORKFLOW.replace('runs-on: ubuntu-24.04', 'runs-on: &os ubuntu-24.04'),
            'must be an uncommented plain scalar': WORKFLOW.replace(
                "run: python3 -m unittest discover -s tools/sample -p 'test_*.py'", 'run: "python3 -V"'),
            'unnamed run step': WORKFLOW.replace('      - name: Run folded\n        run: >-', '      - run: >-'),
            'block scalar style': WORKFLOW.replace('run: |', 'run: |-'),
        }
        for message, text in cases.items():
            with self.subTest(message=message), self.assertRaisesRegex(check_lanes.LaneError, message):
                check_lanes.read_workflow('core.yml', text)
        (self.root / '.github/workflows/core.yml').write_text(cases['anchor, alias or tag'], encoding='utf-8')
        self.assert_fails('anchor, alias or tag')

    def test_case_counter_mismatch_fails(self):
        self.edit('tools/sample/test_sample.py', '    def helper(self):', '    def test_three(self):')
        self.assert_fails('python-unittest-methods counts 3, manifest expects 2')

    def test_missing_claim_fails(self):
        self.edit('docs/notes.md', 'two sample', 'three sample')
        self.assert_fails("docs/notes.md no longer says 'runs the two sample methods'")

    def test_stale_or_missing_marker_fails_and_write_refreshes(self):
        self.edit(check_lanes.DOCS, 'Two synthetic methods.', 'Hand edited.')
        self.assert_fails('generated CI inventory is stale')
        self.assertEqual(self.run_checker('--write'), (0, ''))
        self.assertEqual(self.run_checker(), (0, ''))
        self.edit(check_lanes.DOCS, check_lanes.END, '')
        self.assert_fails('expected one generated block')
        self.assert_fails('expected one generated block', mode='--write')

    def test_unknown_workflow_file_fails(self):
        (self.root / '.github/workflows/extra.yml').write_text('name: Extra\n', encoding='utf-8')
        self.assert_fails('.github/workflows/extra.yml is not listed in tools/ci/lanes.json')

    def test_undeclared_toolchain_and_unlisted_file_fail(self):
        data = manifest()
        data['steps'][1]['toolchain'] = []
        data['steps'][1]['files'] = []
        self.write_manifest(data)
        self.assert_fails('step core.lines: uses node but its toolchain list omits it')
        self.assert_fails('step core.lines: run names tools/sample/a.mjs but files omits it')


if __name__ == '__main__':
    unittest.main()
