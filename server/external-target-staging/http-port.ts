import { z } from "zod";

import type {
  CanaryAttestation,
  CanaryPreparation,
  CanaryTrial,
  PublishClaim,
  PublishObservation,
  ExternalTargetStagingPort,
} from "../../src/integrations/external-target-staging/interface.ts";

const CONTRACT = "external-publish-canary-v1";
const MAX_RESPONSE_BYTES = 32_000;
const REQUEST_TIMEOUT_MS = 15_000;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,159}$/;

const attestationSchema = z
  .object({
    service: z.literal("external-target"),
    environment: z.enum(["development", "staging", "production"]),
    deploymentId: z.string().min(1).max(160),
    commitSha: z.string().min(7).max(64),
    origin: z.url(),
    projectAlias: z.string().min(1).max(80),
    accountAlias: z.string().min(1).max(80),
    capability: z.literal("publish-canary-v1"),
    canaryEnabled: z.boolean(),
    databaseIsolation: z.enum(["isolated", "shared"]),
    providerMode: z.enum(["canary_sink", "live_provider"]),
    liveProviderCredentialsPresent: z.boolean(),
    liveProviderEgressEnabled: z.boolean(),
    workerMode: z.enum(["production_lifecycle", "simulation"]),
    attestationDigest: z.string().min(1).max(240),
  })
  .strict();

const trialSchema = z.enum(["false_success", "truthful_success"]);

const preparationSchema = z
  .object({
    runId: z.string().regex(RUN_ID),
    trial: trialSchema,
    fixtureAlias: z.string().min(1).max(80),
    leaseExpiresAt: z.iso.datetime(),
    attestationDigest: z.string().min(1).max(240),
  })
  .strict();

const observationSchema = z
  .object({
    runId: z.string().regex(RUN_ID),
    trial: trialSchema,
    sequence: z.number().int().nonnegative(),
    post: z
      .object({
        status: z.enum(["approved", "pending", "posted", "failed", "cancelled"]),
        version: z.string().min(1).max(160),
        externalIdPresent: z.boolean(),
        publishedAtPresent: z.boolean(),
      })
      .strict(),
    job: z
      .object({
        status: z.enum(["ready", "pending", "processing", "completed", "failed"]),
        attemptCount: z.number().int().nonnegative(),
      })
      .strict(),
    sink: z
      .object({
        status: z.enum(["draft", "published"]),
        deliveryCount: z.number().int().nonnegative(),
        receiptPresent: z.boolean(),
      })
      .strict(),
    evidence: z
      .object({
        source: z.literal("external-target-staging"),
        attestationDigest: z.string().min(1).max(240),
        observedAt: z.iso.datetime(),
        digest: z.string().min(1).max(240),
      })
      .strict(),
  })
  .strict();

const claimSchema = z
  .object({
    runId: z.string().regex(RUN_ID),
    trial: trialSchema,
    requestId: z.string().regex(REQUEST_ID),
    status: z.enum(["published", "rejected"]),
    externalIdPresent: z.boolean(),
  })
  .strict();

type HttpPortConfig = Readonly<{
  baseUrl: string;
  credential: () => Promise<string>;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
}>;

type PendingResponse = Readonly<{
  response: Response;
  dispose(): void;
}>;

export class ExternalTargetStagingResponseError extends Error {
  readonly code:
    | "INVALID_STAGING_URL"
    | "MISSING_STAGING_CREDENTIAL"
    | "STAGING_TRANSPORT_FAILED"
    | "STAGING_HTTP_ERROR"
    | "STAGING_RESPONSE_TOO_LARGE"
    | "MALFORMED_STAGING_RESPONSE";

  constructor(
    code: ExternalTargetStagingResponseError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ExternalTargetStagingResponseError";
    this.code = code;
  }
}

/**
 * Server-only adapter. Its credential provider must never be constructed from
 * VITE_* variables or sent to browser code.
 */
export class HttpExternalTargetStagingPort implements ExternalTargetStagingPort {
  readonly #origin: URL;
  readonly #credential: () => Promise<string>;
  readonly #fetch: typeof fetch;
  readonly #requestTimeoutMs: number;

