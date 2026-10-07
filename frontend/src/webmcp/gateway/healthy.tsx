/** Healthy injected gateway peers only. No export job or byte transfer runs. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import fixture from "../../../../backend/src/contracts/stock/examples/healthy.json";
import { createStockSchemas } from "../../../integration/stock-schemas.js";
import { stockCatalog, stockInputSchema } from "../stock-schema.js";
import type { CatalogTool, JsonObject, JsonValue, ModelContextPort, RegisteredBrowserTool, ToolAnnotations } from "../ports.js";
import { GatewayWebMcpBoundary } from "./GatewayWebMcpBoundary.js";
import type { GatewayDownloadPort, GatewaySessionPort, GatewayToolBinding } from "./ports.js";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

export async function runGatewayHealthyReact(container: HTMLElement): Promise<readonly string[]> {
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
  const sessions: GatewaySessionPort = {
    getSnapshot: () => ({ state: "authenticated", revision: "healthy-gateway:1" }),
    subscribe: () => () => {},
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
        check(context.session.revision === "healthy-gateway:1" && !context.signal.aborted, "Healthy invocation context");
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
        filename: "healthy.json", mediaType: "application/json", label: "Download file" } : null;
    },
  };
  const root = createRoot(container);
  await act(async () => {
    root.render(<GatewayWebMcpBoundary modelContext={modelContext} sessions={sessions}
      bindings={bindings} downloads={downloads}><p>Healthy host view</p></GatewayWebMcpBoundary>);
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
  await act(async () => root.unmount());
  check(tools.size === 0, "Unmount removes synthetic registrations");
  return ["gateway admitted service intersection and shared schemas", "canonical gateway result visible before return",
    "issued download presentation visible before return", "gateway unmount cleanup"];
}
