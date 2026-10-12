export function pdfjsBinaryDataPlugin(frontendRoot: string): {
  name: string;
  resolveId(id: string): string | null;
  load(id: string): string | null;
};