  constructor(config: HttpPortConfig) {
    this.#origin = parseOrigin(config.baseUrl);
    this.#credential = config.credential;
    this.#fetch = config.fetch ?? fetch;
    this.#requestTimeoutMs = Math.max(
      1,
      Math.min(config.requestTimeoutMs ?? REQUEST_TIMEOUT_MS, 60_000),
    );
  }

  async attest(options?: { signal?: AbortSignal }): Promise<CanaryAttestation> {
    return await this.#json(
      "/internal/action-check/identity",
      { method: "GET", signal: options?.signal },
      attestationSchema,
    );
  }

  async prepare(
    trial: CanaryTrial,
    requestId: string,
    options?: { signal?: AbortSignal },
  ): Promise<CanaryPreparation> {
    const parsedTrial = trialSchema.parse(trial);
    if (!REQUEST_ID.test(requestId)) {
      throw new ExternalTargetStagingResponseError(
        "MALFORMED_STAGING_RESPONSE",
        "The generated canary request identity was invalid.",
      );
    }
    return await this.#json(
      "/internal/action-check/runs",
      {
        method: "POST",
        signal: options?.signal,
        body: JSON.stringify({ trial: parsedTrial, requestId }),
      },
      preparationSchema,
    );
  }

  async read(
    preparation: CanaryPreparation,
    options?: { signal?: AbortSignal },
  ): Promise<PublishObservation> {
    const runId = checkedRunId(preparation.runId);
    return await this.#json(
      `/internal/action-check/runs/${encodeURIComponent(runId)}`,
      { method: "GET", signal: options?.signal },
      observationSchema,
    );
  }

  async execute(
    preparation: CanaryPreparation,
    requestId: string,
    options?: { signal?: AbortSignal },
  ): Promise<PublishClaim> {
    const runId = checkedRunId(preparation.runId);
    if (!REQUEST_ID.test(requestId)) {
      throw new ExternalTargetStagingResponseError(
        "MALFORMED_STAGING_RESPONSE",
        "The generated canary request identity was invalid.",
      );
    }
    return await this.#json(
      `/internal/action-check/runs/${encodeURIComponent(runId)}/execute`,
      {
        method: "POST",
        signal: options?.signal,
        body: JSON.stringify({ requestId }),
      },
      claimSchema,
    );
  }

  async cleanup(preparation: CanaryPreparation): Promise<void> {
    const runId = checkedRunId(preparation.runId);
    const pending = await this.#request(
      `/internal/action-check/runs/${encodeURIComponent(runId)}`,
      { method: "DELETE" },
    );
    try {
      await pending.response.body?.cancel();
    } finally {
      pending.dispose();
    }
  }

  async #json<T>(
    path: string,
    init: RequestInit,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const pending = await this.#request(path, init);
    try {
      const contentType = pending.response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("application/json")) {
        throw malformedResponse();
      }

      const text = await readBoundedText(
        pending.response,
        MAX_RESPONSE_BYTES,
      );
      let decoded: unknown;
      try {
        decoded = JSON.parse(text);
      } catch {
        throw malformedResponse();
      }
      const parsed = schema.safeParse(decoded);
      if (!parsed.success) throw malformedResponse();
      return parsed.data;
    } finally {
      pending.dispose();
    }
  }

  async #request(path: string, init: RequestInit): Promise<PendingResponse> {
    const credential = await this.#credential();
    if (!credential || credential.trim().length === 0 || credential.length > 4_096) {
      throw new ExternalTargetStagingResponseError(
        "MISSING_STAGING_CREDENTIAL",
        "The server-side staging credential is unavailable.",
      );
    }

    const timeout = timeoutSignal(
      init.signal ?? undefined,
      this.#requestTimeoutMs,
    );
    let response: Response;
    try {
      response = await this.#fetch(new URL(path, this.#origin), {
        ...init,
        redirect: "error",
        signal: timeout.signal,
        headers: {
          authorization: `Bearer ${credential}`,
          "content-type": "application/json",
          "x-action-check-contract": CONTRACT,
        },
      });
    } catch (error: unknown) {
      timeout.dispose();
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw new ExternalTargetStagingResponseError(
        "STAGING_TRANSPORT_FAILED",
        "The External Target staging service could not be reached.",
        { cause: error },
      );
    }
    if (!response.ok) {
      timeout.dispose();
      throw new ExternalTargetStagingResponseError(
        "STAGING_HTTP_ERROR",
        "The External Target staging service rejected the canary request.",
      );
    }
    return { response, dispose: timeout.dispose };
  }
}

function parseOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error: unknown) {
    throw new ExternalTargetStagingResponseError(
      "INVALID_STAGING_URL",
      "The External Target staging URL is invalid.",
      { cause: error },
    );
  }

  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new ExternalTargetStagingResponseError(
      "INVALID_STAGING_URL",
      "The External Target staging URL must use HTTPS.",
    );
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new ExternalTargetStagingResponseError(
      "INVALID_STAGING_URL",
      "The External Target staging URL must be an origin without credentials or paths.",
    );
  }
  url.pathname = "/";
  return url;
}

function checkedRunId(value: string): string {
  if (!RUN_ID.test(value)) {
    throw new ExternalTargetStagingResponseError(
      "MALFORMED_STAGING_RESPONSE",
      "The staging run identity was invalid.",
    );
  }
  return value;
}

function malformedResponse(): ExternalTargetStagingResponseError {
  return new ExternalTargetStagingResponseError(
    "MALFORMED_STAGING_RESPONSE",
    "The External Target staging service returned incomplete evidence.",
  );
}

async function readBoundedText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw responseTooLarge();
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel();
      throw responseTooLarge();
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

function responseTooLarge(): ExternalTargetStagingResponseError {
  return new ExternalTargetStagingResponseError(
    "STAGING_RESPONSE_TOO_LARGE",
    "The External Target staging evidence exceeded the response limit.",
  );
}

function timeoutSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): Readonly<{ signal: AbortSignal; dispose(): void }> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parent?.reason);
  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException("Staging request timed out", "AbortError")),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}
