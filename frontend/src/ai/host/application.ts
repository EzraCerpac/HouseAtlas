import type { AtlasSessionInfo } from '../../app/session.js';
import type { Scope } from '../../app/types.js';
import type { AiHostContext } from './AiHost.js';

/** Integration port: only the real host can supply registration/epoch identity
 * and explicitly configured, scoped lifecycle endpoints. Return null while held.
 * Keep client identity stable for an unchanged full scopeKey. */
export interface AiApplicationPort {
  resolve(session: AtlasSessionInfo, scope: Scope, homeLabel: string): AiHostContext | null;
}
export type AiViewResolver = (scope: Scope, homeLabel: string) => AiHostContext | null;
