import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { createAtlasClient } from "./api/client";
import type { AtlasClient } from "./app/types";
import "./styles/atlas.css";

const root = document.getElementById("root");
if (!root) throw new Error("HouseAtlas root missing");
// AT51 supplies same-origin route configuration after the Rust browser-view
// seam is reconciled. Missing configuration never falls back to synthetic data.
const bootstrap = root.dataset.bootstrapUrl;
const homeTemplate = root.dataset.homeUrlTemplate;
const signInPath = root.dataset.signInUrl;
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
    <App
      client={client}
      {...(signIn ? { signIn } : {})}
      accessEvents={window}
    />
  </StrictMode>,
);
