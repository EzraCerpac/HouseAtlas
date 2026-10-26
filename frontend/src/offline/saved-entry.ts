/** Whether the Saved entry was opened on purpose from the live app (its full
 * view, with saved copies and shell removal) or reached by an offline reopen
 * (just the last Atlas). The mark lives for the tab's session and the next
 * live launch clears it. Storage failures leave the offline-reopen view. */
const KEY = 'houseatlas.saved-entry.v1';
export function markSavedEntry() { try { sessionStorage.setItem(KEY, '1'); } catch { /* the reopen view stays */ } }
export function savedEntryMarked() { try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; } }
export function forgetSavedEntry() { try { sessionStorage.removeItem(KEY); } catch { /* nothing kept */ } }
