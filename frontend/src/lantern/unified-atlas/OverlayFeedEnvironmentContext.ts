import { createContext } from 'react';
import type { OverlayFeedEnvironment } from './overlay-feed';

export const OverlayFeedEnvironmentContext = createContext<OverlayFeedEnvironment | undefined>(undefined);
