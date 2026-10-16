import { lazy } from 'react';

/** Mount entries for the eventual host integration. The viewer, adapter,
 * renderer and styles load as separate chunks; the main bundle carries only
 * these lazy references. */
export const LazyCanonicalModelViewer = lazy(() => import('./CanonicalModelViewer').then(module => ({ default: module.CanonicalModelViewer })));
export const LazyCanonicalSceneViewer = lazy(() => import('./CanonicalSceneViewer').then(module => ({ default: module.CanonicalSceneViewer })));
export const LazyLocalGlbPreview = lazy(() => import('./LocalGlbPreview').then(module => ({ default: module.LocalGlbPreview })));
export type { CanonicalModelViewerProps } from './CanonicalModelViewer';
export type { CanonicalSceneViewerProps } from './CanonicalSceneViewer';
export type { CanonicalScenePort, SceneRequest } from './adapter';
export type { CanonicalPresentation, OverlayLayer } from './model';
export type { ViewerMemoryPort } from './selection';
