import { z } from "zod";

const BROKER_PATH = "/api/social-neuron-canary";
const MAX_RESPONSE_CHARACTERS = 32_000;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,159}$/;

const readySchema = z
  .object({
    state: z.literal("ready"),
    environment: z.literal("staging"),
    deploymentId: z.string().min(1).max(160),
  })
  .strict();

const brokerBlockedReasonSchema = z.enum([
  "STAGING_NOT_CONFIGURED",
  "STAGING_ATTESTATION_FAILED",
  "STAGING_REQUEST_FAILED",
  "INVALID_REQUEST",
  "CROSS_ORIGIN_REQUEST",
  "METHOD_NOT_ALLOWED",
  "CANARY_BUSY",
]);

const domainBlockedReasonSchema = z.enum([
  "WRONG_ENVIRONMENT",
  "IDENTITY_MISMATCH",
  "CANARY_DISABLED",
  "PRECONDITION_FAILED",
  "FAULT_NOT_EXERCISED",
  "EVIDENCE_INCOMPLETE",
  "INVARIANT_FAILED",
  "REMOTE_FAILURE",
  "CLEANUP_FAILED",
]);

const nonPassingSchema = z
  .object({
    status: z.enum(["blocked", "inconclusive", "failed"]),
    reason: z.union([domainBlockedReasonSchema, brokerBlockedReasonSchema]),
    mutationAttempted: z.boolean(),
    cleanup: z.enum(["not_needed", "completed", "failed"]),
  })
  .strict();

const trialProofSchema = z
  .object({
    runId: z.string().min(1).max(128),
    claim: z.enum(["published", "rejected"]),
    authoritativeState: z.enum(["draft", "published"]),
    judgment: z.enum(["accepted", "rejected"]),
    beforeEvidence: z.string().min(1).max(240),
    afterEvidence: z.string().min(1).max(240),
  })
  .strict();

const passedSchema = z
  .object({
    status: z.literal("passed"),
    verdict: z.literal("false_success_caught"),
    environment: z.literal("staging"),
    deploymentId: z.string().min(1).max(160),
    trials: z
      .object({
        falseSuccess: trialProofSchema,
        truthful: trialProofSchema,
      })
      .strict(),
    sensitivity: z
      .object({
        status: z.literal("passed"),
        mutant: z.literal("trust_handler_claim"),
      })
      .strict(),
    cleanup: z.literal("completed"),
  })
  .strict();

const reportSchema = z.union([passedSchema, nonPassingSchema]);

export type BrowserCanaryReport = z.infer<typeof reportSchema>;

export type SocialNeuronCanaryAvailability =
  | Readonly<{
      state: "ready";
      environment: "staging";
      deploymentId: string;
    }>
  | Readonly<{ state: "blocked"; reason: string }>;

type BrowserClientOptions = Readonly<{
  fetch?: typeof fetch;
  createRequestId?: () => string;
}>;

export class BrowserSocialNeuronCanaryClient {
  readonly #fetch: typeof fetch;
  readonly #createRequestId: () => string;
  #pendingRequestId: string | null = null;

  constructor(options: BrowserClientOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#createRequestId =
      options.createRequestId ?? (() => `canary-${crypto.randomUUID()}`);
  }

  async probe(options: { signal?: AbortSignal } = {}): Promise<SocialNeuronCanaryAvailability> {
    try {
      const response = await this.#fetch(BROKER_PATH, {
        method: "GET",
        credentials: "same-origin",
        redirect: "error",
        signal: options.signal,
        headers: { accept: "application/json" },
      });
      const decoded = await readBoundedJson(response);
      const ready = readySchema.safeParse(decoded);
      if (response.ok && ready.success) return ready.data;
      const blocked = nonPassingSchema.safeParse(decoded);
      return {
        state: "blocked",
        reason: blocked.success ? blocked.data.reason : "STAGING_REQUEST_FAILED",
      };
    } catch (error: unknown) {
      rethrowCallerAbort(error, options.signal);
      return { state: "blocked", reason: "STAGING_REQUEST_FAILED" };
    }
  }

  async run(options: { signal?: AbortSignal } = {}): Promise<BrowserCanaryReport> {
    options.signal?.throwIfAborted();
    const requestId = this.#pendingRequestId ?? this.#createRequestId();
    if (!REQUEST_ID.test(requestId)) {
      return blockedReport("INVALID_REQUEST");
    }
    this.#pendingRequestId = requestId;

    try {
      const response = await this.#fetch(BROKER_PATH, {
        method: "POST",
        credentials: "same-origin",
        redirect: "error",
        signal: options.signal,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-action-check-request": "1",
        },
        body: JSON.stringify({ requestId }),
      });
      const decoded = await readBoundedJson(response);
      const parsed = reportSchema.safeParse(decoded);
      if (!parsed.success) return blockedReport("STAGING_REQUEST_FAILED");
      this.#pendingRequestId = null;
      return parsed.data;
    } catch (error: unknown) {
      rethrowCallerAbort(error, options.signal);
      return blockedReport("STAGING_REQUEST_FAILED");
    }
  }
}

function blockedReport(
  reason: z.infer<typeof brokerBlockedReasonSchema>,
): BrowserCanaryReport {
  return {
    status: "blocked",
    reason,
    mutationAttempted: false,
    cleanup: "not_needed",
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_RESPONSE_CHARACTERS
  ) {
    throw new Error("response_too_large");
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_CHARACTERS) {
    throw new Error("response_too_large");
  }
  return JSON.parse(text);
}

function rethrowCallerAbort(
  error: unknown,
  signal: AbortSignal | undefined,
): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? error;
}

export type BrowserSocialNeuronCanaryRunner = Pick<
  BrowserSocialNeuronCanaryClient,
  "run"
>;
