import type { AtlasSessionClient } from "./session";

/** One initial configured-home attempt owned by the mounted application root.
 * This is a dispatch fence, not authentication or a stored session. */
export interface InitialHomeBootstrap {
  consume(current: AtlasSessionClient): boolean;
  retire(): void;
}

export function createInitialHomeBootstrap(
  sessions: AtlasSessionClient,
): InitialHomeBootstrap {
  let available = true;
  return Object.freeze({
    consume(current: AtlasSessionClient) {
      const accepted = available && current === sessions;
      available = false;
      return accepted;
    },
    retire() {
      available = false;
    },
  });
}
