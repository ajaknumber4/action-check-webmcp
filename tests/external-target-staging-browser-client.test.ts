import { describe, expect, it, vi } from "vitest";

import { BrowserExternalTargetCanaryClient } from "../src/integrations/external-target-staging/browser-client";

const passedReport = {
  status: "passed",
  verdict: "false_success_caught",
  environment: "staging",
  deploymentId: "deploy-browser-test",
  trials: {
    falseSuccess: {
      runId: "run-false",
      claim: "published",
      authoritativeState: "draft",
      judgment: "rejected",
      beforeEvidence: "sha256:false:before",
      afterEvidence: "sha256:false:after",
    },
    truthful: {
      runId: "run-truthful",
      claim: "published",
      authoritativeState: "published",
      judgment: "accepted",
      beforeEvidence: "sha256:true:before",
      afterEvidence: "sha256:true:after",
    },
  },
  sensitivity: { status: "passed", mutant: "trust_handler_claim" },
  cleanup: "completed",
} as const;

describe("browser External Target canary client", () => {
  it("reports the default unconfigured broker as blocked", async () => {
    const client = new BrowserExternalTargetCanaryClient({
      fetch: async () => jsonResponse(503, {
        status: "blocked",
        reason: "STAGING_NOT_CONFIGURED",
        mutationAttempted: false,
        cleanup: "not_needed",
      }),
    });

    await expect(client.probe()).resolves.toEqual({
      state: "blocked",
      reason: "STAGING_NOT_CONFIGURED",
    });
  });

  it("uses one fixed same-origin request with no caller-controlled target", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const client = new BrowserExternalTargetCanaryClient({
      createRequestId: () => "request-browser-01",
      fetch: async (input, init) => {
        calls.push({ input, init });
        return jsonResponse(200, passedReport);
      },
    });

    await expect(client.run()).resolves.toMatchObject({
      status: "passed",
      verdict: "false_success_caught",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("/api/external-target-canary");
    expect(calls[0]?.init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      body: JSON.stringify({ requestId: "request-browser-01" }),
    });
    expect(calls[0]?.init?.headers).toMatchObject({
      "content-type": "application/json",
      "x-action-check-request": "1",
    });
  });

  it("reuses the same request identity after an ambiguous network failure", async () => {
    const bodies: string[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body));
      if (bodies.length === 1) throw new TypeError("connection closed");
      return jsonResponse(200, passedReport);
    });
    const client = new BrowserExternalTargetCanaryClient({
      createRequestId: () => "request-retry-01",
      fetch: fetchMock,
    });

    await expect(client.run()).resolves.toMatchObject({
      status: "blocked",
      reason: "STAGING_REQUEST_FAILED",
    });
    await expect(client.run()).resolves.toMatchObject({ status: "passed" });
    expect(bodies).toEqual([
      JSON.stringify({ requestId: "request-retry-01" }),
      JSON.stringify({ requestId: "request-retry-01" }),
    ]);
  });

  it("forwards caller cancellation instead of converting it to a blocked result", async () => {
    const controller = new AbortController();
    const client = new BrowserExternalTargetCanaryClient({
      fetch: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    });

    const pending = client.run({ signal: controller.signal });
    controller.abort(new DOMException("Caller cancelled", "AbortError"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
