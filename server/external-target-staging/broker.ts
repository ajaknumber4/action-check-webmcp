import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod";

import {
  createExternalTargetPublishCanary,
  validateCanaryIdentity,
} from "../../src/integrations/external-target-staging/create-external-target-publish-canary.ts";
import type {
  ExpectedCanaryIdentity,
  ExternalTargetCanaryReport,
} from "../../src/integrations/external-target-staging/interface.ts";
import { HttpExternalTargetStagingPort } from "./http-port.ts";

const BROKER_PATH = "/api/external-target-canary";
const MAX_REQUEST_BYTES = 512;
const MAX_CACHE_ENTRIES = 64;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,159}$/;

const requestSchema = z
  .object({ requestId: z.string().regex(REQUEST_ID) })
  .strict();

type Next = (error?: unknown) => void;

type BrokerOptions = Readonly<{
  environment?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}>;

type BrokerConfig = Readonly<{
  port: HttpExternalTargetStagingPort;
  expectedIdentity: ExpectedCanaryIdentity;
}>;

export type ExternalTargetCanaryMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: Next,
) => Promise<void>;

export function createExternalTargetCanaryMiddleware(
  options: BrokerOptions = {},
): ExternalTargetCanaryMiddleware {
  const environment = options.environment ?? process.env;
  const configured = readConfiguration(environment, options.fetch);
  const cachedRuns = new Map<string, Promise<ExternalTargetCanaryReport>>();
  let activeRequestId: string | null = null;

  return async (request, response, next) => {
    const requestUrl = new URL(request.url ?? "/", "http://action-check.local");
    if (requestUrl.pathname !== BROKER_PATH) {
      next();
      return;
    }

    setSafeHeaders(response);

    if (request.method === "GET") {
      if (!configured) {
        writeJson(response, 503, blocked("STAGING_NOT_CONFIGURED"));
        return;
      }
      const readiness = await attestReadiness(configured, request);
      writeJson(response, readiness.ready ? 200 : 503, readiness.body);
      return;
    }

    if (request.method !== "POST") {
      response.setHeader("allow", "GET, POST");
      writeJson(response, 405, blocked("METHOD_NOT_ALLOWED"));
      return;
    }

    if (!isSameOriginMutation(request)) {
      writeJson(response, 403, blocked("CROSS_ORIGIN_REQUEST"));
      return;
    }
    if (!(request.headers["content-type"] ?? "").toLowerCase().includes("application/json")) {
      writeJson(response, 415, blocked("INVALID_REQUEST"));
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(await readBoundedRequest(request, MAX_REQUEST_BYTES));
    } catch {
      writeJson(response, 400, blocked("INVALID_REQUEST"));
      return;
    }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      writeJson(response, 400, blocked("INVALID_REQUEST"));
      return;
    }
    if (!configured) {
      writeJson(response, 503, blocked("STAGING_NOT_CONFIGURED"));
      return;
    }

    const requestId = parsed.data.requestId;
    const cached = cachedRuns.get(requestId);
    if (cached) {
      await writeRunResponse(response, cached);
      return;
    }

    if (activeRequestId !== null) {
      writeJson(response, 429, blocked("CANARY_BUSY"));
      return;
    }

    const readiness = await attestReadiness(configured, request);
    if (!readiness.ready) {
      writeJson(response, 503, readiness.body);
      return;
    }

    const concurrent = cachedRuns.get(requestId);
    if (concurrent) {
      await writeRunResponse(response, concurrent);
      return;
    }

    if (activeRequestId !== null) {
      writeJson(response, 429, blocked("CANARY_BUSY"));
      return;
    }

    activeRequestId = requestId;
    const canary = createExternalTargetPublishCanary({
      port: configured.port,
      expectedIdentity: configured.expectedIdentity,
    });
    const run = canary.run({ requestId });
    cacheRun(cachedRuns, requestId, run);
    void run.then(
      (report) => {
        if (shouldEvictRun(report)) {
          evictRun(cachedRuns, requestId, run);
        }
      },
      () => evictRun(cachedRuns, requestId, run),
    );

    try {
      await writeRunResponse(response, run);
    } finally {
      if (activeRequestId === requestId) activeRequestId = null;
    }
  };
}

