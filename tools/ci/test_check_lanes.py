"""Synthetic check_lanes cases; every repository is a disposable temporary folder."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

_spec = importlib.util.spec_from_file_location('check_lanes', Path(__file__).resolve().with_name('check_lanes.py'))
check_lanes = importlib.util.module_from_spec(_spec)
sys.dont_write_bytecode = True  # loading by path would otherwise cache check_lanes bytecode in the tree
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
        'workflows': {'core.yml': {'name': 'Synthetic core', 'on': {'pull_request': None}, 'env': {}, 'jobs': {
            'core': {'runsOn': 'ubuntu-24.04', 'if': None, 'matrix': None, 'needs': None, 'env': {}, 'lane': None}}}},
        'actions': {},
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

    def test_step_env_and_options_must_match(self):
        self.edit('.github/workflows/core.yml', '        if: always()\n',
                  '        if: always()\n        env:\n          SAMPLE: one\n')
        self.assert_fails("step core.lines: env is {'SAMPLE': 'one'}, manifest says {}")
        data = manifest()
        data['steps'][1]['env'] = {'SAMPLE': 'one'}
        self.write_manifest(data)
        self.assertEqual(self.run_checker('--write'), (0, ''))
        self.assertIn('`SAMPLE=one`<br>`node tools/sample/a.mjs`', (self.root / check_lanes.DOCS).read_text(encoding='utf-8'))
        self.edit('.github/workflows/core.yml', '          SAMPLE: one\n', '')
        self.assert_fails("step core.lines: env is {}, manifest says {'SAMPLE': 'one'}")
        self.edit('.github/workflows/core.yml', '        if: always()\n        env:\n',
                  '        if: always()\n        continue-on-error: true\n        env:\n          SAMPLE: one\n')
        self.assert_fails("step core.lines: step options are {'continue-on-error': 'true'}, manifest says {}")

    def test_unread_workflow_job_and_step_keys_are_refused(self):
        cases = {
            "run step 'Run folded' key 'uses'": WORKFLOW.replace(
                '      - name: Run folded\n', '      - name: Run folded\n        uses: ./local\n'),
            "job core key 'defaults'": WORKFLOW.replace(
                '    runs-on: ubuntu-24.04\n', '    runs-on: ubuntu-24.04\n    defaults:\n      run:\n        shell: sh\n'),
            "workflow key 'defaults'": WORKFLOW.replace('jobs:\n', 'defaults:\n  run:\n    shell: sh\njobs:\n'),
            "job core strategy key 'max-parallel'": WORKFLOW.replace(
                '    runs-on: ubuntu-24.04\n', '    runs-on: ubuntu-24.04\n    strategy:\n      max-parallel: 1\n'),
        }
        for message, text in cases.items():
            with self.subTest(message=message), self.assertRaisesRegex(check_lanes.LaneError, message):
                check_lanes.read_workflow('core.yml', text)

    def test_triggers_needs_and_env_must_match(self):
        self.edit('.github/workflows/core.yml', 'on:\n  pull_request:\n', 'on:\n  pull_request:\n    branches: [main]\n')
        self.assert_fails("workflow core.yml: on is {'pull_request': {'branches': '[main]'}}, manifest says {'pull_request': None}")
        self.edit('.github/workflows/core.yml', '    branches: [main]\n', '')
        self.edit('.github/workflows/core.yml', 'jobs:\n', "env:\n  QUOTED: '0'\n  DOUBLE: \"a b\"\njobs:\n")
        self.assert_fails("workflow core.yml: env is {'QUOTED': '0', 'DOUBLE': 'a b'}, manifest says {}")
        data = manifest()
        data['workflows']['core.yml']['env'] = {'QUOTED': '0', 'DOUBLE': 'a b'}
        self.write_manifest(data)
        self.assertEqual(self.run_checker(), (0, ''))
        self.edit('.github/workflows/core.yml', '    runs-on: ubuntu-24.04\n',
                  '    needs: setup\n    runs-on: ubuntu-24.04\n    env:\n      JOB: one\n')
        self.assert_fails("core.yml job core: needs is 'setup', manifest says None")
        self.assert_fails("core.yml job core: env is {'JOB': 'one'}, manifest says {}")

    def test_lane_selector_job_selection_and_rendering(self):
        laned = WORKFLOW + """  laned:
    needs: core
    if: ${{ !cancelled() }}
    strategy:
      matrix:
        shard: [1, 2]
    runs-on: ubuntu-24.04
    steps:
      - name: Select
        id: lane
        env:
          RUN_LANE: ${{ needs.core.result != 'success' }}
        run: printf 'run=%s\\n' "$RUN_LANE" >> "$GITHUB_OUTPUT"
      - name: Run laned
        if: steps.lane.outputs.run == 'true' && (matrix.shard == 1)
        run: node tools/sample/a.mjs --laned
