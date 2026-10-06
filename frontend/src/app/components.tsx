import { createContext, useContext, useState, type ReactNode } from "react";
import {
  ancestry,
  childrenOf,
  kindOf,
  pageOf,
  parentOf,
  placeCounts,
  routeHref,
  safeMediaUrl,
  safeWebUrl,
  type Page,
  type Route,
} from "./model";
import { formatDate, text } from "./copy";
import type { Attachment, Cache, Entry, Maintenance, ReadyView } from "./types";

export const RouteContext = createContext<Route>({
  page: "home",
  key: null,
  query: "",
  archived: false,
  documentId: null,
});
export function AtlasLink({
  page,
  entryKey = null,
  documentId = null,
  children,
}: {
  page: Page;
  entryKey?: string | null;
  documentId?: string | null;
  children: ReactNode;
}) {
  const route = useContext(RouteContext);
  return (
    <a
      href={routeHref(page, entryKey, { archived: route.archived, documentId })}
      data-focus-id={page + (entryKey ?? "") + (documentId ?? "")}
      aria-current={
        page === route.page && entryKey === route.key ? "page" : undefined
      }
    >
      {children}
    </a>
  );
}
export function Heading({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h1 id="page-heading" tabIndex={-1} className={className}>
      {children}
    </h1>
  );
}
export const Empty = ({ children }: { children: ReactNode }) => (
  <p className="empty">{children}</p>
);
export function BrandMark() {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="bm-plate" x="2" y="6" width="44" height="36" rx="7" />
      <rect className="bm-line" x="6" y="10" width="36" height="28" rx="4" />
      <path className="bm-door" d="M19 34V22a5 5 0 0 1 10 0v12z" />
      <circle className="bm-hole" cx="11" cy="24" r="1.8" />
      <circle className="bm-hole" cx="37" cy="24" r="1.8" />
    </svg>
  );
}
export function Glyph({ entry }: { entry: Entry }) {
  const kind =
    entry.kind === "place"
      ? entry.semanticKind === "unclassified"
        ? "place"
        : entry.semanticKind
      : entry.kind;
  return (
    <span className={`glyph glyph-${kind}`} aria-hidden="true">
      <svg viewBox="0 0 48 48" focusable="false">
        {kind === "room" ? (
          <>
            <path d="M13 43V21a11 11 0 0 1 22 0v22z" />
            <circle className="knob" cx="30" cy="31" r="2.4" />
          </>
        ) : kind === "floor" ? (
          <path d="M6 42v-8h9v-8h9v-8h9v-8h9v32z" />
        ) : kind === "building" ? (
          <>
            <path d="M24 6 5 22h5v20h28V22h5z" />
            <rect
              className="knob"
              x="20"
              y="29"
              width="8"
              height="13"
              rx="1.5"
            />
          </>
        ) : kind === "container" ? (
          <>
            <rect x="6" y="9" width="36" height="9" rx="2.5" />
            <path d="M9 20h30v18a4 4 0 0 1-4 4H13a4 4 0 0 1-4-4z" />
            <rect className="knob" x="18" y="25" width="12" height="4" rx="2" />
          </>
        ) : kind === "item" ? (
          <>
            <path d="M8 13a5 5 0 0 1 5-5h13l15 15a3 3 0 0 1 0 4L27 41a3 3 0 0 1-4 0L8 26z" />
            <circle className="knob" cx="16" cy="16" r="3.2" />
          </>
        ) : kind === "unknown" ? (
          <circle
            cx="24"
            cy="24"
            r="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeDasharray="6 5"
          />
        ) : (
          <>
            <circle cx="24" cy="24" r="16" />
            <rect
              className="knob"
              x="17"
              y="17"
              width="14"
              height="14"
              rx="3"
            />
          </>
        )}
      </svg>
    </span>
  );
}
export function placement(view: ReadyView, entry: Entry): string {
  if (parentOf(view, entry))
    return ancestry(view, entry)
      .map((a) => a.entity.name)
      .join(" › ");
  return text(
    entry.entity.parent
      ? "missingParent"
      : entry.mobility === "mobile"
        ? "mobile"
        : entry.kind === "place"
          ? "root"
          : "missingPlace",
  );
}
export function RecordStatus({ entry }: { entry: Entry }) {
  return (
    <>
      {entry.entity.archived && (
        <span className="badge">{text("archived")}</span>
      )}
      {entry.sourceState !== "present" && (
        <p className="warning">
          {text(
            entry.sourceState === "unresolved"
              ? "unresolved"
              : entry.sourceState === "confirmed-deleted"
                ? "deleted"
                : "review",
          )}
        </p>
      )}
    </>
  );
}
export function Plate({
  entry,
  inset = false,
  children,
}: {
  entry: Entry;
  inset?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`plate${inset ? " plate-inset" : ""}`}>
      <p className="plate-kind">
        <span>{text(kindOf(entry))}</span>
        {entry.entity.entityType?.name && (
          <span className="plate-type">{entry.entity.entityType.name}</span>
        )}
      </p>
      {children}
    </div>
  );
}
export function EntryCard({
  entry,
  view,
  archived,
  level = 3,
}: {
  entry: Entry;
  view: ReadyView;
  archived: boolean;
  level?: 2 | 3;
}) {
  const Title = level === 2 ? "h2" : "h3";
  const title = (
    <AtlasLink page={pageOf(entry)} entryKey={entry.key}>
      {entry.entity.name}
    </AtlasLink>
  );
  const counts =
    entry.kind === "place" ? placeCounts(view, entry, archived) : null;
  return (
    <div
      className={`entry is-${entry.kind === "place" ? "place" : "item"} kind-${entry.kind}`}
    >
      {counts ? (
        <Plate entry={entry} inset={parentOf(view, entry)?.kind === "place"}>
          <Title className="plate-name">{title}</Title>
        </Plate>
      ) : (
        <Glyph entry={entry} />
      )}
      <div className="entry-body">
        {!counts && (
          <>
            <p className="entry-meta">
              <span>{text(kindOf(entry))}</span>
              {entry.entity.entityType?.name && (
                <span className="entry-type">
                  {entry.entity.entityType.name}
                </span>
              )}
            </p>
            <Title className="entry-name">{title}</Title>
          </>
        )}
        <p className="muted">{placement(view, entry)}</p>
        {counts && (
          <p className="count">
            {text("counts", counts.direct, counts.nested)}
          </p>
        )}
        {!counts && entry.entity.modelNumber && (
          <p className="model">
            {text("model")}: {entry.entity.modelNumber}
          </p>
        )}
        <RecordStatus entry={entry} />
      </div>
    </div>
  );
}
export function EntryList({
  entries,
  view,
  archived,
  plates = false,
  level = 3,
}: {
  entries: Entry[];
  view: ReadyView;
  archived: boolean;
  plates?: boolean;
  level?: 2 | 3;
}) {
  return (
    <ul className={plates ? "plate-list" : "row-list"}>
      {entries.map((entry) => (
        <li key={entry.key}>
          <EntryCard
            entry={entry}
            view={view}
            archived={archived}
            level={level}
          />
        </li>
      ))}
    </ul>
  );
}
export function PlaceTree({
  entry,
  view,
  archived,
  full,
  seen = new Set<string>(),
  depth = 1,
}: {
  entry: Entry;
  view: ReadyView;
  archived: boolean;
  full: boolean;
  seen?: Set<string>;
  depth?: number;
}) {
  const visited = new Set([...seen, entry.key]);
  const children = childrenOf(view, entry, archived)
    .filter((p) => !visited.has(p.key))
    .sort((a, b) => Number(b.kind === "place") - Number(a.kind === "place"));
  const shown = full ? children : children.slice(0, 5);
  if (!shown.length) return null;
  return (
    <ul className="tree">
      {shown.map((child) => (
        <li
          className={`tree-${child.kind === "place" ? "place" : "item"}`}
          key={child.key}
        >
          <Glyph entry={child} />
          <span className="tree-label">
            <AtlasLink page={pageOf(child)} entryKey={child.key}>
              {child.entity.name}
            </AtlasLink>
            {child.entity.archived && (
              <span className="flag">{text("archived")}</span>
            )}
            {child.sourceState !== "present" && (
              <span className="flag flag-review">{text("review")}</span>
            )}
          </span>
          {full && depth < 8 && (
            <PlaceTree
              entry={child}
              view={view}
              archived={archived}
              full
              seen={visited}
              depth={depth + 1}
            />
          )}
        </li>
      ))}
      {children.length > shown.length && (
        <li className="tree-more">and {children.length - shown.length} more</li>
      )}
    </ul>
  );
}
export function CacheState({
  cache,
  inline = false,
}: {
  cache?: Cache;
  inline?: boolean;
}) {
  const status =
    cache?.status === "access-revoked"
      ? "access-revoked"
      : (cache?.displayStatus ?? "empty");
  const message =
    status === "access-revoked"
      ? text(cache?.owner === "network" ? "networkDenied" : "sourceDenied")
      : status === "error"
        ? cache?.lastSuccessfulFetchAt
          ? text("unavailable", formatDate(cache.lastSuccessfulFetchAt))
          : text("noCache")
        : status === "stale"
          ? text("stale", formatDate(cache?.lastSuccessfulFetchAt))
          : status === "empty"
            ? text("emptySource")
            : `${text("success")}: ${formatDate(cache?.lastSuccessfulFetchAt)}`;
  return (
    <div
      className={`source-state ${status === "fresh" ? "fresh" : "warning"}${inline ? " compact" : ""}`}
    >
      <p>{message}</p>
      {!inline && ["error", "stale"].includes(status) && (
        <p className="source-note">{text("cacheNote")}</p>
      )}
    </div>
  );
}
function ExternalLink({
  href,
  download = false,
  children,
}: {
  href: string;
  download?: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      download={download || undefined}
      target={download ? undefined : "_blank"}
      rel={download ? undefined : "noopener noreferrer"}
    >
      {children}
    </a>
  );
}
export function Documents({
  attachments,
  place,
}: {
  attachments: Attachment[];
  place: boolean;
}) {
  if (!attachments.length)
    return (
      <Empty>{text(place ? "emptyPlaceDocuments" : "emptyDocuments")}</Empty>
    );
  return (
    <ul className="document-list">
      {attachments.map((a) => {
        const web = a.kind === "external-link" ? safeWebUrl(a.url) : null;
        const stored =
          a.kind === "stored-file" ? safeMediaUrl(a.downloadHref) : null;
        const type =
          a.kind === "stored-file"
            ? a.contentType || text("unknownFormat")
            : text("external");
        return (
          <li
            key={a.attachmentId}
            id={`doc-${a.attachmentId}`}
            className={web ? "doc-web" : stored ? "doc-file" : "doc-missing"}
          >
            <h3 id={`doc-heading-${a.attachmentId}`} tabIndex={-1}>
              {a.title || type}
            </h3>
            <p className="doc-kind">
              <span>
                {a.kind === "external-link"
                  ? a.archived
                    ? "External website · archived in HomeBox"
                    : text("external")
                  : text("storedFile")}
              </span>
              {a.kind === "stored-file" && <span>{type}</span>}
            </p>
            {web ? (
              <>
                <p className="destination">{new URL(web).hostname}</p>
                <ExternalLink href={web}>{text("externalOpen")}</ExternalLink>
              </>
            ) : stored ? (
              <ExternalLink href={stored} download>
                {text("download")}
              </ExternalLink>
            ) : (
              <p className="warning">
                {text(
                  a.kind === "external-link"
                    ? "unavailableLinkReference"
                    : "unavailableReference",
                )}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
export function MaintenanceLog({
  entries,
  place,
}: {
  entries: Maintenance[];
  place: boolean;
}) {
  if (!entries.length)
    return (
      <Empty>
        {text(place ? "emptyPlaceMaintenance" : "emptyMaintenance")}
      </Empty>
    );
  return (
    <>
      {(["scheduled", "completed"] as const).map((group) => {
        const selected = entries.filter((e) =>
          group === "completed" ? !!e.completedDate : !e.completedDate,
        );
        return selected.length ? (
          <div key={group}>
            <h3 className="log-title">{text(group)}</h3>
            <ul className={`log log-${group}`}>
              {selected.map((m) => (
                <li key={m.entryId}>
                  <h4>{m.name}</h4>
                  <p className="log-date">
                    {m.completedDate
                      ? text("done", formatDate(m.completedDate))
                      : m.scheduledDate
                        ? text("due", formatDate(m.scheduledDate))
                        : text("unscheduled")}
                  </p>
                  {m.description && <p>{m.description}</p>}
                  {m.cost !== null && (
                    <p className="log-cost">
                      {text("cost")}: {m.cost}{" "}
                      <span className="muted">({text("currencyUnknown")})</span>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null;
      })}
    </>
  );
}
function Photo({
  attachment,
  entry,
}: {
  attachment: Extract<Attachment, { kind: "stored-file" }>;
  entry: Entry;
}) {
  const [failed, setFailed] = useState(false);
  const preview = safeMediaUrl(attachment.previewHref);
  return (
    <figure>
      {preview && !failed ? (
        <>
          <img
            src={preview}
            alt={text("photoAlt", entry.entity.name, attachment.title ?? "")}
            width={640}
            height={400}
            onError={() => setFailed(true)}
          />
          <figcaption>{attachment.title}</figcaption>
        </>
      ) : (
        <div className="photo-placeholder">
          <p className="photo-title">{attachment.title}</p>
          <p>
            {text(
              entry.kind === "place"
                ? "placeFileUnavailable"
                : "fileUnavailable",
            )}
          </p>
        </div>
      )}
    </figure>
  );
}
export function Resources({ entry }: { entry: Entry }) {
  const photos = entry.attachments.filter(
    (a): a is Extract<Attachment, { kind: "stored-file" }> =>
      a.kind === "stored-file" &&
      ["image/png", "image/jpeg", "image/webp"].includes(a.contentType ?? ""),
  );
  const place = entry.kind === "place";
  return (
    <>
      <section className="photos-section">
        <h2>{text("photo")}</h2>
        {photos.length ? (
          <div className="photos">
            {photos.map((a) => (
              <Photo
                key={a.attachmentId + (a.previewHref ?? "")}
                attachment={a}
                entry={entry}
              />
            ))}
          </div>
        ) : (
          <Empty>{text(place ? "noPlacePhotos" : "noPhotos")}</Empty>
        )}
      </section>
      <section id="documents">
        <h2>{text("documents")}</h2>
        <Documents attachments={entry.attachments} place={place} />
      </section>
      <section>
        <h2>{text("maintenance")}</h2>
        <MaintenanceLog entries={entry.maintenance} place={place} />
      </section>
      <Network entry={entry} />
    </>
  );
}
function Network({ entry }: { entry: Entry }) {
  if (!entry.networkBound && !entry.networkRelations.length) return null;
  const states = entry.networkStates;
  const notice =
    !states.length || states.some((s) => ["empty", "error"].includes(s))
      ? text("networkUnavailable")
      : states.includes("stale")
        ? text("networkSaved")
        : "";
  return (
    <section className="network">
      <h2>{text("network")}</h2>
      {notice && <p className="warning">{notice}</p>}
      <p className="muted">{text("networkIndependent")}</p>
      {entry.networkRelations.map((n, i) => (
        <details key={i}>
          <summary>
            {text(
              n.kind === "network-segment-membership"
                ? "membership"
                : n.temporalStatus === "current-claim"
                  ? "connection"
                  : "historical",
            )}
          </summary>
          <dl>
            <dt>{text("revision")}</dt>
            <dd>{n.sourceRevision ?? text("unknown")}</dd>
            <dt>{text("sourceConfidence")}</dt>
            <dd>{n.sourceConfidence ?? text("unknown")}</dd>
            <dt>{text("evidenceBasis")}</dt>
            <dd>{n.evidenceBasis ?? text("unknown")}</dd>
            <dt>{text("factAt")}</dt>
            <dd>{formatDate(n.factAt)}</dd>
            <dt>{text("retrieved")}</dt>
            <dd>{formatDate(n.retrievedAt)}</dd>
            <dt>{text("snapshot")}</dt>
            <dd>{formatDate(n.sourceSnapshotAt)}</dd>
            <dt>{text("vantage")}</dt>
            <dd>{n.vantage ?? text("unknown")}</dd>
          </dl>
          {n.notes && <p>{n.notes}</p>}
        </details>
      ))}
    </section>
  );
}
