import assert from 'node:assert/strict';

// The actual HTTP MCP profile is Editor-only and requires current CSRF on
// every POST, including initialize and the initialized notification.
export async function mcpContract({ transport, session, editorLogin, scope, signal }) {
  await session.signIn(editorLogin, signal);
  const editor = await session.session(signal);
  assert(editor && typeof editor.csrfToken === 'string' && editor.csrfToken.length > 0,
    'Current synthetic editor session required');
  const path = '/api/atlas/mcp/workspaces/' + scope.workspaceId + '/homes/' + scope.homeId;
  let mcpSession;
  const post = async message => {
    const result = await transport.fetch(path, {
      method: 'POST', signal, body: JSON.stringify(message),
      headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'X-Atlas-CSRF': editor.csrfToken,
        'MCP-Protocol-Version': '2025-11-25', ...(mcpSession ? { 'MCP-Session-Id': mcpSession } : {}) },
    });
    mcpSession = result.headers.get('mcp-session-id') ?? mcpSession;
    return result;
  };
  const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {},
      clientInfo: { name: 'Synthetic host-client contract', version: '1' } } });
  assert.equal(init.status, 200); assert.match(init.headers.get('content-type'), /application\/json/);
  assert.equal((await init.json()).result.protocolVersion, '2025-11-25'); assert(mcpSession);
  const ready = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(ready.status, 202); assert.equal(await ready.text(), '');
  const listed = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(listed.status, 200); assert.match(listed.headers.get('content-type'), /application\/json/);
  assert.deepEqual((await listed.json()).result.tools.map(row => row.name).sort(),
    ['atlas_bindings', 'atlas_media_geometry', 'atlas_records', 'homebox_entities_locations']);
}
