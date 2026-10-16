// Generated metadata/ZIP fixtures only; no real API, account or application port.
import { execFileSync } from 'node:child_process';

export const context = { repository: 'example/HouseAtlas', reporterSha: 'e'.repeat(40), runId: 2, runAttempt: 1 };
export const identity = { ...context, prNumber: 7, baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40),
  baseTree: 'c'.repeat(40), headTree: 'd'.repeat(40), harnessSha: null };
export function availabilityRecord() {
  return { format: 'houseatlas.perf.availability/1', repository: identity.repository, prNumber: identity.prNumber,
    baseSha: identity.baseSha, headSha: identity.headSha, runId: identity.runId, runAttempt: identity.runAttempt,
    status: 'blocked', reason: 'measurement-harness-unavailable' };
}
export function zipFixture(entries = [{ name: 'availability.json', content: JSON.stringify(availabilityRecord()) }]) {
  const source = `import io,json,stat,sys,zipfile\nrows=json.load(sys.stdin)\nout=io.BytesIO()\nwith zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED) as archive:\n for row in rows:\n  entry=zipfile.ZipInfo(row['name'])\n  entry.compress_type=zipfile.ZIP_DEFLATED\n  entry.external_attr=((stat.S_IFLNK|0o777) if row.get('symlink') else (stat.S_IFREG|0o644)) << 16\n  archive.writestr(entry,row['content'].encode())\nsys.stdout.buffer.write(out.getvalue())\n`;
  return execFileSync('python3', ['-I', '-c', source], { input: JSON.stringify(entries), maxBuffer: 131072, timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
}
export function fakeOriginApi() {
  const zip = zipFixture();
  const state = { writes: [], comments: [], zip,
    workflow: { id: 5, path: '.github/workflows/performance.yml' },
    run: { id: 2, run_attempt: 1, repository: { full_name: context.repository }, workflow_id: 5, event: 'pull_request', status: 'completed', conclusion: 'success',
      path: '.github/workflows/performance.yml@main', head_sha: identity.headSha, head_repository: { full_name: context.repository }, head_branch: 'synthetic-branch',
      pull_requests: [{ number: 7, base: { sha: identity.baseSha }, head: { sha: identity.headSha } }] },
    pull: { number: 7, state: 'open', base: { sha: identity.baseSha, repo: { full_name: context.repository } },
      head: { sha: identity.headSha, ref: 'synthetic-branch', repo: { full_name: context.repository } } },
    artifacts: [{ id: 9, name: 'houseatlas-perf-2-1', expired: false, size_in_bytes: zip.length, workflow_run: { id: 2, head_sha: identity.headSha } }],
  };
  const api = {
    getWorkflow: async () => structuredClone(state.workflow), getRun: async () => structuredClone(state.run), getPull: async () => structuredClone(state.pull),
    getCommit: async sha => ({ sha, commit: { tree: { sha: sha === identity.baseSha ? identity.baseTree : identity.headTree } } }),
    listPullsForCommit: async () => structuredClone(state.pulls ?? [state.pull]), listArtifacts: async () => structuredClone(state.artifacts), downloadArtifact: async () => state.zip,
    listComments: async () => structuredClone(state.comments),
    createComment: async (number, body) => { state.writes.push(['create', number, body]); state.comments.push({ id: 10, body, user: { login: 'github-actions[bot]', type: 'Bot' } }); },
    updateComment: async (id, body) => { state.writes.push(['update', id, body]); state.comments.find(row => row.id === id).body = body; },
  };
  return { api, state };
}
