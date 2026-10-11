import type { Scope } from "../api/generated/contracts.js";
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
import type { CaptureDraftPort } from "../capture-drafts-ui/port";
import type {
  AtlasAuthMode,
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
  | { status: "opening" }
  | { status: "expired" }
  | { status: "signed-out"; mode: AtlasAuthMode }
  | { status: "authenticated"; info: AtlasSessionInfo }
  | { status: "unavailable"; action: "load" | "sign-out" | "mode" | "local" };
export interface SessionAppProps {
  client: AtlasClient;
  sessions: AtlasSessionClient;
  accessEvents?: EventTarget;
  stock?: StockApplicationPorts;
  editing?: AtlasEditingClient;
  ai?: AiApplicationPort;
  renderContent?: AtlasAppProps["renderContent"];
  onScopeCommit?: AtlasAppProps["onScopeCommit"];
  localCaptures?: Pick<CaptureDraftPort, 'invalidate' | 'clearBeforeSignOut'>;
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
  renderContent,
  onScopeCommit,
  localCaptures,
}: SessionAppProps) {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const generation = useRef(0),
    active = useRef<AbortController | null>(null);
  const [logoutChoice, setLogoutChoice] = useState(false), [loseLocal, setLoseLocal] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false), [logoutError, setLogoutError] = useState('');
  const logoutLock = useRef(false), logoutHeading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { if (logoutChoice) logoutHeading.current?.focus(); }, [logoutChoice]);
  useLayoutEffect(() => {
    if (state.status !== 'authenticated') { onScopeCommit?.(null); localCaptures?.invalidate(); setLogoutChoice(false); }
  }, [state.status, onScopeCommit, localCaptures]);
  useEffect(() => () => { onScopeCommit?.(null); localCaptures?.invalidate(); }, [onScopeCommit, localCaptures]);
  const begin = () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    return { controller, attempt: ++generation.current };
  };
  // Signed-out transition. Without the paired local port this is the legacy
  // password state; otherwise the mode GET runs on the caller's attempt and a
  // mode failure never falls back to a sign-in method.
  const toSignedOut = useCallback(
    async (controller: AbortController, attempt: number) => {
      const localAccess = sessions.localAccess;
      if (!localAccess) {
        setState({ status: "signed-out", mode: "password" });
        return;
      }
      try {
        const mode = await localAccess.mode(controller.signal);
        if (!controller.signal.aborted && attempt === generation.current)
          setState({ status: "signed-out", mode });
      } catch {
        if (!controller.signal.aborted && attempt === generation.current)
          setState({ status: "unavailable", action: "mode" });
      }
    },
    [sessions],
  );
  const load = useCallback(async () => {
    const { controller, attempt } = begin();
    setState({ status: "loading" });
    try {
      const info = await sessions.session(controller.signal);
      if (controller.signal.aborted || attempt !== generation.current) return;
      if (info) setState({ status: "authenticated", info });
      else await toSignedOut(controller, attempt);
    } catch {
      if (!controller.signal.aborted && attempt === generation.current)
        setState({ status: "unavailable", action: "load" });
    }
  }, [sessions, toSignedOut]);
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
    if (state.status !== "authenticated") return;
    const expiresAt = Date.parse(state.info.expiresAt);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      if (stopped) return;
      if (timer !== undefined) clearTimeout(timer);
      const remaining = expiresAt - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) {
        stopped = true;
        generation.current++;
        active.current?.abort();
        localCaptures?.invalidate();
        onScopeCommit?.(null);
        setState({ status: "expired" });
      } else {
        timer = setTimeout(check, Math.min(remaining, 2_147_483_647));
      }
    };
    const visible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    check();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
    };
  }, [state, localCaptures, onScopeCommit]);
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
  const reloadMode = () => {
    const { controller, attempt } = begin();
    setState({ status: "loading" });
    void toSignedOut(controller, attempt);
  };
  const showSignIn = () => {
    if (sessions.localAccess) {
      reloadMode();
      return;
    }
    generation.current++;
    active.current?.abort();
    setState({ status: "signed-out", mode: "password" });
  };
  // Single POST per click on the action matching the decoded mode exactly; a
  // missing action is a mode failure, never another route. An unconfirmed
  // outcome is resolved only by a session check, never by an automatic retry.
  const openHome = async (mode: AtlasAuthMode) => {
    const localAccess = sessions.localAccess;
    if (!localAccess) return;
    const open =
      mode === "loopback-local"
        ? localAccess.signIn
        : mode === "trusted-proxy"
          ? localAccess.proxySignIn
          : undefined;
    const { controller, attempt } = begin();
    if (!open) {
      setState({ status: "unavailable", action: "mode" });
      return;
    }
    setState({ status: "opening" });
    try {
      const info = await open(controller.signal);
      if (!controller.signal.aborted && attempt === generation.current)
        setState({ status: "authenticated", info });
    } catch {
      if (!controller.signal.aborted && attempt === generation.current)
        setState({ status: "unavailable", action: "local" });
    }
  };
  const signOut = async () => {
    if (!sessions.signOut) return;
    const { controller, attempt } = begin();
    setState({ status: "loading" });
    try {
      await sessions.signOut(controller.signal);
      if (!controller.signal.aborted && attempt === generation.current)
        await toSignedOut(controller, attempt);
    } catch {
      if (!controller.signal.aborted && attempt === generation.current)
        setState({ status: "unavailable", action: "sign-out" });
    }
  };
  const chooseSignOut = () => {
    if (!localCaptures) { void signOut(); return; }
    setLoseLocal(false); setLogoutError(''); setLogoutChoice(true);
  };
  const confirmSignOut = async () => {
    if (logoutLock.current) return;
    logoutLock.current = true; setLogoutBusy(true); setLogoutError('');
    try {
      // Explicit cleanup runs while the authenticated home is still mounted.
      // A failed cleanup never becomes a successful deletion or silent logout.
      if (loseLocal) await localCaptures?.clearBeforeSignOut();
      localCaptures?.invalidate(); setLogoutChoice(false);
      await signOut();
    } catch { setLogoutError('Local captures could not be removed. You are still signed in. Keep them and sign out, or cancel.'); }
    finally { logoutLock.current = false; setLogoutBusy(false); }
  };
  if (state.status === "authenticated") {
    return (
      <>
      <div inert={logoutChoice}>
      <App
        client={client}
        signIn={showSignIn}
        session={{
          expiresAt: state.info.expiresAt,
          ...(sessions.signOut ? { signOut: chooseSignOut } : {}),
        }}
        {...(accessEvents ? { accessEvents } : {})}
        {...((stock || renderContent)
          ? ({
              renderContent: (view, content, actions) => stock ? (
                <StockApplication
                  session={state.info}
                  ports={stock}
                  view={view}
                >
                  {renderContent ? renderContent(view, content, actions) : content}
                </StockApplication>
              ) : renderContent!(view, content, actions),
            } satisfies Pick<AtlasAppProps, "renderContent">)
          : {})}
        {...(editing ? { editing } : {})}
        {...(onScopeCommit ? { onScopeCommit } : {})}
        {...(ai ? { resolveAi: (scope: Scope, label: string) => ai.resolve(state.info, scope, label) } : {})}
      />
      </div>
      {logoutChoice && <section className="access-panel" role="dialog" aria-modal="true" aria-labelledby="capture-logout-heading" aria-busy={logoutBusy}>
        <h2 id="capture-logout-heading" ref={logoutHeading} tabIndex={-1}>Sign out</h2>
        <p>Local capture drafts stay in this browser unless you remove them. They are hidden from other signed-in accounts.</p>
        <label><input type="checkbox" checked={loseLocal} disabled={logoutBusy} onChange={event => setLoseLocal(event.target.checked)} /> Delete my local captures in all homes before signing out, including unknown attempts</label>
        {loseLocal && <p>This loses the local files and does not cancel any server operation.</p>}
        <p role="alert">{logoutError}</p>
        <div className="access-actions"><button type="button" disabled={logoutBusy} onClick={() => void confirmSignOut()}>{loseLocal ? 'Delete local captures and sign out' : 'Keep local captures and sign out'}</button>
          <button type="button" disabled={logoutBusy} onClick={() => setLogoutChoice(false)}>Cancel</button></div>
      </section>}
      </>
    );
  }
  if (state.status === "expired") {
    return (
      <SessionPanel focusHeading title="Session expired.">
        <div className="access-actions">
          <button type="button" onClick={() => void load()}>Check session</button>
        </div>
      </SessionPanel>
    );
  }
  if (state.status === "signed-out") {
    const mode = state.mode;
    return mode === "loopback-local" || mode === "trusted-proxy" ? (
      <OpenHomePanel openHome={() => void openHome(mode)} />
    ) : (
      <SignInForm signIn={signIn} />
    );
  }
  return (
    <SessionPanel
      focusHeading
      loading={state.status === "loading" || state.status === "opening"}
      title={
        state.status === "loading"
          ? "Loading session…"
          : state.status === "opening"
            ? "Opening Home…"
            : state.action === "sign-out"
              ? "Sign out could not be confirmed."
              : state.action === "mode"
                ? "Sign-in method could not be loaded."
                : state.action === "local"
                  ? "Opening Home could not be confirmed."
                  : "The session could not be loaded."
      }
    >
      {state.status === "unavailable" && (
        <div className="access-actions">
          <button
            type="button"
            onClick={() => {
              if (state.action === "sign-out") void signOut();
              else if (state.action === "mode") reloadMode();
              else void load();
            }}
          >
            {state.action === "local" ? "Check session" : "Try again"}
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
function OpenHomePanel({ openHome }: { openHome: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    button.current?.focus();
  }, []);
  return (
    <SessionPanel title="Sign in">
      <div className="access-actions">
        <button ref={button} type="button" onClick={openHome}>
          Open Home
        </button>
      </div>
    </SessionPanel>
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
