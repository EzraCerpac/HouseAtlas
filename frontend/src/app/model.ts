import type { Entry, ReadyView, Scope, SourceKey } from "./types";

export const pages = [
  "home",
  "places",
  "place",
  "item",
  "documents",
  "maintenance",
  "unplaced",
  "search",
  "settings",
] as const;
export type Page = (typeof pages)[number];
export interface Route {
  page: Page;
  key: string | null;
  query: string;
  archived: boolean;
  documentId: string | null;
}
export function parseRoute(hash: string): Route {
  const [page = "home", search = ""] = hash.replace(/^#/, "").split("?");
  const params = new URLSearchParams(search);
  return {
    page: pages.find((p) => p === page) ?? "home",
    key: params.get("key"),
    query: (params.get("q") ?? "").slice(0, 512),
    archived: params.get("archived") === "1",
    documentId: params.get("document"),
  };
}
export function routeHref(
  page: Page,
  key: string | null = null,
  options: Partial<Route> = {},
): string {
  const params = new URLSearchParams();
  if (key !== null) params.set("key", key);
  if (options.query) params.set("q", options.query);
  if (options.archived) params.set("archived", "1");
  if (options.documentId) params.set("document", options.documentId);
  return `#${page}${params.size ? "?" + params.toString() : ""}`;
}
export const sameScope = (a: Scope, b: Scope): boolean =>
  a.workspaceId === b.workspaceId && a.homeId === b.homeId;
export const sourceKey = (source: SourceKey): string =>
  JSON.stringify([
    source.sourceInstanceId,
    source.collectionId,
    source.sourceKind,
    source.externalId,
  ]);
export const visibleEntries = (view: ReadyView, archived: boolean): Entry[] =>
  view.entries.filter((p) => archived || !p.entity.archived);
export const parentOf = (view: ReadyView, p: Entry): Entry | undefined =>
  p.entity.parent
    ? view.entries.find(
        (candidate) =>
          sameScope(candidate, p) &&
          candidate.source.sourceInstanceId === p.source.sourceInstanceId &&
          candidate.source.collectionId === p.source.collectionId &&
          candidate.entity.id === p.entity.parent?.id,
      )
    : undefined;
export function ancestry(view: ReadyView, p: Entry): Entry[] {
  const path: Entry[] = [],
    visited = new Set([p.key]);
  let next = parentOf(view, p);
  while (next && !visited.has(next.key)) {
    path.unshift(next);
    visited.add(next.key);
    next = parentOf(view, next);
  }
  return path;
}
export const childrenOf = (
  view: ReadyView,
  p: Entry,
  archived: boolean,
): Entry[] =>
  visibleEntries(view, archived).filter(
    (candidate) => parentOf(view, candidate)?.key === p.key,
  );
export function placeCounts(
  view: ReadyView,
  p: Entry,
  archived: boolean,
): { direct: number; nested: number } {
  const children = childrenOf(view, p, archived),
    visited = new Set([p.key]);
  let nested = 0;
  const visit = (entry: Entry): void => {
    if (visited.has(entry.key)) return;
    visited.add(entry.key);
    for (const child of childrenOf(view, entry, archived)) {
      if (child.kind === "item") nested++;
      visit(child);
    }
  };
  for (const child of children) if (child.kind !== "item") visit(child);
  return { direct: children.filter((e) => e.kind === "item").length, nested };
}
export function safeWebUrl(
  value: string | null,
  native = false,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      (native && (url.search || url.hash))
    )
      return null;
    if (
      [...url.searchParams.keys()].some((key) =>
        /token|key|secret|password|authorization|credential/i.test(key),
      )
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
export const safeMediaUrl = (value: string | null): string | null =>
  value &&
  /^\/api\/atlas\/media\/[A-Za-z0-9_/-]+$/.test(value) &&
  !value.includes("..")
    ? value
    : null;
export function nativeLink(
  entry: Entry,
  intent: "edit" | "maintenance",
  canEdit: boolean,
): string | null {
  if (
    !canEdit ||
    entry.sourceState !== "present" ||
    entry.cacheStatus !== "fresh"
  )
    return null;
  const link = entry.nativeLinks.find(
    (l) =>
      l.intent === intent &&
      l.verifiedRoute &&
      sameScope(l.entity, entry) &&
      sourceKey(l.entity.key) === entry.key,
  );
  return link ? safeWebUrl(link.href, true) : null;
}
export const pageOf = (p: Entry): "place" | "item" =>
  p.kind === "place" ? "place" : "item";
export const kindOf = (p: Entry) =>
  p.kind === "place"
    ? p.semanticKind === "unclassified"
      ? "place"
      : p.semanticKind
    : p.kind === "unknown"
      ? "unknownType"
      : "item";
export function searchEntries(
  view: ReadyView,
  query: string,
  archived: boolean,
) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const matches = (values: (string | null | undefined)[]): boolean => {
    const joined = values.join(" ").toLocaleLowerCase();
    return words.every((word) => joined.includes(word));
  };
  return visibleEntries(view, archived).flatMap((entry) => {
    const documents = entry.attachments.filter((a) =>
      matches([
        a.title,
        entry.entity.name,
        entry.entity.modelNumber,
        ...entry.aliases,
      ]),
    );
    return matches([
      entry.entity.name,
      entry.entity.description,
      entry.entity.manufacturer,
      entry.entity.modelNumber,
      entry.entity.entityType?.name,
      ...entry.aliases,
    ]) || documents.length
      ? [{ entry, documents }]
      : [];
  });
}
