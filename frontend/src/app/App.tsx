import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { AtlasClient, AtlasView, ReadyView, Scope } from "./types";
import {
  ancestry,
  parseRoute,
  routeHref,
  sameScope,
  visibleEntries,
  type Route,
} from "./model";
import { BrandMark, Heading, RouteContext, AtlasLink } from "./components";
import { AtlasPage } from "./pages";
import { text } from "./copy";
import type { SessionSettings } from "./session";
import type { AtlasEditingClient } from "./editing";
import type { QuantityClient } from "../api/quantity-client";
import { AiHost, AiActivityStatus } from "../ai/host/index.js";
import type { AiViewResolver } from "../ai/host/index.js";

export interface AtlasContentActions {
  reload: () => Promise<boolean>;
  switchHome: (scope: Scope) => void;
  busy: boolean;
  notice: string;
  session?: SessionSettings;
  editing?: AtlasEditingClient;
  quantity?: QuantityClient;
}
export interface AtlasAppProps {
  client: AtlasClient;
  /** Optional already authorized server view; never a raw source snapshot. */
  initialView?: AtlasView;
  signIn?: () => void;
  /** Allows a host session lifecycle to immediately remove private UI. */
  accessEvents?: EventTarget;
  session?: SessionSettings;
  /** Reports only the committed authorized scope, or unavailable context. */
  onScopeCommit?: (scope: Scope | null) => void;
  editing?: AtlasEditingClient;
  quantity?: QuantityClient;
  /** Wrap content with its current authorized view during the same render. */
  renderContent?: (view: AtlasView, content: ReactNode, actions: AtlasContentActions) => ReactNode;
  resolveAi?: AiViewResolver;
}
export const accessEventName = "atlas-access-invalidated";
export function App({
  client,
  initialView,
  signIn,
  accessEvents,
  session,
  onScopeCommit,
  editing,
  quantity,
  renderContent,
  resolveAi,
}: AtlasAppProps) {
  const [view, setView] = useState<AtlasView>(
    initialView ?? { status: "loading" },
  );
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [failedHome, setFailedHome] = useState<Scope | null>(null);
  const generation = useRef(0),
    controller = useRef<AbortController | null>(null);
  const root = useRef<HTMLDivElement>(null),
    focus = useRef<string | null>(null);
  const remembered = useRef(new Map<string, string>());
  const currentView = useRef(view);
  currentView.current = view;
  useLayoutEffect(() => {
    onScopeCommit?.(view.status === "ready" ? view.scope : null);
  }, [view, onScopeCommit]);

  const read = useCallback(
    async (scope?: Scope, changeHome = false) => {
      const attempt = ++generation.current;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      const expected =
        scope ??
        (currentView.current.status === "ready"
          ? currentView.current.scope
          : undefined);
      setBusy(true);
      setNotice("");
      if (changeHome) {
        setView({ status: "loading" });
        remembered.current.clear();
      }
      try {
        const next = scope
          ? await client.loadHome(scope, abort.signal)
          : await client.load(abort.signal);
        if (attempt !== generation.current || abort.signal.aborted)
          return false;
        if (
          next.status === "ready" &&
          expected &&
          !sameScope(next.scope, expected)
        ) {
          setView({ status: "denied" });
          remembered.current.clear();
        } else {
          setView(next);
          if (next.status !== "ready") remembered.current.clear();
        }
        setFailedHome(null);
        focus.current =
          changeHome || next.status !== "ready"
            ? "page-heading"
            : "action:reload";
        return (
          next.status === "ready" &&
          (!expected || sameScope(next.scope, expected))
        );
      } catch {
        if (attempt !== generation.current || abort.signal.aborted)
          return false;
        if (changeHome || currentView.current.status !== "ready") {
          setView({ status: "unavailable" });
          setFailedHome(scope ?? null);
          focus.current = "page-heading";
        } else
          setNotice(
            "Saved information could not be reloaded. Its previous dates are unchanged.",
          );
      } finally {
        if (attempt === generation.current) setBusy(false);
      }
      return false;
    },
    [client],
  );

  useEffect(() => {
    if (!initialView) void read();
    return () => {
      generation.current++;
      controller.current?.abort();
    };
  }, [client, initialView, read]);
  useEffect(() => {
    const onRoute = () => {
      const next = parseRoute(window.location.hash);
      setRoute(next);
      setNotice("");
      focus.current =
        remembered.current.get(window.location.hash) ??
        (next.documentId ? `doc-heading-${next.documentId}` : "page-heading");
    };
    window.addEventListener("hashchange", onRoute);
    return () => window.removeEventListener("hashchange", onRoute);
  }, []);
  useEffect(() => {
    if (!accessEvents) return;
    const invalidate = (event: Event) => {
      const reason: unknown =
        event instanceof CustomEvent ? event.detail : null;
      generation.current++;
      controller.current?.abort();
      remembered.current.clear();
      setView({
        status:
          reason === "expired" || reason === "revoked" ? reason : "denied",
      });
      setBusy(false);
      setNotice("");
      setFailedHome(null);
      focus.current = "page-heading";
    };
    accessEvents.addEventListener(accessEventName, invalidate);
    return () => accessEvents.removeEventListener(accessEventName, invalidate);
  }, [accessEvents]);
  useLayoutEffect(() => {
    document.documentElement.lang = "en";
    document.title =
      view.status === "ready" ? `HouseAtlas · ${view.homeLabel}` : "HouseAtlas";
    const target = focus.current;
    if (!target) return;
    const candidates = root.current?.querySelectorAll<HTMLElement>(
      "[data-focus-id], [data-action], [id]",
    );
    const selected =
      candidates &&
      [...candidates].find(
        (el) =>
          el.dataset.focusId === target ||
          el.id === target ||
          `action:${el.dataset.action}` === target,
      );
    (
      selected ?? root.current?.querySelector<HTMLElement>("#page-heading")
    )?.focus();
    focus.current = null;
  }, [route, view, busy]);

  const remember = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && root.current?.contains(active))
      remembered.current.set(
        window.location.hash,
        active.dataset.focusId ??
          (active.dataset.action
            ? `action:${active.dataset.action}`
            : active.id),
      );
  };
  const navigate = (href: string, destinationFocus?: string) => {
    remember();
    if (destinationFocus) remembered.current.set(href, destinationFocus);
    if (window.location.hash === href) {
      focus.current = destinationFocus ?? "page-heading";
      setRoute(parseRoute(href));
    } else window.location.hash = href;
  };
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const anchor =
      event.target instanceof Element ? event.target.closest("a") : null;
    const href = anchor?.getAttribute("href");
    if (!href?.startsWith("#")) return;
    event.preventDefault();
    if (anchor?.classList.contains("skip"))
      root.current?.querySelector<HTMLElement>("#page-heading")?.focus();
    else navigate(href);
  };
  const switchHome = (scope: Scope) => {
    if (
      busy ||
      view.status !== "ready" ||
      !view.homes.some((h) => sameScope(h, scope)) ||
      sameScope(view.scope, scope)
    )
      return;
    window.history.replaceState(null, "", routeHref("home"));
    setRoute(parseRoute("#home"));
    void read(scope, true);
  };
  const heading =
    view.status === "ready"
      ? ""
      : text(view.status === "unavailable" ? "viewUnavailable" : view.status);
  const content = (
    <div ref={root} onClick={onClick}>
      <a className="skip" href="#page-heading">
        {text("skip")}
      </a>
      <RouteContext.Provider value={route}>
        {view.status !== "ready" ? (
          <main className="access-state" aria-busy={busy}>
            <div className="access-panel">
              <p className="access-brand">
                <BrandMark />
                <span>HouseAtlas</span>
              </p>
              <Heading>{heading}</Heading>
              <div className="access-actions">
                {view.status === "unavailable" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void read(failedHome ?? undefined, failedHome !== null)
                    }
                  >
                    {text("retry")}
                  </button>
                )}
                {signIn && ["expired", "revoked"].includes(view.status) && (
                  <button type="button" onClick={signIn}>
                    {text("signIn")}
                  </button>
                )}
                {session?.signOut && (
                  <button type="button" onClick={session.signOut}>
                    Sign out
                  </button>
                )}
              </div>
            </div>
          </main>
        ) : (
          <>
            <Shell view={view} route={route} navigate={navigate} />
            <div className="frame">
              <nav className="sections" aria-label={text("home")}>
                <ul>
                  {(
                    [
                      "home",
                      "places",
                      "documents",
                      "maintenance",
                      "unplaced",
                    ] as const
                  ).map((page) => (
                    <li key={page}>
                      <AtlasLink page={page}>{text(page)}</AtlasLink>
                    </li>
                  ))}
                </ul>
              </nav>
              <main id="main-content" aria-busy={busy}>
                <div className="statusline">
                  <button
                    type="button"
                    className="refresh"
                    data-action="reload"
                    disabled={busy}
                    onClick={() => void read(view.scope)}
                  >
                    {busy
                      ? "Reloading saved information…"
                      : "Reload saved information"}
                  </button>
                  <p id="notice" role="status" aria-live="polite">
                    {notice}
                  </p>
                </div>
                {view.caches.some(
                  (c) => c.owner === "network" && c.status === "access-revoked",
                ) && (
                  <p className="warning source-denied">
                    {text("networkDenied")}
                  </p>
                )}
                {route.page !== "settings" && <AiActivityStatus />}
                <AtlasPage
                  view={view}
                  route={route}
                  busy={busy}
                  switchHome={switchHome}
                  {...(session ? { session } : {})}
                  {...(editing
                    ? { editing, refresh: () => read(view.scope) }
                    : {})}
                />
              </main>
              <HouseIndex view={view} route={route} />
            </div>
          </>
        )}
      </RouteContext.Provider>
    </div>
  );
  return (
    <AiHost
      context={
        view.status === "ready"
          ? resolveAi?.(view.scope, view.homeLabel) ?? null
          : null
      }
    >
      {renderContent ? renderContent(view, content, { reload: () => read(view.status === "ready" ? view.scope : undefined), switchHome, busy, notice, ...(session ? { session } : {}), ...(editing ? { editing } : {}), ...(quantity ? { quantity } : {}) }) : content}
    </AiHost>
  );
}
function Shell({
  view,
  route,
  navigate,
}: {
  view: ReadyView;
  route: Route;
  navigate: (href: string, destinationFocus?: string) => void;
}) {
  const [query, setQuery] = useState(route.query);
  useEffect(() => setQuery(route.query), [route.query]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    navigate(
      routeHref("search", null, {
        query: query.slice(0, 512),
        archived: route.archived,
      }),
    );
  };
  return (
    <header className="masthead">
      <div className="masthead-inner">
        <a className="brand" href="#home">
          <BrandMark />
          <span className="brand-text">
            <span className="brand-name">HouseAtlas</span>
            <span className="brand-home">{view.homeLabel}</span>
          </span>
        </a>
        <form id="search-form" role="search" onSubmit={submit}>
          <label className="sr-only" htmlFor="atlas-search">
            {text("search")}
          </label>
          <div className="search-row">
            <svg className="search-mark" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6" />
              <path d="m15 15 5 5" />
            </svg>
            <input
              id="atlas-search"
              name="q"
              type="search"
              maxLength={512}
              placeholder={text("search")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="submit">{text("searchButton")}</button>
          </div>
          <div className="search-meta">
            <label className="archive-toggle">
              <input
                id="atlas-archives"
                name="archived"
                type="checkbox"
                checked={route.archived}
                onChange={(event) =>
                  navigate(
                    routeHref(route.page, route.key, {
                      ...route,
                      archived: event.target.checked,
                    }),
                    "atlas-archives",
                  )
                }
              />
              <span>{text("archives")}</span>
            </label>
          </div>
        </form>
        <nav className="utility" aria-label={text("settings")}>
          <AtlasLink page="settings">
            <svg
              className="utility-mark"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M4 7h9M19 7h1M4 17h3M13 17h7" />
              <circle cx="16" cy="7" r="2.6" />
              <circle cx="10" cy="17" r="2.6" />
            </svg>
            <span>{text("settings")}</span>
          </AtlasLink>
        </nav>
      </div>
    </header>
  );
}
function HouseIndex({ view, route }: { view: ReadyView; route: Route }) {
  if (
    !view.caches.some(
      (c) =>
        c.owner === "homebox" &&
        c.status !== "access-revoked" &&
        c.lastSuccessfulFetchAt,
    )
  )
    return null;
  const places = visibleEntries(view, route.archived).filter(
    (p) => p.kind === "place",
  );
  const path = (entry: (typeof places)[number]) =>
    [...ancestry(view, entry), entry].map((p) => p.entity.name).join(" / ");
  places.sort((a, b) => path(a).localeCompare(path(b)));
  if (!places.length) return null;
  return (
    <nav className="house-index" aria-label={text("places")}>
      <p className="index-title">{text("allPlaces")}</p>
      <ul className="place-rail">
        {places.map((p) => (
          <li
            key={p.key}
            className={`depth-${Math.min(ancestry(view, p).length, 6)}`}
          >
            <AtlasLink page="place" entryKey={p.key}>
              {p.entity.name}
            </AtlasLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
