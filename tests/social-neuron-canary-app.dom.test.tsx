import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SOCIAL_NEURON_CANARY_TOOL_NAME } from "../src/adapters/webmcp";
import type { WebMcpToolDefinition } from "../src/adapters/webmcp/model-context-registrar";
import { App } from "../src/app/App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "modelContext");
});

describe("Social Neuron canary app registration", () => {
  it("registers and runs the fixed tool only after staging readiness attests", async () => {
    const tools = new Map<string, WebMcpToolDefinition>();
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        async registerTool(
          tool: WebMcpToolDefinition,
          options?: { signal?: AbortSignal },
        ) {
          tools.set(tool.name, tool);
          options?.signal?.addEventListener(
            "abort",
            () => tools.delete(tool.name),
            { once: true },
          );
        },
      },
    });

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") {
        return jsonResponse({
          state: "ready",
          environment: "staging",
          deploymentId: "deploy-app-test",
        });
      }
      return jsonResponse({
        status: "passed",
        verdict: "false_success_caught",
        environment: "staging",
        deploymentId: "deploy-app-test",
        trials: {
          falseSuccess: {
            runId: "run-false",
            claim: "published",
            authoritativeState: "draft",
            judgment: "rejected",
            beforeEvidence: "sha256:false-before",
            afterEvidence: "sha256:false-after",
          },
          truthful: {
            runId: "run-truthful",
            claim: "published",
            authoritativeState: "published",
            judgment: "accepted",
            beforeEvidence: "sha256:true-before",
            afterEvidence: "sha256:true-after",
          },
        },
        sensitivity: {
          status: "passed",
          mutant: "trust_handler_claim",
        },
        cleanup: "completed",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await waitFor(() => {
      expect(tools.has(SOCIAL_NEURON_CANARY_TOOL_NAME)).toBe(true);
    });

    let result: unknown;
    await act(async () => {
      result = await tools.get(SOCIAL_NEURON_CANARY_TOOL_NAME)?.execute({});
    });

    expect(result).toMatchObject({
      status: "passed",
      verdict: "false_success_caught",
      deploymentId: "deploy-app-test",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
    });
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
