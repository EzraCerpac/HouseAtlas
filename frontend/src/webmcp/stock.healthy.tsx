/** Healthy mounted React integration only; service dispatch is a synthetic port. */
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../app/App.js";
import type { ReadyView } from "../app/types.js";
import type { AtlasSessionInfo } from "../app/session.js";
import { StockWebMcpBoundary } from "./StockWebMcpBoundary.js";
import { stockCatalog, stockFamilies, stockInputSchema } from "./stock-schema.js";
import type { StockCompletion, StockRequestEnvelope, StockSchemaPort, StockSessionPort } from "./stock.js";
import type { JsonValue, ModelContextPort, RegisteredBrowserTool } from "./ports.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export interface StockHealthyInputs {
  readonly view: ReadyView;
  readonly session: AtlasSessionInfo;
  readonly schemas: StockSchemaPort;
  readonly validateBrowserInput: (schema: JsonValue, request: unknown) => void;
  readonly requests: readonly StockRequestEnvelope[];
  readonly responses: readonly JsonValue[];
}
function ResultView({ completion, events }: {
  readonly completion: StockCompletion | null; readonly events: string[];
}) {
  useLayoutEffect(() => {
    if (completion) events.push(`visible:${completion.result.requestId}`);
  }, [completion, events]);
  return <output id="stock-visible-result" aria-label="Stock result">{completion ? JSON.stringify(completion.result) : ""}</output>;
}

/** Run with jsdom only; no browser registration, HTTP listener or provider. */
export async function runStockHealthyReact(container: HTMLElement, supplied: StockHealthyInputs): Promise<string[]> {
  const tools = new Map<string, RegisteredBrowserTool>();
  const registrations: RegisteredBrowserTool[] = [];
  const modelContext: ModelContextPort = {
    async registerTool(tool, { signal }) {
      tools.set(tool.name, tool);
      registrations.push(tool);
      signal.addEventListener("abort", () => {
        if (tools.get(tool.name) === tool) tools.delete(tool.name);
      }, { once: true });
    },
  };
  const revision = "healthy-native-session/selected-home-1";
  const commandIds = supplied.requests.map(request => request.commandId);
  const sessions: StockSessionPort = {
    getSnapshot: () => ({ state: "authenticated", revision }),
    subscribe: () => () => {},
    getContext: () => ({ session: supplied.session, scope: supplied.view.scope, commandIds }),
  };
  const events: string[] = [];
  const calls: StockRequestEnvelope[] = [];
  const client = { load: async () => supplied.view, loadHome: async () => supplied.view };
  const root = createRoot(container);
  await act(async () => {
    root.render(<StockWebMcpBoundary modelContext={modelContext} sessions={sessions} schemas={supplied.schemas}
      service={{ async dispatch(request, context) {
        check(context.applicationSession === supplied.session, "Existing application session reaches only host dispatch");
        check(context.session.revision === revision, "Session revision is preserved");
        check(!context.signal.aborted, "Healthy dispatch signal remains active");
        calls.push(request);
        events.push(`dispatch:${request.requestId}`);
        const index = supplied.requests.findIndex(item => item.requestId === request.requestId);
        const response = supplied.responses[index];
        check(response !== undefined, "Healthy native envelope has matching result fixture");
        return structuredClone(response);
      } }}>
      {state => <><App client={client} initialView={supplied.view}
        session={{ expiresAt: supplied.session.expiresAt }} />
        <ResultView completion={state.completion} events={events} />
        <output id="stock-registration">{state.registration.state}</output></>}
    </StockWebMcpBoundary>);
  });
  check(container.querySelector("#stock-registration")?.textContent === "registered", "Actual React boundary observes registration");
  check(container.querySelector("#page-heading"), "Existing HouseAtlas App is mounted beside committed result");
  const expectedFamilies = stockFamilies.families.filter(family => family.commandIds.some(id => commandIds.includes(id)));
  check(tools.size === expectedFamilies.length, "Only current host-listed canonical families are registered");
  for (const tool of tools.values()) {
    const family = expectedFamilies.find(item => item.toolName === tool.name);
    check(family, "Name comes from exact stock family catalog");
    check(!JSON.stringify(tool).includes(supplied.session.csrfToken), "Session CSRF is absent from public tool metadata");
    const commands = stockCatalog.commands.filter(command => family.commandIds.includes(command.commandId) && commandIds.includes(command.commandId));
    check(JSON.stringify(tool.inputSchema) === JSON.stringify(stockInputSchema(commands.map(command => command.inputSchema))), "Browser schema comes from exact shared arms");
  }
  const passed = ["canonical families and offline schemas mounted with the existing React App"];
  for (const [index, request] of supplied.requests.entries()) {
    const family = stockFamilies.families.find(item => item.commandIds.includes(request.commandId));
    check(family, "Healthy request has canonical family");
    const tool = tools.get(family.toolName);
    check(tool, "Host admitted the healthy operation family");
    supplied.validateBrowserInput(tool.inputSchema, request);
    let invocation: Promise<JsonValue> | undefined;
    await act(async () => {
      invocation = tool.execute(request, { signal: new AbortController().signal });
      // Flush healthy service microtasks; do not await a commit-dependent promise
      // inside act's callback before React is allowed to commit its update.
      await Promise.resolve();
    });
    const output = await invocation;
    events.push(`returned:${request.requestId}`);
    check(JSON.stringify(output) === JSON.stringify(supplied.responses[index]), "Entire canonical wire result survives transport");
    check(container.querySelector("#stock-visible-result")?.textContent === JSON.stringify(output), "DOM result is committed before execute resolves");
    check(JSON.stringify(calls[index]) === JSON.stringify(request), "Dispatch retains complete request, requestId and optional/null fields");
    const order = events.filter(event => event.endsWith(request.requestId));
    check(JSON.stringify(order) === JSON.stringify([`dispatch:${request.requestId}`, `visible:${request.requestId}`, `returned:${request.requestId}`]), "Actual layout effect acknowledges the visible completion first");
    passed.push(`${request.commandId}: exact native envelope and visible completion`);
  }
  const count = registrations.length;
  await act(async () => root.unmount());
  check(tools.size === 0 && registrations.length === count, "Unmount cleans registrations without creating new ones");
  passed.push("React unmount removes all canonical tool registrations");
  return passed;
}
