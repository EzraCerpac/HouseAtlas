// Fixed GitHub API origin; artifact redirects never receive an Authorization header.
export function createGithubApi({ token, repository, runAttempt, fetchImpl = fetch }) {
  if (typeof token !== 'string' || token.length === 0 || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
      !Number.isSafeInteger(runAttempt) || runAttempt < 1) throw new Error('Invalid GitHub API context');
  const base = `https://api.github.com/repos/${repository}`;
  async function bounded(response, maximum) {
    if (!response.ok || (response.headers.get('content-length') && Number(response.headers.get('content-length')) > maximum)) throw new Error('GitHub response unavailable');
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > maximum) { await response.body.cancel().catch(() => {}); throw new Error('GitHub response exceeds bound'); }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'HouseAtlas-performance-reporter' };
  async function request(path, method = 'GET', body) {
    const response = await fetchImpl(base + path, { method, headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, redirect: 'error', signal: AbortSignal.timeout(20000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return JSON.parse((await bounded(response, 8 * 1024 * 1024)).toString('utf8'));
  }
  async function pages(path, field) {
    const values = [];
    for (let page = 1; page <= 10; page++) {
      const result = await request(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const rows = field ? result[field] : result;
      if (!Array.isArray(rows)) throw new Error('Invalid GitHub metadata');
      values.push(...rows);
      if (rows.length < 100) return values;
    }
    throw new Error('GitHub metadata pagination exceeds bound');
  }
  return {
    getWorkflow: () => request('/actions/workflows/performance.yml'),
    getRun: id => request(`/actions/runs/${id}/attempts/${runAttempt}`),
    getPull: number => request(`/pulls/${number}`),
    getCommit: sha => request(`/commits/${sha}`),
    listPullsForCommit: sha => pages(`/commits/${sha}/pulls`),
    listArtifacts: id => pages(`/actions/runs/${id}/artifacts`, 'artifacts'),
    listComments: number => pages(`/issues/${number}/comments`),
    createComment: (number, body) => request(`/issues/${number}/comments`, 'POST', { body }),
    updateComment: (id, body) => request(`/issues/comments/${id}`, 'PATCH', { body }),
    downloadArtifact: async id => {
      const response = await fetchImpl(`${base}/actions/artifacts/${id}/zip`, { headers, redirect: 'manual', signal: AbortSignal.timeout(20000) });
      if (response.status === 200) return bounded(response, 262144);
      if (response.status !== 302) throw new Error('Artifact download unavailable');
      const location = new URL(response.headers.get('location'));
      if (location.protocol !== 'https:' || location.username || location.password ||
          !['.blob.core.windows.net', '.githubusercontent.com', '.amazonaws.com'].some(suffix => location.hostname.endsWith(suffix))) throw new Error('Invalid artifact redirect');
      return bounded(await fetchImpl(location.href, { redirect: 'error', signal: AbortSignal.timeout(20000) }), 262144);
    },
  };
}
