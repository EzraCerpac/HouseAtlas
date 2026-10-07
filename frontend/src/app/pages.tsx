import {
  ancestry,
  childrenOf,
  nativeLink,
  pageOf,
  parentOf,
  placeCounts,
  searchEntries,
  visibleEntries,
  type Route,
} from "./model";
import { formatDate, text } from "./copy";
import {
  AtlasLink,
  CacheState,
  Documents,
  Empty,
  EntryCard,
  EntryList,
  Glyph,
  Heading,
  MaintenanceLog,
  Plate,
  PlaceTree,
  RecordStatus,
  Resources,
  placement,
} from "./components";
import type { Entry, ReadyView, Scope } from "./types";
import type { SessionSettings } from "./session";

export interface PageProps {
  view: ReadyView;
  route: Route;
  busy: boolean;
  switchHome: (scope: Scope) => void;
  session?: SessionSettings;
}
export function AtlasPage({
  view,
  route,
  busy,
  switchHome,
  session,
}: PageProps) {
  const entries = visibleEntries(view, route.archived),
    places = entries.filter((p) => p.kind === "place");
  const caches = view.caches.filter((c) => c.owner === "homebox");
  const saved = caches.some(
    (c) => c.status !== "access-revoked" && c.lastSuccessfulFetchAt,
  );
  if (route.page === "settings")
    return (
      <>
        <Heading>{text("settings")}</Heading>
        <div className="settings-list">
          <section className="setting">
            <div className="setting-text">
              <h2>{text("homeSelect")}</h2>
            </div>
            <select
              aria-label={text("homeSelect")}
              value={view.scope.homeId}
              disabled={busy || view.homes.length < 2}
              onChange={(event) => {
                const next = view.homes.find(
                  (h) => h.homeId === event.target.value,
                );
                if (next) switchHome(next);
              }}
            >
              {view.homes.map((h) => (
                <option key={h.homeId} value={h.homeId}>
                  {h.label}
                </option>
              ))}
            </select>
          </section>
          <section className="setting">
            <div className="setting-text">
              <h2>{text("saved")}</h2>
            </div>
            <div className="setting-sources">
              {caches.length ? (
                caches.map((c, i) => <CacheState key={i} cache={c} inline />)
              ) : (
                <CacheState inline />
              )}
            </div>
          </section>
          {session && (
            <section className="setting">
              <div className="setting-text">
                <h2>Session</h2>
                <p className="muted">
                  Expires{" "}
                  <time dateTime={session.expiresAt}>
                    {new Date(session.expiresAt).toLocaleString("en-GB", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZoneName: "short",
                    })}
                  </time>
                </p>
              </div>
              {session.signOut && (
                <button type="button" onClick={session.signOut}>
                  Sign out
                </button>
              )}
            </section>
          )}
        </div>
      </>
    );
  if (!saved)
    return (
      <>
        <Heading>{text("home")}</Heading>
        {caches.length ? (
          caches.map((c, i) => <CacheState key={i} cache={c} />)
        ) : (
          <CacheState />
        )}
      </>
    );
  if (route.page === "place" || route.page === "item") {
    const entry = entries.find((p) => p.key === route.key);
    return entry ? (
      <Detail entry={entry} view={view} archived={route.archived} />
    ) : (
      <>
        <Heading>{text("notFound")}</Heading>
        {view.entries.some((p) => p.key === route.key && p.entity.archived) && (
          <Empty>{text("archivedHidden")}</Empty>
        )}
      </>
    );
  }
  if (route.page === "search") {
    const matches = searchEntries(view, route.query, route.archived);
    return (
      <>
        <Heading>{text("searchTitle")}</Heading>
        <p className="result-count" role="status">
          {matches.length
            ? text("results", matches.length)
            : text("noResults", route.query)}
        </p>
        <ol className="results">
          {matches.map(({ entry, documents }) => (
            <li className="result" key={entry.key}>
              <EntryCard
                entry={entry}
                view={view}
                archived={route.archived}
                level={2}
              />
              {documents.length > 0 && (
                <div className="search-documents">
                  <p>{text("docOwner", entry.entity.name)}</p>
                  <ul className="doc-links">
                    {documents.map((a) => (
                      <li key={a.attachmentId}>
                        <AtlasLink
                          page={pageOf(entry)}
                          entryKey={entry.key}
                          documentId={a.attachmentId}
                        >
                          {a.title ||
                            (a.kind === "stored-file" ? a.contentType : null) ||
                            text("unknownFormat")}
                        </AtlasLink>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ol>
        <p className="clear-search">
          <AtlasLink page="home">{text("clear")}</AtlasLink>
        </p>
      </>
    );
  }
  if (route.page === "documents" || route.page === "maintenance") {
    const documents = route.page === "documents";
    const owners = entries.filter((p) =>
      documents ? p.attachments.length : p.maintenance.length,
    );
    return (
      <>
        <Heading>{text(route.page)}</Heading>
        {owners.length ? (
          owners.map((p) => (
            <section className="owner" key={p.key}>
              <div className="owner-head">
                <Glyph entry={p} />
                <div>
                  <h2>
                    <AtlasLink page={pageOf(p)} entryKey={p.key}>
                      {p.entity.name}
                    </AtlasLink>
                  </h2>
                  <p className="muted">{placement(view, p)}</p>
                </div>
              </div>
              {documents ? (
                <Documents
                  attachments={p.attachments}
                  place={p.kind === "place"}
                />
              ) : (
                <MaintenanceLog
                  entries={p.maintenance}
                  place={p.kind === "place"}
                />
              )}
            </section>
          ))
        ) : (
          <Empty>
            {text(documents ? "noIndexDocuments" : "noIndexMaintenance")}
          </Empty>
        )}
      </>
    );
  }
  const unplaced = entries.filter(
    (p) => p.kind === "item" && !parentOf(view, p),
  );
  if (route.page === "unplaced")
    return (
      <>
        <Heading>{text("unplaced")}</Heading>
        {unplaced.length ? (
          <EntryList
            entries={unplaced}
            view={view}
            archived={route.archived}
            level={2}
          />
        ) : (
          <Empty>{text("emptyUnplaced")}</Empty>
        )}
      </>
    );
  const home = route.page === "home",
    roots = places.filter((p) => parentOf(view, p)?.kind !== "place"),
    unknown = entries.filter((p) => p.kind === "unknown");
  const sources = caches.map((c, i) => <CacheState key={i} cache={c} />);
  return (
    <>
      {home ? (
        <div className="opening">
          <Heading>{text("home")}</Heading>
          <ul className="tally" aria-label="In this view">
            <li>
              <strong>{places.length}</strong> Places
            </li>
            <li>
              <strong>{entries.filter((p) => p.kind === "item").length}</strong>{" "}
              Items
            </li>
            <li>
              <strong>
                {entries.reduce((count, p) => count + p.attachments.length, 0)}
              </strong>{" "}
              {text("documents")}
            </li>
            <li>
              <strong>
                {entries.reduce((count, p) => count + p.maintenance.length, 0)}
              </strong>{" "}
              {text("maintenance")}
            </li>
          </ul>
          <div className="opening-sources">{sources}</div>
        </div>
      ) : (
        <>
          <Heading>{text("places")}</Heading>
          {sources}
        </>
      )}
      <section className={home ? "rooms" : "rooms rooms-all"}>
        {home && <h2>{text("places")}</h2>}
        {roots.length ? (
          <ul className="room-grid">
            {roots.map((p) => {
              const counts = placeCounts(view, p, route.archived),
                Title = home ? "h3" : "h2";
              return (
                <li className={`room kind-${p.semanticKind}`} key={p.key}>
                  <Plate entry={p}>
                    <Title className="plate-name">
                      <AtlasLink page="place" entryKey={p.key}>
                        {p.entity.name}
                      </AtlasLink>
                    </Title>
                  </Plate>
                  <p className="muted">{placement(view, p)}</p>
                  <p className="count">
                    {text("counts", counts.direct, counts.nested)}
                  </p>
                  <RecordStatus entry={p} />
                  <PlaceTree
                    entry={p}
                    view={view}
                    archived={route.archived}
                    full={!home}
                  />
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>{text("emptyPlaces")}</Empty>
        )}
      </section>
      {home && (
        <section className="unplaced-preview">
          <h2>
            <AtlasLink page="unplaced">{text("unplaced")}</AtlasLink>
          </h2>
          {unplaced.length ? (
            <EntryList
              entries={unplaced}
              view={view}
              archived={route.archived}
            />
          ) : (
            <Empty>{text("emptyUnplaced")}</Empty>
          )}
        </section>
      )}
      {unknown.length > 0 && (
        <section>
          <h2>{text("unknownRecords")}</h2>
          <EntryList entries={unknown} view={view} archived={route.archived} />
        </section>
      )}
      {!roots.length && (
        <p>{text(view.canEdit ? "editorHelp" : "readerHelp")}</p>
      )}
    </>
  );
}
function Detail({
  entry,
  view,
  archived,
}: {
  entry: Entry;
  view: ReadyView;
  archived: boolean;
}) {
  const chain = ancestry(view, entry),
    place = entry.kind === "place";
  const cache = view.caches.find(
    (c) =>
      c.sourceInstanceId === entry.source.sourceInstanceId &&
      c.collectionId === entry.source.collectionId,
  );
  const edit = nativeLink(entry, "edit", view.canEdit),
    maintenance = nativeLink(entry, "maintenance", view.canEdit);
  const children = childrenOf(view, entry, archived);
  const childPlaces = children.filter((p) => p.kind === "place"),
    direct = children.filter((p) => p.kind !== "place");
  const nested = visibleEntries(view, archived).filter(
    (p) =>
      p.kind === "item" &&
      parentOf(view, p)?.key !== entry.key &&
      ancestry(view, p).some((a) => a.key === entry.key),
  );
  return (
    <>
      <nav className="breadcrumbs" aria-label={text("location")}>
        <AtlasLink page="home">{text("home")}</AtlasLink>
        {chain.map((a) => (
          <span key={a.key}>
            <span className="crumb-sep" aria-hidden="true">
              ›
            </span>
            <AtlasLink page={pageOf(a)} entryKey={a.key}>
              {a.entity.name}
            </AtlasLink>
          </span>
        ))}
      </nav>
      {place ? (
        <div className="record-head place-head">
          <Plate entry={entry} inset={parentOf(view, entry)?.kind === "place"}>
            <Heading className="plate-name">{entry.entity.name}</Heading>
          </Plate>
        </div>
      ) : (
        <div className={`record-head item-head kind-${entry.kind}`}>
          <Glyph entry={entry} />
          <div className="record-title">
            <p className="entry-meta">
              <span>
                {text(entry.kind === "unknown" ? "unknownType" : "item")}
              </span>
              {entry.entity.entityType && (
                <span className="entry-type">
                  {entry.entity.entityType.name}
                </span>
              )}
            </p>
            <Heading>{entry.entity.name}</Heading>
          </div>
        </div>
      )}
      {entry.entity.description && (
        <p className="lead">{entry.entity.description}</p>
      )}
      <RecordStatus entry={entry} />
      {cache && <CacheState cache={cache} inline />}
      {view.canEdit && (
        <div className="actions">
          {edit ? (
            <a href={edit} target="_blank" rel="noopener noreferrer">
              {text("edit")}
            </a>
          ) : (
            <span className="muted">{text("linkUnavailable")}</span>
          )}
          {maintenance && (
            <a href={maintenance} target="_blank" rel="noopener noreferrer">
              {text("maintenanceEdit")}
            </a>
          )}
        </div>
      )}
      {place ? (
        <>
          <section>
            <h2>{text("childPlaces")}</h2>
            {childPlaces.length ? (
              <EntryList
                entries={childPlaces}
                view={view}
                archived={archived}
                plates
              />
            ) : (
              <Empty>{text("emptyPlaces")}</Empty>
            )}
          </section>
          <section>
            <h2>{text("directItems")}</h2>
            {direct.length ? (
              <EntryList entries={direct} view={view} archived={archived} />
            ) : (
              <Empty>{text("emptyItems")}</Empty>
            )}
          </section>
          {nested.length > 0 && (
            <section>
              <h2>{text("nestedItems")}</h2>
              <EntryList entries={nested} view={view} archived={archived} />
            </section>
          )}
        </>
      ) : (
        <>
          <section className="whereabouts">
            <h2>{text("location")}</h2>
            {chain.length ? (
              <ol className="address">
                {[...chain, entry].map((a, i) => (
                  <li
                    className={`step-${Math.min(i, 6)}${i === 0 && a.kind === "place" ? " address-room" : ""}${a.key === entry.key ? " address-here" : ""}`}
                    key={a.key}
                  >
                    <Glyph entry={a} />
                    <span>{a.entity.name}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p
                className={`where-note${entry.mobility === "mobile" && !entry.entity.parent ? "" : " warning"}`}
              >
                {placement(view, entry)}
              </p>
            )}
          </section>
          <dl className="rating-plate">
            {(
              [
                "manufacturer",
                "modelNumber",
                "serialNumber",
                "quantity",
                "notes",
              ] as const
            ).map((field) => {
              const value = entry.entity[field],
                missing = value === null || value === "";
              return (
                <div
                  key={field}
                  className={`spec spec-${field}${missing ? " is-unknown" : ""}`}
                >
                  <dt>
                    {text(
                      field === "modelNumber"
                        ? "model"
                        : field === "serialNumber"
                          ? "serial"
                          : field,
                    )}
                  </dt>
                  <dd>{missing ? text("unknown") : value}</dd>
                </div>
              );
            })}
          </dl>
        </>
      )}
      <Resources entry={entry} />
      <details className="source-details">
        <summary>{text("details")}</summary>
        <dl>
          <dt>{text("success")}</dt>
          <dd>{formatDate(cache?.lastSuccessfulFetchAt)}</dd>
          <dt>{text("sourceUpdated")}</dt>
          <dd>{formatDate(entry.sourceUpdatedAt)}</dd>
          <dt>{text("retrieved")}</dt>
          <dd>{formatDate(entry.retrievedAt)}</dd>
        </dl>
      </details>
    </>
  );
}
