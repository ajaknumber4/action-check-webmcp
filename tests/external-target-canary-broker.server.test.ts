import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createExternalTargetCanaryMiddleware } from "../server/external-target-staging/broker";

type RunningServer = Readonly<{
  origin: string;
  close(): Promise<void>;
}>;

describe("External Target staging broker", () => {
  let upstream: RunningServer;
  let broker: RunningServer;
  let upstreamRequests = 0;
  let prepareRequests = 0;
  let beforeUpstreamResponse:
    | ((
        request: IncomingMessage,
        response: ServerResponse,
      ) => Promise<boolean | void>)
    | undefined;

  beforeEach(async () => {
    upstreamRequests = 0;
    prepareRequests = 0;
    beforeUpstreamResponse = undefined;
    upstream = await startServer(async (request, response) => {
      upstreamRequests += 1;
      if (
        request.method === "POST" &&
        request.url === "/internal/action-check/runs"
      ) {
        prepareRequests += 1;
      }
      const handled = await beforeUpstreamResponse?.(request, response);
      if (handled === true) return;
      await handleUpstream(request, response, upstream.origin);
    });
  });

  afterEach(async () => {
    await broker?.close();
    await upstream?.close();
  });

  it("stays blocked when server-only staging configuration is absent", async () => {
    broker = await startBroker({});

    const response = await runBroker(broker.origin, "request-blocked-01");
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      status: "blocked",
      reason: "STAGING_NOT_CONFIGURED",
      mutationAttempted: false,
      cleanup: "not_needed",
    });
    expect(upstreamRequests).toBe(0);
  });

  it("attests readiness and collapses repeat requests onto one staging run", async () => {
    broker = await startBroker(configuredEnvironment(upstream.origin));

    const statusResponse = await fetch(`${broker.origin}/api/external-target-canary`, {
      headers: { origin: broker.origin, "sec-fetch-site": "same-origin" },
    });
    const status = await statusResponse.json();
    expect(statusResponse.status).toBe(200);
    expect(status).toMatchObject({
      state: "ready",
      environment: "staging",
      deploymentId: "deploy-broker-test",
    });

    const firstResponse = await runBroker(broker.origin, "request-repeat-01");
    const first = await firstResponse.json();
    const requestsAfterFirst = upstreamRequests;
    const secondResponse = await runBroker(broker.origin, "request-repeat-01");
    const second = await secondResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(first).toMatchObject({
      status: "passed",
      verdict: "false_success_caught",
      cleanup: "completed",
    });
    expect(second).toEqual(first);
    expect(upstreamRequests).toBe(requestsAfterFirst);
    expect(JSON.stringify(first)).not.toContain("server-only-test-token");
  });

  it("single-flights concurrent requests that use the same request ID", async () => {
    broker = await startBroker(configuredEnvironment(upstream.origin));
    let attestationArrivals = 0;
    let releaseAttestations!: () => void;
    const attestationGate = new Promise<void>((resolve) => {
      releaseAttestations = resolve;
    });
    const releaseFallback = setTimeout(releaseAttestations, 1_000);
    beforeUpstreamResponse = async (request) => {
      if (
        request.method !== "GET" ||
        request.url !== "/internal/action-check/identity"
      ) {
        return;
      }
      attestationArrivals += 1;
      if (attestationArrivals === 2) {
        clearTimeout(releaseFallback);
        releaseAttestations();
      }
      await attestationGate;
    };

    const firstResponse = runBroker(broker.origin, "request-concurrent-01");
    const secondResponse = runBroker(broker.origin, "request-concurrent-01");

    const [first, second] = await Promise.all([
      firstResponse.then(async (response) => await response.json()),
      secondResponse.then(async (response) => await response.json()),
    ]);

    expect(first).toMatchObject({ status: "passed" });
    expect(second).toEqual(first);
    expect(prepareRequests).toBe(2);
  });

  it("keeps a shared same-ID run alive when its first HTTP waiter disconnects", async () => {
    let brokerPostArrivals = 0;
    let followerArrived!: () => void;
    const followerArrival = new Promise<void>((resolve) => {
      followerArrived = resolve;
    });
    broker = await startBroker(configuredEnvironment(upstream.origin), {
      onRequest(request) {
        if (
          request.method === "POST" &&
          request.url === "/api/external-target-canary"
        ) {
          brokerPostArrivals += 1;
          if (brokerPostArrivals === 2) followerArrived();
        }
      },
    });

    let sharedRunStarted!: () => void;
    let releaseSharedRun!: () => void;
    const runStarted = new Promise<void>((resolve) => {
      sharedRunStarted = resolve;
    });
    const runGate = new Promise<void>((resolve) => {
      releaseSharedRun = resolve;
    });
    beforeUpstreamResponse = async (request) => {
      if (
        request.method === "POST" &&
        request.url === "/internal/action-check/runs" &&
        prepareRequests === 1
      ) {
        sharedRunStarted();
        await runGate;
      }
    };

    const leaderAbort = new AbortController();
    const leader = runBroker(broker.origin, "request-shared-abort-01", {
      signal: leaderAbort.signal,
    });
    await runStarted;
    const follower = runBroker(broker.origin, "request-shared-abort-01");
    await followerArrival;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    leaderAbort.abort(new DOMException("Leader disconnected", "AbortError"));
    releaseSharedRun();

    await expect(leader).rejects.toMatchObject({ name: "AbortError" });
    const followerResponse = await follower;
    expect(followerResponse.status).toBe(200);
    expect(await followerResponse.json()).toMatchObject({
      status: "passed",
      verdict: "false_success_caught",
    });
    expect(prepareRequests).toBe(2);
  });

  it("rejects a different request ID while another canary run is active", async () => {
    broker = await startBroker(configuredEnvironment(upstream.origin));
    let activeRunStarted!: () => void;
    let releaseActiveRun!: () => void;
    const runStarted = new Promise<void>((resolve) => {
      activeRunStarted = resolve;
    });
    const runGate = new Promise<void>((resolve) => {
      releaseActiveRun = resolve;
    });
    beforeUpstreamResponse = async (request) => {
      if (
        request.method === "POST" &&
        request.url === "/internal/action-check/runs" &&
        prepareRequests === 1
      ) {
        activeRunStarted();
        await runGate;
      }
    };

    const active = runBroker(broker.origin, "request-active-first-01");
    await runStarted;
    const competing = await runBroker(
      broker.origin,
      "request-active-second-01",
    );

    expect(competing.status).toBe(429);
    expect(await competing.json()).toEqual({
      status: "blocked",
      reason: "CANARY_BUSY",
      mutationAttempted: false,
      cleanup: "not_needed",
    });
    releaseActiveRun();
    expect(await (await active).json()).toMatchObject({ status: "passed" });
    expect(prepareRequests).toBe(2);
  });

  it("returns bounded failures to same-ID waiters and evicts a failed upstream run", async () => {
    let brokerPostArrivals = 0;
    let followerArrived!: () => void;
    const followerArrival = new Promise<void>((resolve) => {
      followerArrived = resolve;
    });
    broker = await startBroker(configuredEnvironment(upstream.origin), {
      onRequest(request) {
        if (
          request.method === "POST" &&
          request.url === "/api/external-target-canary"
        ) {
          brokerPostArrivals += 1;
          if (brokerPostArrivals === 2) followerArrived();
        }
      },
    });

    let identityRequests = 0;
    let failingRunAttested!: () => void;
    let releaseFailure!: () => void;
    const runAttestation = new Promise<void>((resolve) => {
      failingRunAttested = resolve;
    });
    const failureGate = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });
    beforeUpstreamResponse = async (request, response) => {
      if (
        request.method !== "GET" ||
        request.url !== "/internal/action-check/identity"
      ) {
        return;
      }
      identityRequests += 1;
      if (identityRequests !== 2) return;
      failingRunAttested();
      await failureGate;
      response.destroy();
      return true;
    };

    const leader = runBroker(broker.origin, "request-failure-retry-01");
    await runAttestation;
    const follower = runBroker(broker.origin, "request-failure-retry-01");
    await followerArrival;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    releaseFailure();

    const [leaderResponse, followerResponse] = await Promise.all([
      leader,
      follower,
    ]);
    expect(leaderResponse.status).toBe(502);
    expect(followerResponse.status).toBe(502);
    const leaderFailure = await leaderResponse.json();
    expect(await followerResponse.json()).toEqual(leaderFailure);
    expect(leaderFailure).toEqual({
      status: "blocked",
      reason: "REMOTE_FAILURE",
      mutationAttempted: false,
      cleanup: "not_needed",
    });

    beforeUpstreamResponse = undefined;
    const retried = await runBroker(
      broker.origin,
      "request-failure-retry-01",
    );
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({ status: "passed" });
    expect(prepareRequests).toBe(2);
  });

  it("rejects caller-supplied environment and URL fields before contacting staging", async () => {
    broker = await startBroker(configuredEnvironment(upstream.origin));

    const response = await fetch(`${broker.origin}/api/external-target-canary`, {
      method: "POST",
      headers: brokerHeaders(broker.origin),
      body: JSON.stringify({
        requestId: "request-invalid-01",
        environment: "staging",
        url: upstream.origin,
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: "blocked",
      reason: "INVALID_REQUEST",
      mutationAttempted: false,
      cleanup: "not_needed",
    });
    expect(upstreamRequests).toBe(0);
  });

  it("rejects cross-origin mutation requests before contacting staging", async () => {
    broker = await startBroker(configuredEnvironment(upstream.origin));

    const response = await fetch(`${broker.origin}/api/external-target-canary`, {
      method: "POST",
      headers: brokerHeaders("https://attacker.example"),
      body: JSON.stringify({ requestId: "request-cross-origin-01" }),
    });

    expect(response.status).toBe(403);
    expect(upstreamRequests).toBe(0);
  });
});

