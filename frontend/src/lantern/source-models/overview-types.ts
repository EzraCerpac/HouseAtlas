/** Separate provisional overview; source IDs never claim native bindings. */
export interface ModelOverviewSelection {
  readonly owner: object;
  readonly scope: Readonly<{ workspaceId: string; homeId: string }>;
  readonly expiresAt: string;
  readonly publicationId: string;
  readonly manifestSha256: string;
}
export interface ModelOverviewAsset {
  readonly blob: Blob;
  readonly label: string;
  readonly publicationId: string;
  readonly sourceNote: string | null;
  readonly components: readonly Readonly<{ id: string; kind: 'building' | 'plot' | 'context'; label: string }>[];
}
export interface ModelOverviewPort {
  current(): ModelOverviewSelection | null;
  subscribe(changed: () => void): () => void;
  read(selection: ModelOverviewSelection, signal: AbortSignal): Promise<ModelOverviewAsset>;
}
