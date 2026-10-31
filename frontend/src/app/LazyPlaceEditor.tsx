import { lazy, Suspense, type ComponentProps } from 'react';
import { OptionalViewerBoundary } from '../lantern/components/OptionalViewerBoundary';

const Editor = lazy(() => import('./PlaceEditor').then(module => ({ default: module.PlaceEditor })));
type Props = ComponentProps<typeof import('./PlaceEditor').PlaceEditor>;

/** Both native and Lantern details retain the same target keys and editor props.
 * The editor and its capture UI load only when an eligible detail mounts. */
export function PlaceEditor(props: Props) {
  return <OptionalViewerBoundary label="The Atlas editor">
    <Suspense fallback={null}><Editor {...props} /></Suspense>
  </OptionalViewerBoundary>;
}