function configuredEnvironment(upstreamOrigin: string): NodeJS.ProcessEnv {
  return {
    EXTERNAL_TARGET_STAGING_CANARY_URL: upstreamOrigin,
    EXTERNAL_TARGET_STAGING_CANARY_TOKEN: "server-only-test-token",
    EXTERNAL_TARGET_STAGING_DEPLOYMENT_ID: "deploy-broker-test",
    EXTERNAL_TARGET_STAGING_COMMIT_SHA: "abcdef123456",
  };
}

async function startBroker(
  environment: NodeJS.ProcessEnv,
  options: Readonly<{
    onRequest?: (request: IncomingMessage) => void;
  }> = {},
): Promise<RunningServer> {
  const middleware = createExternalTargetCanaryMiddleware({ environment });
  return await startServer(async (request, response) => {
    options.onRequest?.(request);
    await middleware(request, response, () => {
      response.writeHead(404).end();
    });
  });
}

async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
): Promise<RunningServer> {
  const server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () =>
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

async function runBroker(
  origin: string,
  requestId: string,
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<Response> {
  return await fetch(`${origin}/api/external-target-canary`, {
    method: "POST",
    headers: brokerHeaders(origin),
    body: JSON.stringify({ requestId }),
    signal: options.signal,
  });
}

function brokerHeaders(origin: string): Record<string, string> {
  return {
    "content-type": "application/json",
    origin,
    "sec-fetch-site": "same-origin",
    "x-action-check-request": "1",
  };
}

async function handleUpstream(
  request: IncomingMessage,
  response: ServerResponse,
  origin: string,
): Promise<void> {
  const body = await readBody(request);
  if (request.method === "GET" && request.url === "/internal/action-check/identity") {
    return json(response, 200, {
      service: "external-target",
      environment: "staging",
      deploymentId: "deploy-broker-test",
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
    upstreamState.set(runId, { trial: parsed.trial, reads: 0 });
    return json(response, 201, {
      runId,
      trial: parsed.trial,
      fixtureAlias: "publish-post-fixture",
      leaseExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      attestationDigest: "sha256:attestation",
    });
  }

  const match = request.url?.match(/^\/internal\/action-check\/runs\/(run-[a-z_]+)(\/execute)?$/);
  if (!match) return json(response, 404, { error: "not_found" });
  const runId = match[1]!;
  const state = upstreamState.get(runId)!;
  if (request.method === "POST" && match[2] === "/execute") {
    const parsed = JSON.parse(body) as { requestId: string };
    return json(response, 202, {
      runId,
      trial: state.trial,
      requestId: parsed.requestId,
      status: "published",
      externalIdPresent: true,
    });
  }
  if (request.method === "GET" && !match[2]) {
    state.reads += 1;
    const after = state.reads > 1;
    const truthful = state.trial === "truthful_success";
    return json(response, 200, {
      runId,
      trial: state.trial,
      sequence: after ? 2 : 1,
      post: after
        ? { status: "posted", version: "v2", externalIdPresent: true, publishedAtPresent: true }
        : { status: "approved", version: "v1", externalIdPresent: false, publishedAtPresent: false },
      job: after
        ? { status: "completed", attemptCount: 1 }
        : { status: "ready", attemptCount: 0 },
      sink: after && truthful
        ? { status: "published", deliveryCount: 1, receiptPresent: true }
        : { status: "draft", deliveryCount: 0, receiptPresent: false },
      evidence: {
        source: "external-target-staging",
        attestationDigest: "sha256:attestation",
        observedAt: after ? "2026-08-30T10:00:01.000Z" : "2026-08-30T10:00:00.000Z",
        digest: `sha256:${runId}:${after ? "after" : "before"}`,
      },
    });
  }
  if (request.method === "DELETE" && !match[2]) {
    response.writeHead(204).end();
    return;
  }
  json(response, 405, { error: "method_not_allowed" });
}

const upstreamState = new Map<
  string,
  { trial: "false_success" | "truthful_success"; reads: number }
>();

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
