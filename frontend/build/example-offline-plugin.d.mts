import type { Plugin } from 'vite';
export const EXAMPLE_WORKER: string;
export interface ExampleWorkerPin { path: string; bytes: number; sha256: string; mime: string }
export function writeExampleWorker(outDir: string, base?: string): ExampleWorkerPin[];
export function exampleOfflinePlugin(): Plugin;
