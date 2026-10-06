import { StrictMode, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { healthyHistory, healthySnapshot } from './healthy-contracts';

// Keep healthy generated-contract consumers in the production compilation path.
export { healthyHistory, healthySnapshot };

// This empty component verifies strict TSX compilation without defining a UI.
export function ReactCompileBaseline(): ReactElement {
  return <StrictMode />;
}

// Export the constructor without mounting anything during the build or import.
export function createBaselineRoot(container: Element | DocumentFragment): Root {
  return createRoot(container);
}
