/** Healthy application-session examples using supplied synthetic data and
 * successful fake ports. Logout, denial, revocation and live auth are unrun. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createAtlasSessionClient } from "../api/client";
import { SessionApp } from "./SessionApp";
import { decodeAtlasView } from "./decode";
import type { AtlasSessionClient, AtlasSessionInfo } from "./session";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export async function runHealthySessionExamples(
  container: HTMLElement,
  supplied: unknown,
): Promise<string[]> {
  const view = decodeAtlasView(supplied);
  assert(view.status === "ready", "Authorized synthetic view required");
  const info: AtlasSessionInfo = {
    schemaVersion: 1,
    actorId: "00000000-0000-4000-8000-000000000010",
    csrfToken: "synthetic-example-nonce",
    expiresAt: "2026-10-08T12:30:00Z",
  };
  const checks: string[] = [];
  let completeSession: (() => void) | undefined;
  const initialSession = new Promise<null>((resolve) => {
    completeSession = () => resolve(null);
  });
  const sessions: AtlasSessionClient = {
    session: async () => initialSession,
    signIn: async (credentials) => {
      assert(
        credentials.username === "example-reader" &&
          credentials.password === "synthetic-example-only",
        "Canonical credentials reach only the typed port",
      );
      assert(
        container.querySelector<HTMLInputElement>('[name="password"]')
          ?.value === "",
        "Password field cleared before awaiting the port",
      );
      return info;
    },
    // Render availability only: this example never invokes logout.
    signOut: async () => {
      throw new Error("Logout is outside these healthy examples");
    },
  };
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <SessionApp
          client={{ load: async () => view, loadHome: async () => view }}
          sessions={sessions}
        />,
      ),
    );
    const loadingHeading = container.querySelector("#page-heading");
    assert(
      loadingHeading && document.activeElement === loadingHeading,
      "Initial session loading focuses the page heading",
    );
    const progress = container.querySelector('[role="status"]');
    assert(
      progress?.getAttribute("aria-live") === "polite" &&
        progress.textContent === "Loading session…",
      "Loading session is announced as progress",
    );
    assert(completeSession, "Ordinary session completion available");
    await act(async () => completeSession?.());
    const username =
      container.querySelector<HTMLInputElement>('[name="username"]');
    const password =
      container.querySelector<HTMLInputElement>('[name="password"]');
    const form = container.querySelector<HTMLFormElement>("form");
    assert(
      username && password && form && document.activeElement === username,
      "Sign-in form and initial username focus",
    );
    assert(
      username.autocomplete === "username" &&
        password.autocomplete === "current-password" &&
        password.type === "password",
      "Native credential field semantics",
    );
    checks.push(
      "loading heading focus/progress and signed-out username focus, labels and password semantics",
    );
    username.value = "example-reader";
    password.value = "synthetic-example-only";
    await act(async () =>
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    assert(
      container.querySelector("h1")?.textContent === "Home",
      "Successful fake sign-in opens authorized home",
    );
    checks.push(
      "successful typed sign-in, cleared password field and authorized home read",
    );
    await act(async () => {
      window.history.replaceState(null, "", "#settings");
      window.dispatchEvent(new Event("hashchange"));
    });
    assert(
      container.querySelector("time")?.getAttribute("datetime") ===
        info.expiresAt && container.querySelector("select"),
      "Session expiry and house selection in Settings",
    );
    assert(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "Sign out",
      ),
      "Host-configured logout action is visible",
    );
    assert(
      !container.textContent?.includes(info.csrfToken) &&
        !container.textContent?.includes(info.actorId),
      "Session metadata remains internal",
    );
    checks.push(
      "Settings house selector and session expiry with optional uninvoked logout",
    );
  } finally {
    await act(async () => root.unmount());
  }

  const calls: string[] = [];
  const transport: typeof fetch = async (input, init) => {
    const path = String(input);
    assert(
      init?.credentials === "same-origin" &&
        init.cache === "no-store" &&
        init.redirect === "error",
      "Session transport options",
    );
    if (path === "/api/atlas/auth/session")
      assert(init.method === "GET" && !init.body, "Canonical session GET");
    else {
      assert(
        path === "/api/atlas/auth/login" && init.method === "POST",
        "Canonical login POST",
      );
      assert(typeof init.body === "string", "Credential JSON body");
      const body: unknown = JSON.parse(init.body);
      assert(
        body &&
          typeof body === "object" &&
          Object.keys(body).sort().join(",") === "password,username" &&
          "username" in body &&
          body.username === "example-reader" &&
          "password" in body &&
          body.password === "synthetic-example-only",
        "Exact canonical login fields",
      );
      assert(
        new Headers(init.headers).get("Content-Type") === "application/json",
        "Login content type",
      );
    }
    calls.push(path);
    return new Response(JSON.stringify(info), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const client = createAtlasSessionClient(
    { session: "/api/atlas/auth/session", login: "/api/atlas/auth/login" },
    transport,
  );
  const signal = new AbortController().signal;
  assert(
    (await client.session(signal))?.expiresAt === info.expiresAt,
    "Published session DTO decoded",
  );
  assert(
    (
      await client.signIn(
        { username: "example-reader", password: "synthetic-example-only" },
        signal,
      )
    ).schemaVersion === 1,
    "Published login DTO decoded",
  );
  assert(
    calls.length === 2 && !client.signOut,
    "Only configured successful session/login actions used",
  );
  checks.push(
    "successful canonical session GET and exact credential POST with fake transport",
  );
  return checks;
}
