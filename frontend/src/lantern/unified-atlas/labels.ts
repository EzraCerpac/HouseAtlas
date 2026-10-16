/** Display names only. Source labels and all identity joins remain unchanged. */
export function floorLabel(source: string): string {
  const names: Record<string, string> = { ground: 'Ground Floor', intermediate: 'Tussenfloor', upper: 'Upper Floor', attic: 'Attic' };
  return names[source.toLowerCase()] ?? source;
}
