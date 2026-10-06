/** Scoped healthy synthetic UI examples. The external harness supplies a DOM
 * and a validated published synthetic view. No fault, denial, adversarial,
 * concurrency or legacy aggregate controls are invoked here. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createAtlasClient } from "../api/client";
import { decodeAtlasView } from "./decode";
import { ancestry, routeHref, sameScope } from "./model";
import { text } from "./copy";
import type { AtlasClient, ReadyView, Scope } from "./types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export async function runHealthyExamples(
  container: HTMLElement,
  supplied: unknown,
): Promise<string[]> {
  const view = decodeAtlasView(supplied);
  assert(view.status === "ready", "Healthy authorized synthetic view required");
  assert(view.homes.length >= 2, "Two authorized synthetic homes required");
  const room = view.entries.find((p) => p.entity.name === "Sitting room");
  const radio = view.entries.find((p) => p.entity.name === "Portable radio");
  const archived = view.entries.find((p) => p.entity.archived);
  assert(
    room && radio && archived,
    "Published room, item and archive examples required",
  );
  const alternate = view.homes.find((h) => !sameScope(h, view.scope));
  assert(alternate, "Alternate authorized synthetic home required");
  const checks: string[] = [],
    reads: Scope[] = [];
  const alternateView: ReadyView = {
    ...view,
    scope: alternate,
    homeLabel: alternate.label,
    entries: [],
    caches: [],
  };
  const client: AtlasClient = {
    load: async () => view,
    loadHome: async (scope) => {
      reads.push(scope);
      return sameScope(scope, alternate) ? alternateView : view;
    },
  };
  const root = createRoot(container);
  const heading = () => container.querySelector("h1")?.textContent;
  const focusedId = () => document.activeElement?.id;
  const route = async (hash: string) => {
    await act(async () => {
      window.history.replaceState(null, "", hash);
      window.dispatchEvent(new Event("hashchange"));
    });
  };
  const click = async (element: Element | null) => {
    assert(element instanceof HTMLElement, "Control available");
    await act(async () => element.click());
  };
  try {
    await act(async () => root.render(<App client={client} />));
    assert(
      heading() === "Home" && container.textContent?.includes(room.entity.name),
      "Healthy bootstrap and room plates",
    );
    checks.push("authorized bootstrap and enamel room plates");
    assert(
      container.querySelector("#notice:empty")?.getAttribute("role") ===
        "status",
      "Published empty-notice layout hook",
    );
    await route(routeHref("place", room.key));
    assert(
      heading() === room.entity.name &&
        container.textContent?.includes("Display cabinet"),
      "Room descendants",
    );
    assert(focusedId() === "page-heading", "Room navigation focuses heading");
    checks.push("room descendants and heading focus");
    await route(routeHref("item", radio.key));
    assert(
      heading() === radio.entity.name &&
        container
          .querySelector(".rating-plate")
          ?.textContent?.includes("Audio 12"),
      "Item specifications",
    );
    assert(
      container.textContent?.includes("Moves around; no fixed place."),
      "Reviewed mobile placement",
    );
    assert(
      container.textContent?.includes("Currency not recorded"),
      "Maintenance currency qualifier",
    );
    assert(
      container.querySelector("a[download]")?.getAttribute("href") ===
        "/api/atlas/media/example-manual",
      "Issued media download",
    );
    checks.push(
      "item details, mobile placement, maintenance and issued downloads",
    );
    await route("#home");
    const input = container.querySelector<HTMLInputElement>("#atlas-search");
    const form = container.querySelector("#search-form");
    assert(input && form, "Search controls available");
    const setInput = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    assert(setInput, "Native input setter available");
    await act(async () => {
      setInput.call(input, "Audio 12");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
    assert(heading() === "Search results", "Search form navigation");
    const documentLink = container.querySelector(".doc-links a");
    assert(documentLink?.textContent === "Audio 12 manual", "Document search");
    await click(documentLink);
    // Hash navigation is asynchronous in a DOM implementation.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
    assert(focusedId()?.startsWith("doc-heading-"), "Document target focus");
    checks.push("model/document search and document target focus");
    await route("#places");
    container.querySelector<HTMLElement>("#atlas-archives")?.focus();
    await click(container.querySelector("#atlas-archives"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
    assert(
      container.textContent?.includes(archived.entity.name),
      "Archive visibility",
    );
    assert(
      container.querySelector<HTMLInputElement>("#atlas-archives")?.checked,
      "Archive control state",
    );
    assert(
      focusedId() === "atlas-archives",
      "Archive control destination focus",
    );
    checks.push("archived source records, control state and destination focus");
    await route("#settings");
    const select = container.querySelector("select");
    assert(select, "Settings home selector");
    assert(select.options.length === 2, "Authorized choices");
    await act(async () => {
      select.value = alternate.homeId;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert(
      heading() === "Home" &&
        document.title === `HouseAtlas · ${alternate.label}`,
      "Healthy house switch",
    );
    checks.push("Settings authorized house selection and destination title");
    await route("#settings");
    const back = container.querySelector("select");
    assert(back, "Destination home selector");
    await act(async () => {
      back.value = view.scope.homeId;
      back.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(container.querySelector('[data-action="reload"]'));
    assert(
      reads.length === 3 && sameScope(reads[2] ?? alternate, view.scope),
      "Passive reload scope",
    );
    assert(
      document.activeElement?.getAttribute("data-action") === "reload",
      "Reload focus",
    );
    checks.push("return house selection and passive saved-view reload");
    await route(routeHref("item", radio.key));
    const edit = [...container.querySelectorAll("a")].find(
      (a) => a.textContent === "Edit in HomeBox",
    );
    assert(
      edit?.href.includes("/synthetic-homebox/edit/"),
      "Server-issued native edit link",
    );
    checks.push("verified native HomeBox edit capability");
    assert(
      ancestry(view, radio).length === 0,
      "Published mobile example has no inferred room",
    );
    const requests: RequestInit[] = [];
    const transport: typeof fetch = async (_input, init) => {
      if (init) requests.push(init);
      return new Response(JSON.stringify(view), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const http = createAtlasClient(
      {
        bootstrap: "/synthetic/view",
        home: (scope) => `/synthetic/${encodeURIComponent(scope.homeId)}/view`,
      },
      transport,
    );
    const signal = new AbortController().signal;
    assert((await http.load(signal)).status === "ready", "Healthy HTTP decode");
    assert(
      (await http.loadHome(view.scope, signal)).status === "ready",
      "Healthy scoped HTTP decode",
    );
    assert(
      requests.length === 2 &&
        requests.every(
          (r) =>
            r.method === "GET" &&
            r.credentials === "same-origin" &&
            r.cache === "no-store" &&
            r.redirect === "error",
        ),
      "Passive HTTP request shape",
    );
    checks.push("healthy bootstrap/scoped GET transport and typed decode");
    return checks;
  } finally {
    await act(async () => root.unmount());
  }
}

export interface PublishedVariantViews {
  site: unknown;
  other: unknown;
  retained: unknown;
  photos: unknown;
}
/** The harness prepares each healthy variant from schema-validated published
 * synthetic snapshots. These are valid values, not rejection controls. */
