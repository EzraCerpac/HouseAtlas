/** Healthy synthetic user forms only. Host ports are fakes; no HTTP, vault,
 * domain transaction, provider, denial, failure or race probe is run. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { decodeAtlasView } from "./decode";
import { routeHref } from "./model";
import type {
  Guard,
  LocationSemanticsRecord,
} from "../api/generated/contracts.js";
import type {
  StockRequestEnvelope,
  StockResultEnvelope,
} from "../webmcp/stock.js";
import type { AtlasEditingClient, PlaceEditAdmission } from "./editing";
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export async function runHealthyEditing(
  container: HTMLElement,
  supplied: {
    view: unknown;
    record: LocationSemanticsRecord;
    guards: readonly Guard[];
    validate: (ref: string, value: unknown) => void;
    makeReceipt: (
      commandId: string,
      requestId: string,
      operationId: string,
      record: LocationSemanticsRecord,
    ) => StockResultEnvelope;
  },
) {
  const decoded = decodeAtlasView(supplied.view);
  check(decoded.status === "ready", "Healthy authorized view");
  // Passive provider edit availability is independent of Atlas host admission.
  const view = { ...decoded, canEdit: false };
  const classificationPrefix = "Correct Atlas classification: ",
    attachmentPrefix = "Attach example evidence: ";
  const classificationReason =
      classificationPrefix +
      "🏠".repeat(1024 - Array.from(classificationPrefix).length),
    attachmentReason =
      attachmentPrefix +
      "🏠".repeat(1024 - Array.from(attachmentPrefix).length);
  const place = view.entries.find(
    (entry) => entry.entity.name === "Display cabinet",
  );
  check(place, "Published mapped Atlas place");
  let record = structuredClone(supplied.record),
    reads = 0,
    refreshes = 0;
  let currentView = view;
  const order: string[] = [];
  let completeSave: (() => void) | undefined;
  const saveCompletion = new Promise<void>((resolve) => {
    completeSave = resolve;
  });
  const permitted = {
    label: "Synthetic permitted licence",
    value: { status: "permitted" as const, reference: null },
  };
  const unknown = {
    label: "Synthetic unknown licence",
    value: { status: "unknown" as const, reference: null },
  };
  const admission = (): PlaceEditAdmission => ({
    record,
    guards: supplied.guards,
    canReplaceClassification: true,
    attachmentPolicy: {
      contentTypes: ["text/plain"],
      maximumBytes: 1024,
      licenses:
        record.revision === supplied.record.revision
          ? [permitted, unknown]
          : [unknown, permitted],
    },
  });
  const editing: AtlasEditingClient = {
    loadPlace: async (source) => {
      check(
        source.key.externalId === place.entity.id,
        "Qualified source maps to current host record",
      );
      reads++;
      return admission();
    },
    replacePlace: async (request: StockRequestEnvelope) => {
      check(
        request["reason"] === classificationReason &&
          Array.from(classificationReason).length === 1024 &&
          classificationReason.length > 1024,
        "Native 1024-codepoint classification reason is unchanged",
      );
      supplied.validate(
        "#/$defs/request_atlas_location_semantics_replace",
        request,
      );
      check(
        request["preconditions"] &&
          JSON.stringify(request["preconditions"]) ===
            JSON.stringify({
              target: { kind: "atlas", value: record.revision },
              guards: supplied.guards.map((guard) => ({
                target: { authority: "atlas", ...guard.record },
                revision: { kind: "atlas", value: guard.expectedRevision },
              })),
            }),
        "Current target and complete reference guards",
      );
      check(
        request.payload["atlasId"] === record.payload.atlasId &&
          request.payload["reviewStatus"] === record.payload.reviewStatus &&
          JSON.stringify(request.payload["evidenceIds"]) ===
            JSON.stringify(record.payload.evidenceIds),
        "Only classification changes",
      );
      order.push("replace");
      await saveCompletion;
      record = {
        ...record,
        revision: record.revision + 1,
        payload: { ...record.payload, semanticKind: "site" },
      };
      currentView = {
        ...view,
        entries: view.entries.map((entry) =>
          entry.key === place.key ? { ...entry, semanticKind: "site" } : entry,
        ),
      };
      const result = supplied.makeReceipt(
        request.commandId,
        request.requestId,
        String(request["idempotencyKey"]),
        record,
      );
      supplied.validate(
        "#/$defs/result_atlas_location_semantics_replace",
        result,
      );
      return result;
    },
    uploadPlaceEvidence: async (intent) => {
      check(
        intent.expectedRevision === record.revision &&
          intent.recordId === record.recordId &&
          intent.guards === supplied.guards,
        "Attachment uses fresh target and exact guards",
      );
      check(
        intent.file.name === "example.txt" &&
          intent.file.type === "text/plain" &&
          intent.statement === "Synthetic owner note" &&
          intent.reason === attachmentReason &&
          Array.from(attachmentReason).length === 1024 &&
          intent.sourceLicense.status === "permitted",
        "Explicit file/evidence/licence/reason intent",
      );
      check(
        !("storageKey" in intent) && !("sha256" in intent),
        "Browser supplies no server storage proof",
      );
      order.push("upload");
      record = { ...record, revision: record.revision + 1 };
      const result = supplied.makeReceipt(
        "atlas.batch.execute",
        intent.requestId,
        intent.idempotencyKey,
        record,
      );
      supplied.validate("#/$defs/result_atlas_batch_execute", result);
      return result;
    },
  };
  const root = createRoot(container),
    checks: string[] = [];
  const button = (name: string) => {
    const b = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === name,
    );
    check(b, `Control ${name}`);
    return b;
  };
  try {
    window.history.replaceState(null, "", routeHref("place", place.key));
    await act(async () =>
      root.render(
        <App
          initialView={view}
          editing={editing}
          client={{
            load: async () => currentView,
            loadHome: async () => {
              refreshes++;
              order.push("refresh");
              return currentView;
            },
          }}
        />,
      ),
    );
    await act(async () => button("Edit Atlas place").click());
    const section = container.querySelector<HTMLElement>(
      '[aria-label="Atlas place editing"]',
    );
    check(
      section && section.querySelector("h2") === document.activeElement,
      "Scoped editor and heading focus",
    );
    check(
      !section.textContent?.includes("Loading Atlas information…"),
      "Successful opening clears loading announcement",
    );
    const initialLicense =
      section.querySelector<HTMLSelectElement>('[name="license"]');
    check(initialLicense, "Approved licence selector available");
    await act(async () => {
      initialLicense.value = "0";
      initialLicense.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const form = section.querySelector<HTMLFormElement>(
      'form[aria-label="Place classification"]',
    );
    check(form, "Classification form");
    check(
      form.textContent?.includes("Reason (maximum 1024 characters)"),
      "Native reason limit displayed on host-admitted local form",
    );
    const select = form.querySelector<HTMLSelectElement>("select");
    check(select, "Classification selector");
    await act(async () => {
      select.value = "site";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const reason = form.querySelector<HTMLInputElement>('[name="reason"]');
    check(reason, "Reason");
    reason.value = classificationReason;
    reason.dispatchEvent(new Event("input", { bubbles: true }));
    check(reason.validity.valid, "Valid codepoint-length reason");
    await act(async () =>
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    check(
      button("Save classification").disabled &&
        section.getAttribute("aria-busy") === "true",
      "Explicit submit exposes busy state",
    );
    check(completeSave, "Healthy completion available");
    await act(async () => completeSave?.());
    check(
      section.textContent?.includes("Saved. Information refreshed.") &&
        reads === 2 &&
        refreshes === 1 &&
        JSON.stringify(order) === JSON.stringify(["replace", "refresh"]),
      "Save then canonical view and admission refresh",
    );
    check(
      form.querySelector<HTMLSelectElement>("select")?.value === "site",
      "Fresh canonical classification retained",
    );
    check(
      initialLicense.value === "",
      "Fresh admission resets licence choice after normal policy reorder",
    );
    checks.push(
      "host-admitted local classification with passive provider: canonical wire3, unchanged 1024-codepoint reason, guards, busy and refresh",
    );
    const upload = section.querySelector<HTMLFormElement>(
      'form[aria-label="Atlas attachment"]',
    );
    check(upload, "Host-enabled attachment form");
    const file = new File(["example evidence"], "example.txt", {
      type: "text/plain",
    });
    // jsdom has no native picker; submit the same ordinary FormData fields.
    const NativeFormData = globalThis.FormData;
    globalThis.FormData = class extends NativeFormData {
      override get(name: string) {
        return name === "file" ? file : super.get(name);
      }
    };
    try {
      const statement =
          upload.querySelector<HTMLInputElement>('[name="statement"]'),
        reasonInput = upload.querySelector<HTMLInputElement>('[name="reason"]'),
        license = upload.querySelector<HTMLSelectElement>('[name="license"]');
      check(statement && reasonInput && license, "Attachment fields");
      statement.value = "Synthetic owner note";
      reasonInput.value = attachmentReason;
      reasonInput.dispatchEvent(new Event("input", { bubbles: true }));
      check(reasonInput.validity.valid, "Valid attachment codepoint reason");
      await act(async () => {
        license.value = "1";
        license.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await act(async () =>
        upload.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
      );
    } finally {
      globalThis.FormData = NativeFormData;
    }
    check(
      Number(refreshes) === 2 &&
        Number(reads) === 3 &&
        JSON.stringify(order) ===
          JSON.stringify(["replace", "refresh", "upload", "refresh"]),
      "Upload then canonical refresh and new revision admission",
    );
    check(
      section
        .querySelector("details pre")
        ?.textContent?.includes("atlas.batch.execute"),
      "Canonical attachment receipt remains visible",
    );
    checks.push(
      "owned attachment intent: unchanged 1024-codepoint reason, file/licence/evidence, fresh guards, host receipt and refresh",
    );
    const close = button("Close");
    close.focus();
    await act(async () => close.click());
    check(
      document.activeElement === button("Edit Atlas place"),
      "Close restores opener focus after commit",
    );
  } finally {
    await act(async () => root.unmount());
  }
  return checks;
}
