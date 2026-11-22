/** Radio station client: two passive GETs, the station reading and a cover by
 * digest. 404 means no station is configured for this home; 401 and 403 mean
 * this viewer may not read it. */
import { decodeRadioStation, RadioRefused, type RadioPort, type RadioScope } from '../src/lantern/unified-atlas/radio';

const MAX_RESPONSE = 64 * 1024, MAX_COVER = 256 * 1024;
const options = { credentials: 'same-origin', cache: 'no-store', redirect: 'error' } as const;
const route = (scope: RadioScope, rest: string) =>
  `/api/atlas/radio/v1/workspaces/${encodeURIComponent(scope.workspaceId)}/homes/${encodeURIComponent(scope.homeId)}/${rest}`;

export function createRadioClient(transport: typeof fetch = (...args) => fetch(...args)): RadioPort {
  return {
    async read(scope, signal) {
      const response = await transport(route(scope, 'station'), { ...options, method: 'GET', headers: { Accept: 'application/json' }, signal });
      if (response.status === 404) return null;
      if (response.status === 401 || response.status === 403) throw new RadioRefused();
      if (!response.ok) throw new Error('Radio station read refused');
      const body = await response.text();
      if (body.length > MAX_RESPONSE) throw new TypeError('Radio station response unavailable');
      return decodeRadioStation(JSON.parse(body));
    },
    async cover(scope, sha256, signal) {
      if (!/^[0-9a-f]{64}$/.test(sha256)) throw new TypeError('Invalid cover digest');
      const response = await transport(route(scope, `covers/${sha256}`), { ...options, method: 'GET', headers: { Accept: 'image/jpeg, image/png' }, signal });
      const type = response.headers.get('content-type');
      if (!response.ok || (type !== 'image/jpeg' && type !== 'image/png')) throw new Error('Cover unavailable');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_COVER) throw new TypeError('Cover unavailable');
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
      if (digest !== sha256) throw new TypeError('Cover unavailable');
      return new Blob([bytes], { type });
    },
  };
}