"""
        (self.root / '.github/workflows/core.yml').write_text(laned, encoding='utf-8')
        data = manifest()
        data['lanes'] = {'sample': {'runLane': "${{ needs.core.result != 'success' }}",
                                    'when': 'runs when the synthetic core job did not succeed'}}
        data['workflows']['core.yml']['jobs']['laned'] = {
            'runsOn': 'ubuntu-24.04', 'if': '${{ !cancelled() }}', 'matrix': {'shard': '[1, 2]'},
            'needs': 'core', 'env': {}, 'lane': 'sample'}
        data['steps'] += [
            {'id': 'laned.select', 'workflow': 'core.yml', 'job': 'laned', 'step': 'Select', 'kind': 'plumbing',
             'stepId': 'lane', 'if': None, 'run': ['printf \'run=%s\\n\' "$RUN_LANE" >> "$GITHUB_OUTPUT"'], 'toolchain': [],
             'files': [], 'scope': 'Lane output.'},
            {'id': 'laned.run', 'workflow': 'core.yml', 'job': 'laned', 'step': 'Run laned', 'kind': 'test',
             'if': "steps.lane.outputs.run == 'true' && (matrix.shard == 1)", 'run': ['node tools/sample/a.mjs --laned'],
             'toolchain': ['node'], 'files': ['tools/sample/a.mjs'], 'scope': 'Laned line.'},
        ]
        self.write_manifest(data)
        self.assertEqual(self.run_checker('--write'), (0, ''))
        guide = (self.root / check_lanes.DOCS).read_text(encoding='utf-8')
        self.assertIn('| core / laned | Run laned | `node tools/sample/a.mjs --laned` | sample lane; `matrix.shard == 1` |', guide)
        self.assertIn('The sample lane runs when the synthetic core job did not succeed.', guide)
        self.assertIn('Triggers: `core.yml` on pull_request.', guide)
        self.edit('.github/workflows/core.yml', "needs.core.result != 'success' }}", "needs.core.result == 'failure' }}")
        self.assert_fails('core.yml job laned: RUN_LANE ["${{ needs.core.result == \'failure\' }}"] differs from lane sample')
        self.edit('.github/workflows/core.yml', "needs.core.result == 'failure' }}", "needs.core.result != 'success' }}")
        self.edit('.github/workflows/core.yml', '        shard: [1, 2]\n    runs-on: ubuntu-24.04', '        shard: [1, 2]\n    runs-on: macos-15')
        self.assert_fails("core.yml job laned: runsOn is 'macos-15', manifest says 'ubuntu-24.04'")
        self.edit('.github/workflows/core.yml', '        id: lane\n', '        id: lane-renamed\n')
        self.assert_fails("step laned.select: step id is 'lane-renamed', manifest says 'lane'")
        self.edit('.github/workflows/core.yml', '        id: lane-renamed\n', '')
        self.assert_fails("step laned.select: step id is None, manifest says 'lane'")
        self.edit('.github/workflows/core.yml', '      - name: Select\n', '      - name: Select\n        id: lane\n')
        data['workflows']['core.yml']['jobs']['laned']['lane'] = None
        self.write_manifest(data)
        self.assert_fails('core.yml job laned: has a RUN_LANE selector but no manifest lane')

    def test_run_healthy_list_counter(self):
        listing = """const SOURCE = [
  node('a.mjs'),
  // node('commented.mjs'),
  ...cases('b.mjs', 'case', ['one', 'two']),
  ['tools/sample/a.mjs', '--flag'],
];
const BUILD = [node('a.mjs', 'build')];
const BROWSER = [];
"""
        for relative, text in {'frontend/lantern-tests/run-healthy.mjs': listing,
                               'frontend/lantern-tests/a.mjs': '', 'frontend/lantern-tests/b.mjs': ''}.items():
            (self.root / relative).parent.mkdir(parents=True, exist_ok=True)
            (self.root / relative).write_text(text, encoding='utf-8')
        self.edit('.github/workflows/core.yml', '      - name: Run folded',
                  '      - name: Run healthy list\n        run: node frontend/lantern-tests/run-healthy.mjs\n'
                  '      - name: Run folded')
        data = manifest()
        data['steps'].append({
            'id': 'core.healthy', 'workflow': 'core.yml', 'job': 'core', 'step': 'Run healthy list', 'kind': 'test',
            'if': None, 'run': ['node frontend/lantern-tests/run-healthy.mjs'], 'toolchain': ['node'],
            'files': ['frontend/lantern-tests/run-healthy.mjs'], 'scope': 'Listed entries.',
            'cases': {'counter': 'run-healthy-list', 'file': 'frontend/lantern-tests/run-healthy.mjs',
                      'expected': {'SOURCE': 4, 'BUILD': 1, 'BROWSER': 0}}})
        self.write_manifest(data)
        self.assertEqual(self.run_checker('--write'), (0, ''))
        self.assertIn('| 4 source, 1 build, 0 browser |', (self.root / check_lanes.DOCS).read_text(encoding='utf-8'))
        self.edit('frontend/lantern-tests/run-healthy.mjs', "const BROWSER = [];", "const BROWSER = [node('a.mjs')];")
        self.assert_fails("run-healthy-list counts {'SOURCE': 4, 'BUILD': 1, 'BROWSER': 1}")
        self.edit('frontend/lantern-tests/run-healthy.mjs', "const BROWSER = [node('a.mjs')];",
                  "const BROWSER = [maybe ? node('a.mjs') : x];")
        self.assert_fails("unrecognized BROWSER entry 'maybe'")
        self.edit('frontend/lantern-tests/run-healthy.mjs', "const BROWSER = [maybe ? node('a.mjs') : x];",
                  "const BROWSER = [node('missing.mjs')];")
        self.assert_fails('list entry: missing file frontend/lantern-tests/missing.mjs')

    def test_toolchain_pin_and_repository_paths(self):
        self.edit('.node-version', '26.10.0', '26.9.0')
        self.assert_fails("toolchain node: .node-version lacks '26.10.0'")
        self.edit('.node-version', '26.9.0', '26.10.0')
        data = manifest()
        data['toolchains']['node']['pins'].append(['.node-version', '26.9'])
        data['steps'][1]['files'] = ['tools/sample/a.mjs', '../outside.mjs', '/abs.mjs']
        self.write_manifest(data)
        self.assert_fails("toolchain node: pin '26.9' does not name 26.10.0")
        self.assert_fails("step core.lines: invalid repository path '../outside.mjs'")
        self.assert_fails("step core.lines: invalid repository path '/abs.mjs'")

    def test_composite_action_run_steps(self):
        action = """name: Synthetic setup
