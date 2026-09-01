import { z } from "zod";

import type {
  IssueRefundInput,
  RefundEffectTarget,
  RefundTargetInvokeClaim,
  RefundTargetObservation,
  RefundTargetReset,
  RefundTargetRun,
} from "../../refund-comparison";

const MAX_RESPONSE_BYTES = 32_000;
const REQUEST_TIMEOUT_MS = 5_000;
const RUN_ID = /^[A-Za-z0-9_-]{32,160}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,159}$/;

const trialRefSchema = z
  .object({
    trialId: z.string().min(1).max(120),
    epoch: z.number().int().positive(),
    digest: z.string().min(1).max(240),
  })
  .strict();

const laneSchema = z.enum(["broken", "protected"]);

const runSchema = z
  .object({
    runId: z.string().regex(RUN_ID),
    lane: laneSchema,
    requestId: z.string().regex(REQUEST_ID),
    trialDigest: z.string().min(1).max(240),
    leaseExpiresAt: z.iso.datetime(),
    attestationDigest: z.string().min(1).max(240),
  })
  .strict();

const observationSchema = z
  .object({
    runId: z.string().regex(RUN_ID),
    lane: laneSchema,
    sequence: z.number().int().nonnegative(),
    effectCount: z.number().int().nonnegative().max(2),
    effectIds: z.array(z.string().min(1).max(160)).max(2),
    evidenceDigest: z.string().min(1).max(240),
    observedAt: z.iso.datetime(),
    source: z.literal("external-refund-staging"),
  })
  .strict()
  .refine(({ effectCount, effectIds }) => effectCount === effectIds.length);

const attestationSchema = z
  .object({
    service: z.literal("action-check-refund-staging"),
    environment: z.literal("staging"),
    deploymentId: z.string().min(1).max(160),
    capability: z.literal("refund-retry-effect-v1"),
    store: z.enum(["durable", "in_memory_test"]),
    attestationDigest: z.string().min(1).max(240),
  })
  .strict();

const resetSchema = z
  .object({
    attestation: attestationSchema,
    runs: z.object({ broken: runSchema, protected: runSchema }).strict(),
    baseline: z
      .object({ broken: observationSchema, protected: observationSchema })
      .strict(),
  })
  .strict();

const claimSchema = z
  .object({
    runId: z.string().regex(RUN_ID),
    requestId: z.string().regex(REQUEST_ID),
    claim: z.enum(["created", "reused", "ack_lost"]),
  })
  .strict();

type BrowserTargetOptions = Readonly<{
  baseUrl: string;
  fetch?: typeof fetch;
}>;

export class RefundStagingTargetError extends Error {
  readonly code:
    | "TARGET_NOT_CONFIGURED"
    | "INVALID_TARGET_URL"
    | "TARGET_TRANSPORT_FAILED"
    | "TARGET_HTTP_ERROR"
    | "TARGET_RESPONSE_TOO_LARGE"
    | "MALFORMED_TARGET_RESPONSE";

  constructor(code: RefundStagingTargetError["code"], message: string) {
    super(message);
    this.name = "RefundStagingTargetError";
    this.code = code;
  }
}

export class UnavailableRefundEffectTarget implements RefundEffectTarget {
  async reset(): Promise<RefundTargetReset> {
    throw targetNotConfigured();
  }

  async invoke(): Promise<RefundTargetInvokeClaim> {
    throw targetNotConfigured();
  }

  async observe(): Promise<RefundTargetObservation> {
    throw targetNotConfigured();
  }

  async cleanup(): Promise<void> {
    // No capability can exist when target configuration is absent.
  }
}

export class HttpRefundEffectTarget implements RefundEffectTarget {
  readonly #origin: URL;
  readonly #fetch: typeof fetch;

  constructor(options: BrowserTargetOptions) {
    this.#origin = parseTargetOrigin(options.baseUrl);
    const request = options.fetch ?? globalThis.fetch;
    this.#fetch = (input, init) => request(input, init);
  }

  async reset(
    input: Parameters<RefundEffectTarget["reset"]>[0],
    options: Parameters<RefundEffectTarget["reset"]>[1] = {},
  ): Promise<RefundTargetReset> {
    const body = z
      .object({
        trialRef: trialRefSchema,
        requestId: z.string().regex(REQUEST_ID),
      })
      .strict()
      .parse(input);
    return await this.#json("/v1/reset", body, resetSchema, options.signal);
  }

  async invoke(
    run: RefundTargetRun,
    input: IssueRefundInput,
    options: Parameters<RefundEffectTarget["invoke"]>[2] = {},
  ): Promise<RefundTargetInvokeClaim> {
    const body = {
      run: runSchema.parse(run),
      input: z
        .object({
          lane: laneSchema,
          paymentId: z.string().min(1).max(120),
          amountMinor: z.number().int().positive().max(100_000_000),
          currency: z.string().regex(/^[A-Z]{3}$/),
          requestId: z.string().regex(REQUEST_ID),
        })
        .strict()
        .parse(input),
    };
    return await this.#json("/v1/invoke", body, claimSchema, options.signal);
  }

