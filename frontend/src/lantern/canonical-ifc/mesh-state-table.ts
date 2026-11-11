/** The GPU state texture stores nine RGBA32F texels per drawn mesh instance. */
export const STATE_ROW_ENTRIES = 128;
export const STATE_TEXELS = 9;
export const STATE_FLOATS = STATE_TEXELS * 4;
export const STATE_ROW_BYTES = STATE_ROW_ENTRIES * STATE_FLOATS * 4;

/** Empty MeshLayer sets are skipped; direct scene creation allocates one row. */
export function stateTableRows(instances: number, allocateEmpty = false): number {
  if (!Number.isSafeInteger(instances) || instances < 0) throw new Error('Invalid mesh instance count');
  const rows = Math.ceil(instances / STATE_ROW_ENTRIES);
  return allocateEmpty ? Math.max(1, rows) : rows;
}

export function stateTableBytes(instances: number): number {
  const bytes = stateTableRows(instances) * STATE_ROW_BYTES;
  if (!Number.isSafeInteger(bytes)) throw new Error('Mesh state table exceeds safe accounting');
  return bytes;
}

export function addGpuBytes(...values: number[]): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(total + value)) throw new Error('Invalid GPU accounting');
    total += value;
  }
  return total;
}
