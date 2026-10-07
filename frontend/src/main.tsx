import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { SessionApp } from "./app/SessionApp";
import { createAtlasClient, createAtlasSessionClient } from "./api/client";
import type { AtlasClient } from "./app/types";
import "./styles/atlas.css";
import "./styles/session.css";
import "./styles/stock.css";

const root = document.getElementById("root");
if (!root) throw new Error("HouseAtlas root missing");
// AT51 supplies same-origin route configuration after the Rust browser-view
// seam is reconciled. Missing configuration never falls back to synthetic data.
const bootstrap = root.dataset.bootstrapUrl;
const homeTemplate = root.dataset.homeUrlTemplate;
const signInPath = root.dataset.signInUrl;
const sessionPath = root.dataset.sessionUrl;
const loginPath = root.dataset.loginUrl;
const logoutPath = root.dataset.logoutUrl;
const sessions =
  sessionPath && loginPath
    ? createAtlasSessionClient({
        session: sessionPath,
        login: loginPath,
        ...(logoutPath ? { logout: logoutPath } : {}),
      })
    : null;
const client: AtlasClient =
  bootstrap &&
  homeTemplate?.includes("{workspaceId}") &&
  homeTemplate.includes("{homeId}")
    ? createAtlasClient({
        bootstrap,
        home: (scope) =>
          homeTemplate
            .replace("{workspaceId}", encodeURIComponent(scope.workspaceId))
            .replace("{homeId}", encodeURIComponent(scope.homeId)),
      })
    : {
        load: async () => ({ status: "unavailable" }),
        loadHome: async () => ({ status: "unavailable" }),
      };
const signInUrl = signInPath?.startsWith("/")
  ? new URL(signInPath, window.location.origin)
  : null;
const signIn =
  signInUrl?.origin === window.location.origin
    ? () => {
        window.location.assign(signInUrl.href);
      }
    : undefined;
createRoot(root).render(
  <StrictMode>
    {sessions ? (
      <SessionApp client={client} sessions={sessions} accessEvents={window} />
    ) : (
      <App
        client={client}
        {...(signIn ? { signIn } : {})}
        accessEvents={window}
      />
    )}
  </StrictMode>,
);