  async observe(
    run: RefundTargetRun,
    options: Parameters<RefundEffectTarget["observe"]>[1] = {},
  ): Promise<RefundTargetObservation> {
    return await this.#json(
      "/v1/observe",
      { run: runSchema.parse(run) },
      observationSchema,
      options.signal,
    );
  }

  async cleanup(reset: RefundTargetReset): Promise<void> {
    await this.#bounded(undefined, async (signal) => {
      const response = await this.#request(
        "/v1/cleanup",
        { runs: resetSchema.shape.runs.parse(reset.runs) },
        signal,
      );
      if (response.status !== 204) {
        await response.body?.cancel();
        throw new RefundStagingTargetError(
          "TARGET_HTTP_ERROR",
          "The refund staging target rejected cleanup.",
        );
      }
      await response.body?.cancel();
    });
  }

  async #json<T>(
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    return await this.#bounded(signal, async (boundedSignal) => {
      const response = await this.#request(path, body, boundedSignal);
      if (!response.ok) {
        await response.body?.cancel();
        throw new RefundStagingTargetError(
          "TARGET_HTTP_ERROR",
          "The refund staging target rejected the request.",
        );
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("application/json")) {
        await response.body?.cancel();
        throw malformedResponse();
      }
      const text = await readBoundedResponse(response);
      let decoded: unknown;
      try {
        decoded = JSON.parse(text);
      } catch {
        throw malformedResponse();
      }
      const parsed = schema.safeParse(decoded);
      if (!parsed.success) throw malformedResponse();
      return parsed.data;
    });
  }

  async #request(
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    return await this.#fetch(new URL(path, this.#origin), {
      method: "POST",
      credentials: "omit",
      redirect: "error",
      signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  async #bounded<T>(
    callerSignal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const deadline = createDeadline(callerSignal);
    try {
      return await operation(deadline.signal);
    } catch (error: unknown) {
      if (callerSignal?.aborted) {
        throw callerSignal.reason ?? new DOMException("Operation cancelled", "AbortError");
      }
      if (error instanceof RefundStagingTargetError) throw error;
      if (error instanceof Error && error.name === "AbortError" && !deadline.timedOut()) {
        throw error;
      }
      throw new RefundStagingTargetError(
        "TARGET_TRANSPORT_FAILED",
        deadline.timedOut()
          ? "The refund staging target timed out."
          : "The refund staging target could not be reached.",
      );
    } finally {
      deadline.dispose();
    }
  }
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw responseTooLarge();
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw responseTooLarge();
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

function createDeadline(callerSignal: AbortSignal | undefined): Readonly<{
  signal: AbortSignal;
  timedOut(): boolean;
  dispose(): void;
}> {
  const controller = new AbortController();
  let timeoutReached = false;
  const forwardAbort = () =>
    controller.abort(
      callerSignal?.reason ?? new DOMException("Operation cancelled", "AbortError"),
    );
  callerSignal?.addEventListener("abort", forwardAbort, { once: true });
  if (callerSignal?.aborted) forwardAbort();
  const timer = globalThis.setTimeout(() => {
    timeoutReached = true;
    controller.abort(new DOMException("Staging request timed out", "TimeoutError"));
  }, REQUEST_TIMEOUT_MS);
  return {
    signal: controller.signal,
    timedOut: () => timeoutReached,
    dispose: () => {
      globalThis.clearTimeout(timer);
      callerSignal?.removeEventListener("abort", forwardAbort);
    },
  };
}

function responseTooLarge(): RefundStagingTargetError {
  return new RefundStagingTargetError(
    "TARGET_RESPONSE_TOO_LARGE",
    "The refund staging target response exceeded the safety limit.",
  );
}

function parseTargetOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidTargetUrl();
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (
    (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw invalidTargetUrl();
  }
  return new URL(url.origin);
}

function invalidTargetUrl(): RefundStagingTargetError {
  return new RefundStagingTargetError(
    "INVALID_TARGET_URL",
    "The refund staging target must use HTTPS (or loopback HTTP for local development).",
  );
}

function malformedResponse(): RefundStagingTargetError {
  return new RefundStagingTargetError(
    "MALFORMED_TARGET_RESPONSE",
    "The refund staging target returned an invalid bounded response.",
  );
}

function targetNotConfigured(): RefundStagingTargetError {
  return new RefundStagingTargetError(
    "TARGET_NOT_CONFIGURED",
    "The external refund staging target is not configured for this deployment.",
  );
}
