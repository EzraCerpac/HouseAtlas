/** Healthy sequential host updates; no delayed calls or access controls. */
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import type { Scope } from "../api/generated/contracts.js";
import type {
  JsonValue,
  ModelContextPort,
  RegisteredBrowserTool,
} from "../webmcp/ports.js";
import type { StockRequestEnvelope, StockSchemaPort } from "../webmcp/stock.js";
import { stockFamilies } from "../webmcp/stock-schema.js";
import { StockApplication, type StockAdmission } from "./StockApplication";
import type { AtlasSessionInfo } from "./session";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

export async function runHealthyRenderIdentity(
  container: HTMLElement,
  supplied: {
    readonly session: AtlasSessionInfo;
    readonly scope: Scope;
    readonly schemas: StockSchemaPort;
    readonly request: StockRequestEnvelope;
    readonly result: JsonValue;
  },
): Promise<string[]> {
  const tools = new Map<string, RegisteredBrowserTool>();
  const modelContext: ModelContextPort = {
    registerTool(tool, { signal }) {
      tools.set(tool.name, tool);
      signal.addEventListener("abort", () => tools.delete(tool.name), {
        once: true,
      });
    },
  };
  const family = stockFamilies.families.find((entry) =>
    entry.commandIds.includes(supplied.request.commandId),
  );
  check(family, "Healthy command family required");
  let session = supplied.session;
  let scope: Scope = supplied.scope;
  let revision = "synthetic-admission:1";
  let admission: StockAdmission = {
    scope,
    commandIds: [supplied.request.commandId],
    get revision() {
      return revision;
    },
  };
  const service = {
    async dispatch() {
      return structuredClone(supplied.result);
    },
  };
  const root = createRoot(container);
  let firstLayout: boolean | undefined;
  let expectedVisible = false;
  function View({ commit }: { readonly commit: (scope: Scope) => void }) {
    useLayoutEffect(() => {
      firstLayout ??= !!container.querySelector(".stock-completion");
      commit(scope);
    });
    return <h1>Healthy example</h1>;
  }
  const render = async () => {
    firstLayout = undefined;
    await act(async () =>
      root.render(
        <StockApplication
          session={session}
          ports={{
            admission,
            modelContext,
            schemas: supplied.schemas,
            service,
          }}
        >
          {(commit) => <View commit={commit} />}
        </StockApplication>,
      ),
    );
    check(
      firstLayout === expectedVisible,
      "Expected result visibility in first child layout",
    );
  };
  const execute = async () => {
    const tool = tools.get(family.toolName);
    check(tool, "Healthy tool registered after committed publication");
    let pending: Promise<JsonValue> | undefined;
    await act(async () => {
      pending = tool.execute(supplied.request, {
        signal: new AbortController().signal,
      });
      await Promise.resolve();
    });
    const result = await pending;
    check(
      JSON.stringify(result) === JSON.stringify(supplied.result),
      "Full canonical result returned",
    );
    check(
      container.querySelector(".stock-completion pre")?.textContent ===
        JSON.stringify(result, null, 2),
      "Canonical result committed before return",
    );
  };
  const checks: string[] = [];
  try {
    await render();
    await execute();
    expectedVisible = true;
    await render();
    checks.push(
      "stable host render retains the completed result in first child layout",
    );
    expectedVisible = false;
    session = { ...session };
    await render();
    await execute();
    checks.push(
      "session replacement masks the prior result before parent publication",
    );
    admission = {
      ...admission,
      commandIds: [...admission.commandIds],
      get revision() {
        return revision;
      },
    };
    await render();
    await execute();
    checks.push(
      "admission replacement masks the prior result before parent publication",
    );
    revision = "synthetic-admission:2";
    await render();
    await execute();
    checks.push(
      "admission revision update masks the prior result before parent publication",
    );
    // A healthy new scope is learned through the normal child commit callback.
    // Its parent render follows that callback; it is not a pre-render view signal.
    scope = { ...scope };
    expectedVisible = true;
    await render();
    checks.push("equivalent committed scope retains the current result");
  } finally {
    await act(async () => root.unmount());
  }
  check(tools.size === 0, "Ordinary unmount releases registrations");
  checks.push("ordinary unmount releases the owned mount");
  return checks;
}
