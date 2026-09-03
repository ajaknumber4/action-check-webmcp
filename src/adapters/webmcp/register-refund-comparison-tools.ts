import { z } from "zod";

import type {
  RefundComparisonAction,
  RefundComparisonOutcome,
  RefundComparisonSession,
} from "../../refund-comparison";
import type {
  ModelContextRegistrar,
  WebMcpToolDefinition,
} from "./model-context-registrar";

export const REFUND_COMPARISON_TOOL_NAMES = Object.freeze([
  "stage_refund_comparison",
  "issue_refund",
  "prove_refund_comparison",
] as const);

export type RefundComparisonToolName =
  (typeof REFUND_COMPARISON_TOOL_NAMES)[number];

const emptyInput = z.object({}).strict();
const issueRefundInput = z
  .object({
    lane: z.enum(["broken", "protected"]),
    paymentId: z.string().regex(/^pay-[a-z0-9-]{1,40}$/),
    amountMinor: z.number().int().positive().max(1_000_000),
    currency: z.string().regex(/^[A-Z]{3}$/),
    requestId: z.string().regex(/^refund-[a-z0-9-]{1,60}$/),
  })
  .strict();

const emptyInputJsonSchema = Object.freeze({
  type: "object",
  properties: Object.freeze({}),
  required: Object.freeze([]),
  additionalProperties: false,
});

const issueRefundInputJsonSchema = Object.freeze({
  type: "object",
  properties: Object.freeze({
    lane: Object.freeze({
      type: "string",
      enum: Object.freeze(["broken", "protected"]),
      description: "The known-bad or idempotency-protected staging target lane.",
    }),
    paymentId: Object.freeze({
      type: "string",
      pattern: "^pay-[a-z0-9-]{1,40}$",
      description: "Exact fictional payment shown in the approved staging trial.",
    }),
    amountMinor: Object.freeze({
      type: "integer",
      minimum: 1,
      maximum: 1_000_000,
      description: "Fictional staging refund amount in minor currency units.",
    }),
    currency: Object.freeze({
      type: "string",
      pattern: "^[A-Z]{3}$",
      description: "Three-letter currency bound to the approved trial.",
    }),
    requestId: Object.freeze({
      type: "string",
      pattern: "^refund-[a-z0-9-]{1,60}$",
      description: "Stable logical refund request ID reused for the retry.",
    }),
  }),
  required: Object.freeze([
    "lane",
    "paymentId",
    "amountMinor",
    "currency",
    "requestId",
  ]),
  additionalProperties: false,
});

export type RefundComparisonToolRegistrationStatus =
  | Readonly<{ state: "registering"; registeredToolCount: number; totalToolCount: 3 }>
  | Readonly<{ state: "ready"; registeredToolCount: 3; totalToolCount: 3 }>
  | Readonly<{
      state: "failed";
      registeredToolCount: 0;
      totalToolCount: 3;
      errorName: string;
    }>
  | Readonly<{ state: "disposed"; registeredToolCount: 0; totalToolCount: 3 }>;

export interface RefundComparisonToolRegistration {
  readonly ready: Promise<void>;
  getStatus(): RefundComparisonToolRegistrationStatus;
  subscribe(
    listener: (status: RefundComparisonToolRegistrationStatus) => void,
  ): () => void;
  dispose(): void;
}

export class DuplicateRefundComparisonRegistrationError extends Error {
  readonly code = "DUPLICATE_REGISTRATION";

  constructor() {
    super("This model context already has active refund comparison tools.");
    this.name = "DuplicateRefundComparisonRegistrationError";
  }
}

const activeRegistrations = new WeakMap<
  ModelContextRegistrar,
  RefundComparisonRegistration
>();

export function registerRefundComparisonTools(
  session: RefundComparisonSession,
  registrar: ModelContextRegistrar,
): RefundComparisonToolRegistration {
  const existing = activeRegistrations.get(registrar);
  if (existing) {
    const state = existing.getStatus().state;
    if (state === "registering" || state === "ready") {
      if (existing.isFor(session)) {
        return existing;
      }
      throw new DuplicateRefundComparisonRegistrationError();
    }
    existing.dispose();
  }

  const registration = new RefundComparisonRegistration(session, registrar);
  activeRegistrations.set(registrar, registration);
  return registration;
}

export function createRefundComparisonToolDefinitions(
  session: RefundComparisonSession,
): readonly WebMcpToolDefinition[] {
  return Object.freeze([
    Object.freeze({
      name: "stage_refund_comparison",
      title: "Stage isolated refund comparison",
      description:
        "Reset one isolated external staging trial with known-bad and protected lanes. This changes no real payment and requires visible human approval before issue_refund can run.",
      inputSchema: emptyInputJsonSchema,
      annotations: Object.freeze({ readOnlyHint: false, untrustedContentHint: false }),
      execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
        const parsed = emptyInput.safeParse(input);
        if (!parsed.success) {
          return invalidInput(session, "stage_refund_comparison", parsed.error.issues);
        }
        return await session.agent.stageComparison({ signal: executionSignal(options) });
      },
    }),
    Object.freeze({
      name: "issue_refund",
      title: "Invoke staging refund target",
      description:
        "Invoke one approved refund attempt against the selected staging lane. The first attempt commits with an uncertain acknowledgement; retry once with the identical request ID.",
      inputSchema: issueRefundInputJsonSchema,
      annotations: Object.freeze({ readOnlyHint: false, untrustedContentHint: false }),
      execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
        const parsed = issueRefundInput.safeParse(input);
        if (!parsed.success) {
          return invalidInput(session, "issue_refund", parsed.error.issues);
        }
        return await session.target.issueRefund(parsed.data, {
          signal: executionSignal(options),
        });
      },
    }),
    Object.freeze({
      name: "prove_refund_comparison",
      title: "Prove refund retry effects",
      description:
        "Read the staging ledger through the separate observation endpoint after both lanes receive two attempts, require the known-bad target to fail and the protected target to pass, then bind observed effect IDs to the approved trial.",
      inputSchema: emptyInputJsonSchema,
      annotations: Object.freeze({ readOnlyHint: false, untrustedContentHint: false }),
      execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
        const parsed = emptyInput.safeParse(input);
        if (!parsed.success) {
          return invalidInput(session, "prove_refund_comparison", parsed.error.issues);
        }
        return await session.agent.proveComparison({ signal: executionSignal(options) });
      },
    }),
  ] satisfies readonly WebMcpToolDefinition[]);
}

