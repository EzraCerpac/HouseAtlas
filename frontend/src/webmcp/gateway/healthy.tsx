/** Healthy injected gateway peers only. No export job or byte transfer runs. */
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import fixture from "../../../../backend/src/contracts/stock/examples/healthy.json";
import { createStockSchemas } from "../../../integration/stock-schemas.js";
import { stockCatalog, stockInputSchema } from "../stock-schema.js";
import type { CatalogTool, JsonObject, JsonValue, ModelContextPort, RegisteredBrowserTool, ToolAnnotations } from "../ports.js";
import { GatewayWebMcpBoundary, type GatewayWebMcpBoundaryProps } from "./GatewayWebMcpBoundary.js";
import type { GatewayDownloadPort, GatewaySessionPort, GatewayToolBinding } from "./ports.js";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

export async function runGatewayHealthyReact(container: HTMLElement,
  options: { readonly freshAvailabilityOnly?: boolean } = {}): Promise<readonly string[]> {
  const request = fixture.requests[0]!;
  const response = fixture.results[0]!.wire as unknown as JsonValue;
  const operation = stockCatalog.commands.find(row => row.commandId === request.commandId)!;
  const schemas = createStockSchemas();
  const tools = new Map<string, RegisteredBrowserTool>();
  const modelContext: ModelContextPort = {
    registerTool(tool, { signal }) {
      tools.set(tool.name, tool);
      signal.addEventListener("abort", () => tools.delete(tool.name), { once: true });
    },
  };
  const applicationSession = { schemaVersion: 1 as const, actorId: "healthy-synthetic-actor",
    csrfToken: "synthetic-marker-no-credential", expiresAt: "2026-12-01T00:00:00Z" };
  let sessionRevision = "healthy-gateway:1";
  const sessionListeners = new Set<() => void>();
  const sessions: GatewaySessionPort = {
    getSnapshot: () => ({ state: "authenticated", revision: sessionRevision }),
    subscribe: listener => {
      sessionListeners.add(listener);
      return () => { sessionListeners.delete(listener); };
    },
    getContext: () => ({ applicationSession, scope: request.context,
      toolNames: ["fixture_gateway_read", "fixture_gateway_download", "fixture_unbound"] }),
  };
  const events: string[] = [];
  const calls: JsonObject[] = [];
  // A valid structural catalog peer can expose metadata through getters. The
  // browser adapter must retain those fields rather than spread own properties.
  class HealthyCatalogTool implements CatalogTool {
    constructor(readonly name: string) {}
    get title() { return "Read healthy fixture"; }
    get description() { return "Read the healthy synthetic fixture through an injected service."; }
    get inputSchema() { return stockInputSchema([operation.inputSchema]); }
    get annotations(): ToolAnnotations {
      return { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false };
    }
    parseInput(value: unknown): JsonObject {
      schemas.validate(operation.inputSchema, value);
      return value as JsonObject;
    }
  }
  const bindings: GatewayToolBinding[] = ["fixture_gateway_read", "fixture_gateway_download", "fixture_not_admitted"]
    .map(name => ({ tool: new HealthyCatalogTool(name),
      service: { async execute(input, context) {
        check(context.applicationSession === applicationSession, "Original session reaches the actual host port");
        check(JSON.stringify(context.scope) === JSON.stringify(request.context), "Selected scope reaches host unchanged");
        check(context.session.revision === sessionRevision && !context.signal.aborted, "Healthy invocation context");
        calls.push(structuredClone(input));
        events.push(`execute:${name}`);
        return structuredClone(response);
      } },
      validateResult(result, input) {
        schemas.validate(operation.outputSchema, result);
        check((result as JsonObject)["requestId"] === input["requestId"], "Owner validates canonical correlation");
        events.push(`validate:${name}`);
      },
    }));
  const downloads: GatewayDownloadPort = {
    async resolve(name, input, result, context) {
      check(input["requestId"] === request.requestId, "Download resolver receives full parsed input");
      check(JSON.stringify(result) === JSON.stringify(response), "Download resolver receives unchanged canonical result");
      check(context.applicationSession === applicationSession, "Download resolver receives current authority context");
      events.push(`download:${name}`);
      return name === "fixture_gateway_download" ? { href: "/synthetic-issued-download/healthy.json",
        filename: "healthy.json", mediaType: "application/json", label: "Download file",
        lifetime: { remainingMs: 299_999 } } : null;
    },
  };
  function HealthyHost({ publishRevision, ...props }: GatewayWebMcpBoundaryProps & { readonly publishRevision?: string }) {
    useLayoutEffect(() => {
      if (publishRevision) {
        sessionRevision = publishRevision;
        for (const listener of sessionListeners) listener();
      }
    }, [publishRevision]);
    return <GatewayWebMcpBoundary {...props} />;
  }
  const root = createRoot(container);
  await act(async () => {
    root.render(<HealthyHost modelContext={modelContext} sessions={sessions}
      bindings={bindings} downloads={downloads}><p>Healthy host view</p></HealthyHost>);
  });
  check(container.querySelector('[aria-label="Gateway tools"]')?.textContent === "registered", "Real React registration state");
  check([...tools.keys()].join(",") === "fixture_gateway_read,fixture_gateway_download", "Only actual admitted-and-bound peers register");
  for (const tool of tools.values()) {
    check(tool.title === "Read healthy fixture" && tool.description === bindings[0]!.tool.description,
      "Getter-backed shared catalog metadata is preserved");
    check(tool.annotations.readOnlyHint && tool.annotations.untrustedContentHint && !tool.annotations.consequentialHint,
      "Owner annotations are preserved");
    check(JSON.stringify(tool.inputSchema) === JSON.stringify(stockInputSchema([operation.inputSchema])), "Owner schema is unchanged");
    check(!JSON.stringify(tool).includes(applicationSession.csrfToken), "Public metadata omits application credentials");
  }
  const names = ["fixture_gateway_read", "fixture_gateway_download"];
  for (const name of names) {
    let resolved = false;
    let result: JsonValue | undefined;
    let execution!: Promise<void>;
    await act(async () => {
      execution = tools.get(name)!.execute(request).then(value => {
        result = value;
        check(container.querySelector(`[data-gateway-tool="${name}"] pre`)?.textContent === JSON.stringify(response, null, 2),
          "Canonical result DOM commits before tool promise returns");
        if (name === "fixture_gateway_download") {
          const link = container.querySelector("a[download]");
          check(link?.getAttribute("href") === "/synthetic-issued-download/healthy.json", "Issued download link commits before return");
          check(link.getAttribute("download") === "healthy.json" && link.getAttribute("type") === "application/json", "Download presentation metadata");
        } else check(!container.querySelector("a[download]"), "Null download remains absent");
        resolved = true;
        events.push(`return:${name}`);
      });
      // Flush the asynchronous service/resolver and React commit without waiting
      // for the execution promise that itself requires that commit.
      await Promise.resolve();
    });
    await execution;
    check(resolved && JSON.stringify(result) === JSON.stringify(response), "Complete unchanged canonical output returned");
    check(JSON.stringify(calls.at(-1)) === JSON.stringify(request), "Full caller envelope preserved");
  }
  check(events.join(",") === names.flatMap(name => [`execute:${name}`, `validate:${name}`, `download:${name}`, `return:${name}`]).join(","),
    "Healthy service, owner validation, download resolution and return ordering");
  if (options.freshAvailabilityOnly) {
    await act(async () => root.unmount());
    check(tools.size === 0, "Fresh available-link example cleans up registrations and its presentation timer");
    return ["gateway admitted service intersection and shared schemas", "canonical gateway result visible before return",
      "fresh owner-budget download presentation visible before return"];
  }
  // All earlier executions have finished. Exercise a normal sequential host
  // remount, not the held pending-call/race or obsolete-consumer controls.
  let firstReplacementCommitObserved = false;
  function ReplacementHostView({ beforePublication }: { readonly beforePublication?: string }) {
    useLayoutEffect(() => {
      check(tools.size === 0, "Previous registrations retire before the replacement child layout");
      check(!container.querySelector("[data-gateway-tool]") && !container.querySelector("a[download]"),
        "First replacement layout commit contains no prior result or link");
      check(container.querySelector('[aria-label="Gateway tools"]')?.textContent === "inactive",
        "First replacement layout commit does not claim the previous catalog is registered");
      if (beforePublication) check(sessionRevision === beforePublication,
        "New render identity masks the prior view before parent layout publishes its session revision");
      firstReplacementCommitObserved = true;
    }, []);
    return <p>Healthy replacement host view</p>;
  }
  const replacementBindings = [...bindings];
  await act(async () => {
    root.render(<HealthyHost modelContext={modelContext} sessions={sessions}
      bindings={replacementBindings} downloads={downloads}><ReplacementHostView /></HealthyHost>);
  });
  check(firstReplacementCommitObserved, "New host's first actual layout commit was observed");
  check([...tools.keys()].length === 2 && !container.querySelector("[data-gateway-tool]"), "New activation starts with current registrations and no old result");
  let nextExecution!: Promise<JsonValue>;
  await act(async () => {
    nextExecution = tools.get("fixture_gateway_read")!.execute(request);
    await Promise.resolve();
  });
  check(JSON.stringify(await nextExecution) === JSON.stringify(response), "Healthy current activation can complete its task");
  check(container.querySelector('[data-gateway-tool="fixture_gateway_read"] pre')?.textContent === JSON.stringify(response, null, 2),
    "Current activation acknowledges the new visible result");

  // A healthy revision publication on the same port object must also select a
  // new view. No executions are pending; actor, scope and admission stay healthy.
  await act(async () => {
    sessionRevision = "healthy-gateway:2";
    for (const listener of sessionListeners) listener();
    root.render(<HealthyHost modelContext={modelContext} sessions={sessions}
      bindings={replacementBindings} downloads={downloads}><ReplacementHostView key="revision:2" /></HealthyHost>);
  });
  check(container.querySelector('[aria-label="Gateway tools"]')?.textContent === "registered",
    "Stable session port revision produces a current registration");
  await act(async () => {
    nextExecution = tools.get("fixture_gateway_read")!.execute(request);
    await Promise.resolve();
  });
  check(JSON.stringify(await nextExecution) === JSON.stringify(response), "Current stable-port revision completes normally");

  // A host that publishes in its parent layout supplies identity before render.
  // The child's first layout observes no old result/status before publication.
  await act(async () => {
    root.render(<HealthyHost modelContext={modelContext} sessions={sessions}
      bindings={replacementBindings} downloads={downloads} renderIdentity="healthy-view:3" publishRevision="healthy-gateway:3">
      <ReplacementHostView key="render:3" beforePublication="healthy-gateway:2" />
    </HealthyHost>);
  });
  check(container.querySelector('[aria-label="Gateway tools"]')?.textContent === "registered",
    "Parent-layout publication settles on the current host view");
  await act(async () => {
    nextExecution = tools.get("fixture_gateway_read")!.execute(request);
    await Promise.resolve();
  });
  check(JSON.stringify(await nextExecution) === JSON.stringify(response), "Explicit host render identity completes normally");
  await act(async () => root.unmount());
  check(tools.size === 0, "Unmount removes synthetic registrations");
  return ["gateway admitted service intersection and shared schemas", "canonical gateway result visible before return",
    "issued download presentation visible before return", "healthy sequential gateway reactivation",
    "stable session revision and parent-layout render identity", "gateway unmount cleanup"];
}
