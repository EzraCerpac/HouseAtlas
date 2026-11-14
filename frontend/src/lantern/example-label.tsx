import { createContext, useContext } from 'react';

/** The example house's label, provided only by frontend/example; a configured
 * home never provides one. Surfaces that can cover the top bar show it so the
 * example stays labelled there too: Modal, Search, Atlas tools, the
 * short-viewport Layer details dialog and the electrical drawing viewer and
 * its pending state. */
export const ExampleLabelContext = createContext<string | null>(null);

export function ExampleLabel() {
  const label = useContext(ExampleLabelContext);
  return label === null ? null : <p className="example-label">{label}</p>;
}