class RefundComparisonRegistration implements RefundComparisonToolRegistration {
  readonly #session: RefundComparisonSession;
  readonly #registrar: ModelContextRegistrar;
  readonly #lifecycle = new AbortController();
  readonly #listeners = new Set<
    (status: RefundComparisonToolRegistrationStatus) => void
  >();
  #status: RefundComparisonToolRegistrationStatus = {
    state: "registering",
    registeredToolCount: 0,
    totalToolCount: 3,
  };
  readonly ready: Promise<void>;

  constructor(
    session: RefundComparisonSession,
    registrar: ModelContextRegistrar,
  ) {
    this.#session = session;
    this.#registrar = registrar;
    this.ready = this.#register();
  }

  isFor(session: RefundComparisonSession): boolean {
    return this.#session === session;
  }

  getStatus(): RefundComparisonToolRegistrationStatus {
    return this.#status;
  }

  subscribe(
    listener: (status: RefundComparisonToolRegistrationStatus) => void,
  ): () => void {
    this.#listeners.add(listener);
    try {
      listener(this.#status);
    } catch {
      // A view subscriber cannot alter the registration lifecycle.
    }
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    if (this.#status.state === "disposed") return;
    this.#lifecycle.abort(
      new DOMException("Refund comparison tools were disposed.", "AbortError"),
    );
    this.#setStatus({
      state: "disposed",
      registeredToolCount: 0,
      totalToolCount: 3,
    });
  }

  async #register(): Promise<void> {
    try {
      const definitions = createRefundComparisonToolDefinitions(this.#session);
      for (let index = 0; index < definitions.length; index += 1) {
        await this.#registrar.registerTool(definitions[index]!, {
          signal: this.#lifecycle.signal,
        });
        this.#lifecycle.signal.throwIfAborted();
        this.#setStatus({
          state: "registering",
          registeredToolCount: index + 1,
          totalToolCount: 3,
        });
        this.#lifecycle.signal.throwIfAborted();
      }
      this.#setStatus({
        state: "ready",
        registeredToolCount: 3,
        totalToolCount: 3,
      });
    } catch (error: unknown) {
      if (this.#status.state === "disposed") throw error;
      this.#lifecycle.abort(error);
      this.#setStatus({
        state: "failed",
        registeredToolCount: 0,
        totalToolCount: 3,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      throw error;
    }
  }

  #setStatus(status: RefundComparisonToolRegistrationStatus): void {
    this.#status = status;
    for (const listener of this.#listeners) {
      try {
        listener(status);
      } catch {
        // A view subscriber cannot alter the registration lifecycle.
      }
    }
  }
}

function executionSignal(options: { signal?: AbortSignal } | undefined): AbortSignal {
  return options?.signal ?? new AbortController().signal;
}

type SchemaIssue = Readonly<{
  path: ReadonlyArray<PropertyKey>;
  message: string;
}>;

const MAX_LISTED_ISSUES = 4;
const MAX_INVALID_INPUT_MESSAGE_LENGTH = 500;

/**
 * Names the offending fields so an agent can self-correct on the next call,
 * as Chrome's WebMCP best-practice guidance asks ("add descriptive errors to
 * your function code to allow the model to self-correct"). Bounded so the
 * message stays inside the recommended tool-output budget.
 */
function describeSchemaIssues(issues: ReadonlyArray<SchemaIssue>): string {
  const listed = issues.slice(0, MAX_LISTED_ISSUES).map((issue) => {
    const path = issue.path.map(String).join(".") || "input";
    return `${path}: ${issue.message}`;
  });
  const remaining = issues.length - listed.length;
  const suffix = remaining > 0 ? `; and ${remaining} more` : "";
  return `${listed.join("; ")}${suffix}`;
}

function invalidInput(
  session: RefundComparisonSession,
  action: RefundComparisonAction,
  issues: ReadonlyArray<SchemaIssue>,
): RefundComparisonOutcome {
  const message = `Invalid ${action} arguments (${describeSchemaIssues(issues)}).`;
  return Object.freeze({
    ok: false,
    action,
    phase: session.observe.getSnapshot().phase,
    error: Object.freeze({
      code: "INPUT_MISMATCH",
      message:
        message.length > MAX_INVALID_INPUT_MESSAGE_LENGTH
          ? `${message.slice(0, MAX_INVALID_INPUT_MESSAGE_LENGTH - 1)}…`
          : message,
      nextAction: "Fix the listed fields and retry with only the documented fields.",
    }),
  });
}
