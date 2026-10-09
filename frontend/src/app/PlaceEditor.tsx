import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { LocationSemanticsPayloadSemanticKind } from "../api/generated/contracts.js";
import type { StockResultEnvelope } from "../webmcp/stock.js";
import type { AtlasEditingClient, PlaceEditAdmission } from "./editing";
import type { Entry } from "./types";

const kinds: readonly LocationSemanticsPayloadSemanticKind[] = [
  "unclassified",
  "site",
  "building",
  "floor",
  "room",
  "other",
];
const maximumReasonCodePoints = 1024;
function validateReason(field: HTMLInputElement) {
  field.setCustomValidity(
    Array.from(field.value).length > maximumReasonCodePoints
      ? "Use at most 1024 characters for the reason."
      : "",
  );
}
function readReason(form: HTMLFormElement) {
  const field = form.querySelector<HTMLInputElement>('input[name="reason"]');
  if (!field) return null;
  validateReason(field);
  if (!field.reportValidity()) return null;
  return field.value.trim() || null;
}
function ReasonField({ busy }: { busy: boolean }) {
  return (
    <label>
      <span>Reason (maximum 1024 characters)</span>
      <input
        name="reason"
        aria-label="Reason"
        aria-description="Maximum 1024 characters."
        required
        disabled={busy}
        onInput={(event) => validateReason(event.currentTarget)}
      />
    </label>
  );
}
export function PlaceEditor({
  entry,
  client,
  refresh,
}: {
  entry: Entry;
  client: AtlasEditingClient;
  refresh: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const [admission, setAdmission] = useState<PlaceEditAdmission | null>(null);
  const [kind, setKind] =
    useState<LocationSemanticsPayloadSemanticKind>("unclassified");
  const [status, setStatus] = useState(""),
    [receipt, setReceipt] = useState<StockResultEnvelope | null>(null);
  const [licenseSelection, setLicenseSelection] = useState("");
  const active = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const restoreOpener = useRef(false);
  useEffect(() => () => active.current?.abort(), []);
  useLayoutEffect(() => {
    if (!open && restoreOpener.current) {
      restoreOpener.current = false;
      opener.current?.focus();
    }
  }, [open]);
  const source = {
    workspaceId: entry.workspaceId,
    homeId: entry.homeId,
    key: entry.source,
  };
  const load = async (signal: AbortSignal) => {
    const next = await client.loadPlace(source, signal);
    if (signal.aborted) return;
    if (
      next &&
      (next.record.workspaceId !== entry.workspaceId ||
        next.record.homeId !== entry.homeId ||
        next.record.lifecycle !== "active")
    )
      throw new TypeError("Place admission does not match current scope");
    setAdmission(next);
    setLicenseSelection("");
    if (next) setKind(next.record.payload.semanticKind);
    return next;
  };
  const begin = (progress = "Loading Atlas information…") => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setStatus(progress);
    return controller;
  };
  const show = async () => {
    const controller = begin();
    setOpen(true);
    try {
      const next = await load(controller.signal);
      if (!controller.signal.aborted)
        setStatus(
          !next
            ? "Atlas classification is unavailable."
            : next.canReplaceClassification ||
                (next.attachmentPolicy?.licenses.length &&
                  client.uploadPlaceEvidence)
              ? ""
              : "This Atlas place is read-only for your current access.",
        );
    } catch {
      if (!controller.signal.aborted)
        setStatus("Atlas classification could not be loaded.");
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        heading.current?.focus();
      }
    }
  };
  const commit = async (
    action: (signal: AbortSignal) => Promise<StockResultEnvelope>,
    progress: string,
  ) => {
    const controller = begin(progress);
    setReceipt(null);
    let saved = false,
      viewRefreshed = false;
    try {
      const result = await action(controller.signal);
      if (controller.signal.aborted) return;
      const resolved: unknown = result["resolvedScope"];
      if (
        !resolved ||
        typeof resolved !== "object" ||
        Array.isArray(resolved) ||
        !("workspaceId" in resolved) ||
        resolved.workspaceId !== entry.workspaceId ||
        !("homeId" in resolved) ||
        resolved.homeId !== entry.homeId
      )
        throw new TypeError("Completion scope differs");
      setReceipt(result);
      if (result["status"] !== "committed") {
        setStatus("The change was not committed.");
        return;
      }
      saved = true;
      if (!(await refresh()) || controller.signal.aborted) {
        setAdmission(null);
        if (!controller.signal.aborted)
          setStatus(
            "The change was saved. Saved information could not be refreshed.",
          );
        return;
      }
      viewRefreshed = true;
      const next = await load(controller.signal);
      if (!controller.signal.aborted)
        setStatus(
          next
            ? "Saved. Information refreshed."
            : "Saved. Editing is unavailable.",
        );
    } catch {
      if (!controller.signal.aborted) {
        setAdmission(null);
        setStatus(
          saved
            ? viewRefreshed
              ? "The change was saved. Editing information could not be refreshed."
              : "The change was saved. Saved information could not be refreshed."
            : "Completion could not be confirmed. Reload saved information before trying again.",
        );
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  const replace = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !admission?.canReplaceClassification) return;
    const reason = readReason(event.currentTarget);
    if (!reason) return;
    const requestId = crypto.randomUUID(),
      record = admission.record,
      { elevation, ...payload } = record.payload;
    void commit(async (signal) => {
      const result = await client.replacePlace(
        {
          schemaVersion: 3,
          commandId: "atlas.location-semantics.replace",
          requestId,
          context: { workspaceId: record.workspaceId, homeId: record.homeId },
          target: {
            authority: "atlas",
            recordType: "location-semantics",
            recordId: record.recordId,
          },
          payload: {
            ...payload,
            semanticKind: kind,
            ...(kind === "floor" && elevation !== undefined
              ? { elevation: { ...elevation } }
              : {}),
          },
          idempotencyKey: crypto.randomUUID(),
          reason,
          approvalReceiptId: null,
          preconditions: {
            target: { kind: "atlas", value: record.revision },
            guards: admission.guards.map((guard) => ({
              target: { authority: "atlas", ...guard.record },
              revision: { kind: "atlas", value: guard.expectedRevision },
            })),
          },
        },
        signal,
      );
      if (
        result.requestId !== requestId ||
        result["commandId"] !== "atlas.location-semantics.replace"
      )
        throw new TypeError("Place completion correlation differs");
      return result;
    }, "Saving classification…");
  };
  const upload = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !admission?.attachmentPolicy || !client.uploadPlaceEvidence)
      return;
    const reason = readReason(event.currentTarget);
    if (!reason) return;
    const fields = new FormData(event.currentTarget),
      file = fields.get("file");
    const policy = admission.attachmentPolicy,
      licenseValue = fields.get("license");
    const license =
      typeof licenseValue === "string" && licenseValue !== ""
        ? policy.licenses[Number(licenseValue)]
        : undefined;
    const statement = String(fields.get("statement") ?? "").trim();
    if (
      !(file instanceof File) ||
      !file.size ||
      !license ||
      !statement ||
      file.size > policy.maximumBytes ||
      !policy.contentTypes.includes(file.type)
    ) {
      setStatus("Choose a supported file within the displayed size limit.");
      return;
    }
    const uploadFile = client.uploadPlaceEvidence,
      requestId = crypto.randomUUID();
    void commit(async (signal) => {
      const result = await uploadFile(
        {
          requestId,
          idempotencyKey: crypto.randomUUID(),
          context: { workspaceId: entry.workspaceId, homeId: entry.homeId },
          recordId: admission.record.recordId,
          expectedRevision: admission.record.revision,
          guards: admission.guards,
          file,
          statement,
          sourceLicense: license.value,
          reason,
        },
        signal,
      );
      if (
        result.requestId !== requestId ||
        result["commandId"] !== "atlas.batch.execute"
      )
        throw new TypeError("Attachment completion correlation differs");
      return result;
    }, "Uploading attachment…");
  };
  if (!open)
    return (
      <div className="actions">
        <button ref={opener} type="button" onClick={() => void show()}>
          Edit Atlas place
        </button>
      </div>
    );
  const policy = admission?.attachmentPolicy;
  return (
    <section aria-label="Atlas place editing" aria-busy={busy}>
      <h2 ref={heading} tabIndex={-1}>
        Atlas place
      </h2>
      <p role="status" aria-live="polite">
        {status}
      </p>
      {admission?.canReplaceClassification && (
        <div className="setting">
          <form
            className="session-form"
            aria-label="Place classification"
            onSubmit={replace}
          >
            <label>
              <span>Classification</span>
              <select
                name="kind"
                value={kind}
                disabled={busy}
                onChange={(event) =>
                  setKind(
                    event.target.value as LocationSemanticsPayloadSemanticKind,
                  )
                }
              >
                {kinds.map((value) => (
                  <option key={value} value={value}>
                    {value[0]?.toUpperCase()}
                    {value.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <ReasonField busy={busy} />
            <button type="submit" disabled={busy}>
              Save classification
            </button>
          </form>
        </div>
      )}
      {policy && policy.licenses.length > 0 && client.uploadPlaceEvidence && (
        <div className="setting">
          <form
            className="session-form"
            aria-label="Atlas attachment"
            onSubmit={upload}
          >
            <h3>Atlas evidence attachment</h3>
            <label>
              <span>File</span>
              <input
                name="file"
                type="file"
                accept={policy.contentTypes.join(",")}
                required
                disabled={busy}
              />
            </label>
            <p className="muted">
              Maximum {policy.maximumBytes} bytes.{" "}
              {policy.contentTypes.join(", ")}
            </p>
            <label>
              <span>Evidence statement</span>
              <input
                name="statement"
                required
                maxLength={4096}
                disabled={busy}
              />
            </label>
            <label>
              <span>Source licence</span>
              <select
                name="license"
                required
                disabled={busy}
                value={licenseSelection}
                onChange={(event) => setLicenseSelection(event.target.value)}
              >
                <option value="">Choose licence</option>
                {policy.licenses.map((choice, index) => (
                  <option key={index} value={index}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
            <ReasonField busy={busy} />
            <button type="submit" disabled={busy}>
              Upload attachment
            </button>
          </form>
        </div>
      )}
      {receipt && (
        <details className="command-receipt">
          <summary>Command receipt</summary>
          <pre>{JSON.stringify(receipt, null, 2)}</pre>
        </details>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          restoreOpener.current = true;
          setOpen(false);
          setAdmission(null);
          setReceipt(null);
        }}
      >
        Close
      </button>
    </section>
  );
}
