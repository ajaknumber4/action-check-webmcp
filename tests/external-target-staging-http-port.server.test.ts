import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createExternalTargetPublishCanary } from "../src/integrations/external-target-staging";
import { HttpExternalTargetStagingPort } from "../server/external-target-staging/http-port";

type RecordedRequest = Readonly<{
  method: string;
  url: string;
  authorization: string | undefined;
  contract: string | undefined;
  body: string;
}>;

describe("HTTP External Target staging port", () => {
  let origin = "";
  let malformedAttestation = false;
  const requests: RecordedRequest[] = [];
  const readsByRun = new Map<string, number>();
  const trialByRun = new Map<string, "false_success" | "truthful_success">();
  const server = createServer(
    async (request: IncomingMessage, response: ServerResponse) => {
      const body = await readBody(request);
      requests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        authorization: request.headers.authorization,
        contract: headerValue(request.headers["x-action-check-contract"]),
        body,
      });

      if (request.method === "GET" && request.url === "/internal/action-check/identity") {
        return json(response, 200, malformedAttestation
          ? { environment: "staging" }
          : {
              service: "external-target",
              environment: "staging",
              deploymentId: "deploy-test",
              commitSha: "abcdef123456",
              origin,
              projectAlias: "webmcp-canary",
              accountAlias: "canary-social-account",
              capability: "publish-canary-v1",
              canaryEnabled: true,
              databaseIsolation: "isolated",
              providerMode: "canary_sink",
              liveProviderCredentialsPresent: false,
              liveProviderEgressEnabled: false,
              workerMode: "production_lifecycle",
              attestationDigest: "sha256:attestation",
            });
      }

      if (request.method === "POST" && request.url === "/internal/action-check/runs") {
        const parsed = JSON.parse(body) as {
          trial: "false_success" | "truthful_success";
          requestId: string;
        };
        const runId = `run-${parsed.trial}`;
        trialByRun.set(runId, parsed.trial);
        return json(response, 201, {
          runId,
          trial: parsed.trial,
          fixtureAlias: "publish-post-fixture",
          leaseExpiresAt: "2026-08-30T10:05:00.000Z",
          attestationDigest: "sha256:attestation",
        });
      }

      const match = request.url?.match(/^\/internal\/action-check\/runs\/(run-[a-z_]+)(\/execute)?$/);
      if (match) {
        const runId = match[1]!;
        const trial = trialByRun.get(runId)!;
        if (request.method === "POST" && match[2] === "/execute") {
          const parsed = JSON.parse(body) as { requestId: string };
          return json(response, 202, {
            runId,
            trial,
            requestId: parsed.requestId,
            status: "published",
            externalIdPresent: true,
          });
        }
        if (request.method === "GET" && !match[2]) {
          const read = (readsByRun.get(runId) ?? 0) + 1;
          readsByRun.set(runId, read);
          const after = read > 1;
          const truthful = trial === "truthful_success";
          return json(response, 200, {
            runId,
            trial,
            sequence: after ? 2 : 1,
            post: after
              ? {
                  status: "posted",
                  version: "v2",
                  externalIdPresent: true,
                  publishedAtPresent: true,
                }
              : {
                  status: "approved",
                  version: "v1",
                  externalIdPresent: false,
                  publishedAtPresent: false,
                },
            job: after
              ? { status: "completed", attemptCount: 1 }
              : { status: "ready", attemptCount: 0 },
            sink: after && truthful
              ? { status: "published", deliveryCount: 1, receiptPresent: true }
              : { status: "draft", deliveryCount: 0, receiptPresent: false },
            evidence: {
              source: "external-target-staging",
              attestationDigest: "sha256:attestation",
              observedAt: after
                ? "2026-08-30T10:00:01.000Z"
                : "2026-08-30T10:00:00.000Z",
              digest: `sha256:${runId}:${after ? "after" : "before"}`,
            },
          });
        }
        if (request.method === "DELETE" && !match[2]) {
          response.writeHead(204);
          return response.end();
        }
      }

      return json(response, 404, { error: "not_found" });
    },
  );

  beforeEach(async () => {
    requests.length = 0;
    readsByRun.clear();
    trialByRun.clear();
    malformedAttestation = false;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("runs both fixed trials over bounded authenticated HTTP calls", async () => {
    const port = new HttpExternalTargetStagingPort({
      baseUrl: origin,
      credential: async () => "test-only-token",
    });
    const report = await createExternalTargetPublishCanary({
      port,
      expectedIdentity: {
        service: "external-target",
        environment: "staging",
        deploymentId: "deploy-test",
        commitSha: "abcdef123456",
        origin,
        projectAlias: "webmcp-canary",
        accountAlias: "canary-social-account",
        capability: "publish-canary-v1",
        canaryEnabled: true,
        databaseIsolation: "isolated",
        providerMode: "canary_sink",
        liveProviderCredentialsPresent: false,
        liveProviderEgressEnabled: false,
        workerMode: "production_lifecycle",
      },
      createId: () => "suite-http",
      now: () => Date.parse("2026-08-30T10:00:00.000Z"),
    }).run();

    expect(report.status).toBe("passed");
    expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
      "GET /internal/action-check/identity",
      "POST /internal/action-check/runs",
      "GET /internal/action-check/runs/run-false_success",
      "POST /internal/action-check/runs/run-false_success/execute",
      "GET /internal/action-check/runs/run-false_success",
      "DELETE /internal/action-check/runs/run-false_success",
      "POST /internal/action-check/runs",
      "GET /internal/action-check/runs/run-truthful_success",
      "POST /internal/action-check/runs/run-truthful_success/execute",
      "GET /internal/action-check/runs/run-truthful_success",
      "DELETE /internal/action-check/runs/run-truthful_success",
    ]);
    expect(requests.every(({ authorization }) => authorization === "Bearer test-only-token")).toBe(true);
    expect(requests.every(({ contract }) => contract === "external-publish-canary-v1")).toBe(true);
    expect(requests.find(({ url }) => url.endsWith("/execute"))?.body).toBe(
      JSON.stringify({ requestId: "suite-http-false_success" }),
    );
  });

  it("rejects malformed boundary evidence without including the bearer in the error", async () => {
    malformedAttestation = true;
    const port = new HttpExternalTargetStagingPort({
      baseUrl: origin,
      credential: async () => "never-leak-this-token",
    });

    await expect(port.attest()).rejects.toMatchObject({
      name: "ExternalTargetStagingResponseError",
      code: "MALFORMED_STAGING_RESPONSE",
    });
    await expect(port.attest()).rejects.not.toThrow("never-leak-this-token");
  });

  it("rejects non-local plaintext upstreams before obtaining a credential", async () => {
    let credentialReads = 0;

    expect(
      () =>
        new HttpExternalTargetStagingPort({
          baseUrl: "http://staging.example.test",
          credential: async () => {
            credentialReads += 1;
            return "unused";
          },
        }),
    ).toThrow(/HTTPS/);
    expect(credentialReads).toBe(0);
  });

  it("keeps the request timeout active while reading the evidence body", async () => {
    const fetchWithStalledBody: typeof fetch = async (_input, init) => {
      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const abort = () =>
            controller.error(
              signal?.reason ?? new DOMException("Timed out", "AbortError"),
            );
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort, { once: true });
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const port = new HttpExternalTargetStagingPort({
      baseUrl: origin,
      credential: async () => "test-only-token",
      fetch: fetchWithStalledBody,
      requestTimeoutMs: 10,
    });

    await expect(port.attest()).rejects.toMatchObject({ name: "AbortError" });
  });
});

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