function readConfiguration(
  environment: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch | undefined,
): BrokerConfig | null {
  const baseUrl = environment.EXTERNAL_TARGET_STAGING_CANARY_URL;
  const token = environment.EXTERNAL_TARGET_STAGING_CANARY_TOKEN;
  const deploymentId = environment.EXTERNAL_TARGET_STAGING_DEPLOYMENT_ID;
  const commitSha = environment.EXTERNAL_TARGET_STAGING_COMMIT_SHA;
  if (!baseUrl || !token || !deploymentId || !commitSha) return null;

  let origin: string;
  let port: HttpExternalTargetStagingPort;
  try {
    origin = new URL(baseUrl).origin;
    port = new HttpExternalTargetStagingPort({
      baseUrl,
      credential: async () => token,
      fetch: fetchImpl,
    });
  } catch {
    return null;
  }

  return {
    port,
    expectedIdentity: Object.freeze({
      service: "external-target",
      environment: "staging",
      deploymentId,
      commitSha,
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
    }),
  };
}

async function attestReadiness(
  config: BrokerConfig,
  request: IncomingMessage,
): Promise<
  | Readonly<{
      ready: true;
      body: Readonly<{
        state: "ready";
        environment: "staging";
        deploymentId: string;
      }>;
    }>
  | Readonly<{
      ready: false;
      body: ReturnType<typeof blocked>;
    }>
> {
  const controller = new AbortController();
  const abort = () => controller.abort(new DOMException("Browser request closed", "AbortError"));
  request.once("aborted", abort);
  try {
    const attestation = await config.port.attest({ signal: controller.signal });
    if (validateCanaryIdentity(attestation, config.expectedIdentity)) {
      return { ready: false, body: blocked("STAGING_ATTESTATION_FAILED") };
    }
    return {
      ready: true,
      body: {
        state: "ready",
        environment: "staging",
        deploymentId: attestation.deploymentId,
      },
    };
  } catch {
    return { ready: false, body: blocked("STAGING_ATTESTATION_FAILED") };
  } finally {
    request.off("aborted", abort);
  }
}

function isSameOriginMutation(request: IncomingMessage): boolean {
  if (request.headers["sec-fetch-site"] !== "same-origin") return false;
  if (request.headers["x-action-check-request"] !== "1") return false;
  const originHeader = request.headers.origin;
  const host = request.headers.host;
  if (typeof originHeader !== "string" || !host) return false;
  try {
    const origin = new URL(originHeader);
    return (
      (origin.protocol === "http:" || origin.protocol === "https:") &&
      origin.host === host
    );
  } catch {
    return false;
  }
}

async function readBoundedRequest(
  request: IncomingMessage,
  maximumBytes: number,
): Promise<string> {
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new Error("request_too_large");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    size += bytes.byteLength;
    if (size > maximumBytes) throw new Error("request_too_large");
    chunks.push(bytes);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function cacheRun(
  cache: Map<string, Promise<ExternalTargetCanaryReport>>,
  requestId: string,
  run: Promise<ExternalTargetCanaryReport>,
): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest) cache.delete(oldest);
  }
  cache.set(requestId, run);
}

function evictRun(
  cache: Map<string, Promise<ExternalTargetCanaryReport>>,
  requestId: string,
  run: Promise<ExternalTargetCanaryReport>,
): void {
  if (cache.get(requestId) === run) cache.delete(requestId);
}

function shouldEvictRun(report: ExternalTargetCanaryReport): boolean {
  return report.status === "blocked" && report.reason === "REMOTE_FAILURE";
}

async function writeRunResponse(
  response: ServerResponse,
  run: Promise<ExternalTargetCanaryReport>,
): Promise<void> {
  try {
    const report = await run;
    writeJson(response, statusForReport(report), report);
  } catch {
    writeJson(response, 502, blocked("STAGING_REQUEST_FAILED"));
  }
}

function statusForReport(report: ExternalTargetCanaryReport): number {
  if (report.status === "passed") return 200;
  if (report.status === "inconclusive") return 422;
  if (report.status === "failed") return 409;
  return report.reason === "CLEANUP_FAILED" ? 409 : 502;
}

function blocked(reason: string) {
  return Object.freeze({
    status: "blocked" as const,
    reason,
    mutationAttempted: false,
    cleanup: "not_needed" as const,
  });
}

function setSafeHeaders(response: ServerResponse): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("x-content-type-options", "nosniff");
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  if (response.writableEnded || response.destroyed) return;
  response.statusCode = status;
  response.end(JSON.stringify(value));
}
