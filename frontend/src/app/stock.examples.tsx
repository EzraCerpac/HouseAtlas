/** Ordinary mounted React examples. Dispatch returns fixed canonical fixtures;
 * no domain mutation, browser account, grant or failure control is exercised. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SessionApp } from "./SessionApp";
import { decodeAtlasView } from "./decode";
import type { AtlasSessionInfo } from "./session";
import { stockFamilies } from "../webmcp/stock-schema.js";
import type { StockRequestEnvelope, StockSchemaPort } from "../webmcp/stock.js";
import type {
  JsonValue,
  ModelContextPort,
  RegisteredBrowserTool,
} from "../webmcp/ports.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export async function runHealthyStockApplication(
  container: HTMLElement,
  supplied: {
    readonly view: unknown;
    readonly session: AtlasSessionInfo;
    readonly schemas: StockSchemaPort;
    readonly requests: readonly StockRequestEnvelope[];
    readonly results: readonly JsonValue[];
  },
): Promise<string[]> {
  const view = decodeAtlasView(supplied.view);
  check(
    view.status === "ready",
    "Published authorized synthetic view required",
  );
  const tools = new Map<string, RegisteredBrowserTool>();
  const modelContext: ModelContextPort = {
    registerTool(tool, { signal }) {
      tools.set(tool.name, tool);
      signal.addEventListener("abort", () => tools.delete(tool.name), {
        once: true,
      });
    },
  };
  const requests: StockRequestEnvelope[] = [];
  const root = createRoot(container);
  const checks: string[] = [];
  try {
    await act(async () =>
      root.render(
        <SessionApp
          client={{ load: async () => view, loadHome: async () => view }}
          sessions={{
            session: async () => supplied.session,
            signIn: async () => supplied.session,
          }}
          stock={{
            modelContext,
            admission: {
              scope: view.scope,
              commandIds: supplied.requests.map((request) => request.commandId),
              revision: "synthetic-host-admission:1",
            },
            schemas: supplied.schemas,
            service: {
              async dispatch(request, context) {
                check(
                  JSON.stringify(context.applicationSession) ===
                    JSON.stringify(supplied.session),
                  "Existing session DTO reaches only dispatch",
                );
                check(
                  context.session.revision.startsWith("atlas-ui:"),
                  "Non-secret committed context revision",
                );
                requests.push(request);
                const index = supplied.requests.findIndex(
                  (input) => input.requestId === request.requestId,
                );
                const result = supplied.results[index];
                check(
                  result !== undefined,
                  "Matching fixed canonical result required",
                );
                return structuredClone(result);
              },
            },
          }}
        />,
      ),
    );
    check(
      container.querySelector("h1")?.textContent === "Home",
      "Actual session shell mounts authorized App",
    );
    const families = stockFamilies.families.filter((family) =>
      family.commandIds.some((id) =>
        supplied.requests.some((request) => request.commandId === id),
      ),
    );
    check(
      tools.size === families.length,
      "Exact host-admitted canonical families registered",
    );
    check(
      !JSON.stringify([...tools.values()]).includes(supplied.session.csrfToken),
      "Session nonce is absent from browser metadata",
    );
    checks.push(
      "existing SessionApp, committed scope and host admissions mount canonical families",
    );
    for (const [index, request] of supplied.requests.entries()) {
      const family = families.find((item) =>
        item.commandIds.includes(request.commandId),
      );
      check(family, "Canonical command family required");
      const tool = tools.get(family.toolName);
      check(tool, "Healthy admitted tool is registered");
      let execution: Promise<JsonValue> | undefined;
      await act(async () => {
        execution = tool.execute(request, {
          signal: new AbortController().signal,
        });
        await Promise.resolve();
      });
      const result = await execution;
      check(
        JSON.stringify(result) === JSON.stringify(supplied.results[index]),
        "Canonical result remains complete",
      );
      check(
        JSON.stringify(requests[index]) === JSON.stringify(request),
        "Full request and caller requestId remain intact",
      );
      check(
        container.querySelector(".stock-completion pre")?.textContent ===
          JSON.stringify(result, null, 2),
        "Canonical result subtree committed before execution returns",
      );
      check(
        !container
          .querySelector(".stock-completion")
          ?.textContent?.includes(supplied.session.csrfToken),
        "Session nonce is absent from completion output",
      );
      checks.push(
        `${request.commandId}: complete fixture and actual UI commit before return`,
      );
    }
  } finally {
    await act(async () => root.unmount());
  }
  check(tools.size === 0, "Ordinary unmount releases registrations");
  checks.push("ordinary UI unmount releases the owned mount");
  return checks;
}