runs:
  using: composite
  steps:
    - name: Install without scripts
      shell: bash
      run: npm ci --ignore-scripts
"""
        path = self.root / '.github/actions/setup/action.yml'
        path.parent.mkdir(parents=True)
        path.write_text(action, encoding='utf-8')
        self.assert_fails('.github/actions/setup/action.yml is not listed in tools/ci/lanes.json actions')
        data = manifest()
        data['actions'] = {'setup/action.yml': {'name': 'Synthetic setup'}}
        row = {'id': 'action.install', 'workflow': 'setup/action.yml', 'job': 'runs', 'step': 'Install without scripts',
               'kind': 'setup', 'if': None, 'run': ['npm ci --ignore-scripts'], 'options': {'shell': 'bash'},
               'toolchain': ['node', 'npm'], 'files': [], 'scope': 'No install scripts.'}
        data['steps'].append(row)
        self.write_manifest(data)
        self.assertEqual(self.run_checker('--write'), (0, ''))
        self.assertIn('2 setup, plumbing and summary run steps (1 of them in composite actions',
                      (self.root / check_lanes.DOCS).read_text(encoding='utf-8'))
        self.edit('.github/actions/setup/action.yml', 'npm ci --ignore-scripts', 'npm ci')
        self.assert_fails('step action.install: run differs from the workflow at line 1')
        self.edit('.github/actions/setup/action.yml', '      shell: bash\n      run: npm ci\n',
                  '      shell: sh\n      run: npm ci --ignore-scripts\n')
        self.assert_fails("step action.install: step options are {'shell': 'sh'}, manifest says {'shell': 'bash'}")
        self.edit('.github/actions/setup/action.yml', 'shell: sh', 'shell: bash')
        row['kind'] = 'test'
        self.write_manifest(data)
        self.assert_fails('step action.install: composite action steps take kind setup, plumbing or summary')


if __name__ == '__main__':
    unittest.main()