export async function runPublishedVariantExamples(
  container: HTMLElement,
  supplied: PublishedVariantViews,
): Promise<string[]> {
  const root = createRoot(container),
    checks: string[] = [];
  let mountNumber = 0;
  const mount = async (view: ReadyView, hash: string) => {
    window.history.replaceState(null, "", hash);
    const client: AtlasClient = {
      load: async () => view,
      loadHome: async () => view,
    };
    await act(async () =>
      root.render(
        <App key={++mountNumber} initialView={view} client={client} />,
      ),
    );
  };
  const ready = (value: unknown): ReadyView => {
    const view = decodeAtlasView(value);
    assert(view.status === "ready", "Healthy published variant decoded");
    return view;
  };
  try {
    for (const semantic of ["site", "other"] as const) {
      const view = ready(supplied[semantic]);
      const place = view.entries.find((p) => p.semanticKind === semantic);
      assert(place, "Published semantic value retained");
      assert(
        view.entries.some((p) =>
          p.nativeLinks.some((link) => link.intent === "view"),
        ),
        "Published native view intent retained",
      );
      await mount(view, routeHref("place", place.key));
      assert(
        container
          .querySelector(".record-head .plate-kind")
          ?.textContent?.startsWith("Place"),
        "Generic place presentation",
      );
      checks.push(
        `published ${semantic} semantics, native view intent and generic Place presentation`,
      );
      const archived = view.entries.find((p) => p.sourceState === "archived");
      assert(archived, "Published archived source value retained");
      await mount(view, routeHref("item", archived.key, { archived: true }));
      assert(
        container.querySelector(".badge")?.textContent === text("archived"),
        "Archived source qualifier",
      );
    }
    checks.push("published archived source state and archive qualifier");
    const retained = ready(supplied.retained);
    await mount(retained, "#places");
    for (const sourceState of ["unresolved", "confirmed-deleted"] as const) {
      const entry = retained.entries.find((p) => p.sourceState === sourceState);
      assert(entry, "Healthy retained source record");
      const label = [...container.querySelectorAll(".tree-label")].find(
        (el) => el.querySelector("a")?.textContent === entry.entity.name,
      );
      assert(
        label?.textContent?.includes(
          text(sourceState === "unresolved" ? "unresolved" : "deleted"),
        ),
        "Specific retained-record tree qualifier",
      );
    }
    checks.push(
      "unresolved and confirmed-deleted retained-record tree qualifiers",
    );
    const photos = ready(supplied.photos);
    const item = photos.entries.find((p) => p.entity.name === "Portable radio");
    assert(item, "Healthy photo owner");
    await mount(photos, routeHref("item", item.key));
    const figures = [...container.querySelectorAll(".photos-section figure")];
    for (const title of [
      "Synthetic GIF reference",
      "Synthetic AVIF reference",
    ]) {
      assert(
        figures.some(
          (figure) =>
            figure.querySelector(".photo-placeholder .photo-title")
              ?.textContent === title,
        ),
        "Other image format reference retained as placeholder",
      );
    }
    assert(
      container.querySelector(".photos-section img")?.getAttribute("src") ===
        "/api/atlas/media/example-photo",
      "Issued supported preview retained",
    );
    checks.push("GIF/AVIF photo references and restricted issued PNG preview");
    return checks;
  } finally {
    await act(async () => root.unmount());
  }
}
