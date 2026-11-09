import { createRoot } from 'react-dom/client';
import { SuggestionReview } from '../suggestion-review/SuggestionReview';
import type { SuggestionReviewSession } from './session';

const roots = new WeakMap<HTMLElement, () => void>();
/** Explicit owner mount only: no default route, discovery, inference or app-root
 * modification. Retain the session above navigation; unmounting does not reset
 * its once-consumed intent. Real session retirement unmounts every owned view. */
export function mountSuggestionReview(container: HTMLElement, session: SuggestionReviewSession): () => void {
  if (session.retired || roots.has(container) || container.childNodes.length)
    throw new TypeError('Suggestion review requires an empty owned container and current session');
  const root = createRoot(container);
  let mounted = true, unsubscribe = () => {};
  const unmount = () => {
    if (!mounted) return; mounted = false; roots.delete(container); unsubscribe(); root.unmount();
  };
  roots.set(container, unmount);
  try {
    root.render(<SuggestionReview controller={session.controller} />);
    unsubscribe = session.onRetire(unmount);
  } catch (error) { unmount(); throw error; }
  return unmount;
}
