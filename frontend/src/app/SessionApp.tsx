import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { App, type AtlasAppProps } from "./App";
import { BrandMark, Heading } from "./components";
import type { AtlasClient } from "./types";
import type { AtlasEditingClient } from "./editing";
import type { AiApplicationPort } from "../ai/host/index.js";
import type {
  AtlasCredentials,
  AtlasSessionClient,
  AtlasSessionInfo,
} from "./session";
import {
  StockApplication,
  type StockApplicationPorts,
} from "./StockApplication";

type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "authenticated"; info: AtlasSessionInfo }
  | { status: "unavailable"; action: "load" | "sign-out" };
export interface SessionAppProps {
  client: AtlasClient;
  sessions: AtlasSessionClient;
  accessEvents?: EventTarget;
  stock?: StockApplicationPorts;
  editing?: AtlasEditingClient;
  ai?: AiApplicationPort;
}
/** Optional application-auth shell. It does not provision accounts, grant home
 * membership or authorize a source. Protected browsing is still owned by App. */
export function SessionApp({
  client,
  sessions,
  accessEvents,
  stock,
  editing,
  ai,
}: SessionAppProps) {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const generation = useRef(0),
    active = useRef<AbortController | null>(null);
  const begin = () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    return { controller, attempt: ++generation.current };
  };
  const load = useCallback(async () => {
    const { controller, attempt } = begin();
    setState({ status: "loading" });
    try {
      const info = await sessions.session(controller.signal);
      if (!controller.signal.aborted && attempt === generation.current)
        setState(
          info ? { status: "authenticated", info } : { status: "signed-out" },
        );
    } catch {
      if (!controller.signal.aborted && attempt === generation.current)
        setState({ status: "unavailable", action: "load" });
    }
  }, [sessions]);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
      active.current?.abort();
    };
  }, [load]);
  useEffect(
    () =>
      sessions.subscribe?.(() => {
        void load();
      }),
    [sessions, load],
  );
  useLayoutEffect(() => {
    if (state.status !== "authenticated") {
      document.title = "HouseAtlas";
      document.documentElement.lang = "en";
    }
  }, [state]);
  const signIn = async (credentials: AtlasCredentials, signal: AbortSignal) => {
    const attempt = ++generation.current;
    const info = await sessions.signIn(credentials, signal);
    if (!signal.aborted && attempt === generation.current)
      setState({ status: "authenticated", info });
  };
  const showSignIn = () => {
    generation.current++;
    active.current?.abort();
    setState({ status: "signed-out" });
  };
  const signOut = async () => {
    if (!sessions.signOut) return;
    const { controller, attempt } = begin();
    setState({ status: "loading" });
    try {
      await sessions.signOut(controller.signal);
      if (!controller.signal.aborted && attempt === generation.current)
        setState({ status: "signed-out" });
    } catch {
      if (!controller.signal.aborted && attempt === generation.current)
        setState({ status: "unavailable", action: "sign-out" });
    }
  };
  if (state.status === "authenticated") {
    return (
      <App
        client={client}
        signIn={showSignIn}
        session={{
          expiresAt: state.info.expiresAt,
          ...(sessions.signOut ? { signOut: () => void signOut() } : {}),
        }}
        {...(accessEvents ? { accessEvents } : {})}
        {...(stock
          ? ({
              renderContent: (view, content) => (
                <StockApplication
                  session={state.info}
                  ports={stock}
                  view={view}
                >
                  {content}
                </StockApplication>
              ),
            } satisfies Pick<AtlasAppProps, "renderContent">)
          : {})}
        {...(editing ? { editing } : {})}
        {...(ai ? { resolveAi: (scope: Scope, label: string) => ai.resolve(state.info, scope, label) } : {})}
      />
    );
  }
  if (state.status === "signed-out") return <SignInForm signIn={signIn} />;
  return (
    <SessionPanel
      focusHeading
      loading={state.status === "loading"}
      title={
        state.status === "loading"
          ? "Loading session…"
          : state.action === "sign-out"
            ? "Sign out could not be confirmed."
            : "The session could not be loaded."
      }
    >
      {state.status === "unavailable" && (
        <div className="access-actions">
          <button
            type="button"
            onClick={() =>
              void (state.action === "sign-out" ? signOut() : load())
            }
          >
            Try again
          </button>
        </div>
      )}
    </SessionPanel>
  );
}
function SessionPanel({
  title,
  children,
  focusHeading = false,
  loading = false,
}: {
  title: string;
  children?: ReactNode;
  focusHeading?: boolean;
  loading?: boolean;
}) {
  useLayoutEffect(() => {
    if (focusHeading) document.getElementById("page-heading")?.focus();
  }, [focusHeading, title]);
  return (
    <>
      <a
        className="skip"
        href="#page-heading"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("page-heading")?.focus();
        }}
      >
        Skip to content
      </a>
      <main className="access-state">
        <div className="access-panel">
          <p className="access-brand">
            <BrandMark />
            <span>HouseAtlas</span>
          </p>
          <div
            role={loading ? "status" : undefined}
            aria-live={loading ? "polite" : undefined}
            aria-atomic={loading ? true : undefined}
          >
            <Heading>{title}</Heading>
          </div>
          {children}
        </div>
      </main>
    </>
  );
}
function SignInForm({
  signIn,
}: {
  signIn: (credentials: AtlasCredentials, signal: AbortSignal) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const username = useRef<HTMLInputElement>(null),
    passwordField = useRef<HTMLInputElement>(null),
    active = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    username.current?.focus();
  }, []);
  useEffect(() => () => active.current?.abort(), []);
  useLayoutEffect(() => {
    if (error && !busy) passwordField.current?.focus();
  }, [error, busy]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget,
      fields = new FormData(form);
    const credentials = {
      username: String(fields.get("username") ?? ""),
      password: String(fields.get("password") ?? ""),
    };
    const password = form.elements.namedItem("password");
    if (password instanceof HTMLInputElement) password.value = "";
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    try {
      await signIn(credentials, controller.signal);
    } catch {
      if (!controller.signal.aborted) {
        setError("Sign in did not succeed.");
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return (
    <SessionPanel title="Sign in">
      <form
        className="session-form"
        aria-busy={busy}
        onSubmit={(event) => void submit(event)}
      >
        <label htmlFor="atlas-username">
          <span>Username</span>
          <input
            ref={username}
            id="atlas-username"
            name="username"
            autoComplete="username"
            required
            disabled={busy}
          />
        </label>
        <label htmlFor="atlas-password">
          <span>Password</span>
          <input
            ref={passwordField}
            id="atlas-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={busy}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="session-error" role="alert">
          {error}
        </p>
      </form>
    </SessionPanel>
  );
}
