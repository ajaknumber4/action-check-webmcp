import type {
  AgentCommand,
  AllowedAction,
  Outcome,
  WorkbenchAgent,
  WorkbenchErrorCode,
  WorkbenchPhase,
} from "../../workbench/interface";
import type {
  ModelContextRegistrar,
  WebMcpToolAnnotations,
  WebMcpToolDefinition,
} from "./model-context-registrar";
import {
  emptyToolInputJsonSchema,
  emptyToolInputSchema,
  findingToolInputJsonSchema,
  findingToolInputSchema,
  type FindingToolInput,
} from "./tool-schemas";

export const MAX_TOOL_DESCRIPTION_CHARACTERS = 500;
export const MAX_PARAMETER_DESCRIPTION_CHARACTERS = 150;
export const MAX_TOOL_RESULT_CHARACTERS = 1_500;

export const WEBMCP_TOOL_NAMES = Object.freeze([
  "read_case",
  "run_diagnostics",
  "explain_finding",
  "stage_sandbox_fix",
  "replay_flow",
  "prepare_report",
] as const);

export type WorkbenchToolName = (typeof WEBMCP_TOOL_NAMES)[number];

type StaticToolMetadata = Readonly<{
  name: WorkbenchToolName;
  title: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
  annotations: WebMcpToolAnnotations;
}>;

const UNTRUSTED_READ_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  untrustedContentHint: true,
});

const AUTHOR_READ_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  untrustedContentHint: false,
});

const AUTHOR_WRITE_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  untrustedContentHint: false,
});

export const WORKBENCH_TOOL_METADATA: readonly StaticToolMetadata[] =
  Object.freeze([
    {
      name: "read_case",
      title: "Read assurance case",
      description:
        "Read the current redacted synthetic action case, workflow phase, staged-guardrail status, and allowed next actions. Use this before choosing another workbench action.",
      inputSchema: emptyToolInputJsonSchema,
      annotations: UNTRUSTED_READ_ANNOTATIONS,
    },
    {
      name: "run_diagnostics",
      title: "Run assurance diagnostics",
      description:
        "Evaluate the current synthetic action against its deterministic safety invariant. This updates visible judgment and returns compact finding identifiers.",
      inputSchema: emptyToolInputJsonSchema,
      annotations: AUTHOR_WRITE_ANNOTATIONS,
    },
    {
      name: "explain_finding",
      title: "Explain assurance finding",
      description:
        "Explain one existing finding by ID, including its redacted evidence, failed invariant, and smallest permitted sandbox correction.",
      inputSchema: findingToolInputJsonSchema,
      annotations: UNTRUSTED_READ_ANNOTATIONS,
    },
    {
      name: "stage_sandbox_fix",
      title: "Stage assurance guardrail",
      description:
        "Stage the permitted guardrail for one finding in browser-local state. This never grants approval or changes production.",
      inputSchema: findingToolInputJsonSchema,
      annotations: AUTHOR_WRITE_ANNOTATIONS,
    },
    {
      name: "replay_flow",
      title: "Run assurance replay",
      description:
        "Replay the synthetic action using the exact currently approved guardrail, then check its authoritative post-condition. Human confirmation in the page is required.",
      inputSchema: emptyToolInputJsonSchema,
      annotations: AUTHOR_WRITE_ANNOTATIONS,
    },
    {
      name: "prepare_report",
      title: "Prepare assurance receipt",
      description:
        "Return the bounded redacted proof receipt after assurance replay. A passed receipt can truthfully record that the requested business goal was not achieved.",
      inputSchema: emptyToolInputJsonSchema,
      annotations: UNTRUSTED_READ_ANNOTATIONS,
    },
  ]);

export type WorkbenchToolRegistrationStatus =
  | Readonly<{
      state: "registering";
      registeredToolCount: number;
      totalToolCount: 6;
    }>
  | Readonly<{
      state: "ready";
      registeredToolCount: 6;
      totalToolCount: 6;
    }>
  | Readonly<{
      state: "failed";
      registeredToolCount: 0;
      totalToolCount: 6;
      errorCode: "REGISTRATION_FAILED";
      errorName: string;
    }>
  | Readonly<{
      state: "disposed";
      registeredToolCount: 0;
      totalToolCount: 6;
    }>;

export interface WorkbenchToolRegistration {
  readonly ready: Promise<void>;
  getStatus(): WorkbenchToolRegistrationStatus;
  subscribe(
    listener: (status: WorkbenchToolRegistrationStatus) => void,
  ): () => void;
  dispose(): void;
}

export class DuplicateWorkbenchRegistrationError extends Error {
  readonly code = "DUPLICATE_REGISTRATION";

  constructor() {
    super("This model context already has active workbench tools.");
    this.name = "DuplicateWorkbenchRegistrationError";
  }
}

const activeRegistrations = new WeakMap<
  ModelContextRegistrar,
  RegistrationController
>();

export function registerWorkbenchTools(
  agent: WorkbenchAgent,
  registrar: ModelContextRegistrar,
): WorkbenchToolRegistration {
  const existing = activeRegistrations.get(registrar);
  if (existing) {
    const state = existing.getStatus().state;
    if (state === "registering" || state === "ready") {
      if (existing.isFor(agent)) {
        return existing;
      }
      throw new DuplicateWorkbenchRegistrationError();
    }
    existing.dispose();
  }

  const controller = new RegistrationController(agent, registrar);
  activeRegistrations.set(registrar, controller);
  return controller;
}

export function createWorkbenchToolDefinitions(
  agent: WorkbenchAgent,
): readonly WebMcpToolDefinition[] {
  return WORKBENCH_TOOL_METADATA.map((metadata) => ({
    ...metadata,
    execute: async (input, options) => {
      const signal = options?.signal ?? new AbortController().signal;
      return await executeWorkbenchTool(agent, metadata.name, input, signal);
    },
  }));
}

class RegistrationController implements WorkbenchToolRegistration {
  readonly #agent: WorkbenchAgent;
  readonly #registrar: ModelContextRegistrar;
  readonly #lifecycle = new AbortController();
  readonly #listeners = new Set<
    (status: WorkbenchToolRegistrationStatus) => void
  >();

  #status: WorkbenchToolRegistrationStatus = {
    state: "registering",
    registeredToolCount: 0,
    totalToolCount: 6,
  };

  readonly ready: Promise<void>;

  constructor(agent: WorkbenchAgent, registrar: ModelContextRegistrar) {
    this.#agent = agent;
    this.#registrar = registrar;
    this.ready = this.#registerAll();
  }

  isFor(agent: WorkbenchAgent): boolean {
    return this.#agent === agent;
  }

  getStatus(): WorkbenchToolRegistrationStatus {
    return this.#status;
  }

  subscribe(
    listener: (status: WorkbenchToolRegistrationStatus) => void,
  ): () => void {
    this.#listeners.add(listener);
    this.#notifyListener(listener, this.#status);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    if (this.#status.state === "disposed") {
      return;
    }

    this.#lifecycle.abort(
      new DOMException("WebMCP tools were disposed.", "AbortError"),
    );
    this.#setStatus({
      state: "disposed",
      registeredToolCount: 0,
      totalToolCount: 6,
    });
  }

  async #registerAll(): Promise<void> {
    const tools = createWorkbenchToolDefinitions(this.#agent);

    try {
      for (let index = 0; index < tools.length; index += 1) {
        await this.#registrar.registerTool(tools[index], {
          signal: this.#lifecycle.signal,
        });

        if (this.#lifecycle.signal.aborted) {
          throw this.#lifecycle.signal.reason;
        }

        this.#setStatus({
          state: "registering",
          registeredToolCount: index + 1,
          totalToolCount: 6,
        });
      }

      this.#setStatus({
        state: "ready",
        registeredToolCount: 6,
        totalToolCount: 6,
      });
    } catch (error: unknown) {
      if (this.#status.state === "disposed") {
        throw error;
      }

      this.#lifecycle.abort(error);
      this.#setStatus({
        state: "failed",
        registeredToolCount: 0,
        totalToolCount: 6,
        errorCode: "REGISTRATION_FAILED",
        errorName: safeErrorName(error),
      });
      throw new WebMcpRegistrationError(safeErrorName(error), { cause: error });
    }
  }

  #setStatus(status: WorkbenchToolRegistrationStatus): void {
    this.#status = status;
    for (const listener of this.#listeners) {
      this.#notifyListener(listener, status);
    }
  }

  #notifyListener(
    listener: (status: WorkbenchToolRegistrationStatus) => void,
    status: WorkbenchToolRegistrationStatus,
  ): void {
    try {
      listener(status);
    } catch {
      // A presentation subscriber must not alter registration lifecycle state.
    }
  }
}

export class WebMcpRegistrationError extends Error {
  readonly code = "REGISTRATION_FAILED";
  readonly sourceErrorName: string;

  constructor(sourceErrorName: string, options?: ErrorOptions) {
    super("WebMCP tool registration failed.", options);
    this.name = "WebMcpRegistrationError";
    this.sourceErrorName = sourceErrorName;
  }
}

async function executeWorkbenchTool(
  agent: WorkbenchAgent,
  name: WorkbenchToolName,
  input: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  signal.throwIfAborted();

  const parsed = parseInput(name, input);
  if (!parsed.ok) {
    return await serializeInvalidInput(agent, name, signal);
  }

  const command = commandFor(name, parsed.value);

  try {
    const outcome = await agent.execute(command, { signal });
    return boundedOutcome(outcome);
  } catch (error: unknown) {
    if (signal.aborted) {
      throw signal.reason;
    }

    return {
      ok: false,
      command: name,
      error: {
        code: "INTERNAL_FAILURE",
        message: "The local workbench could not complete this tool.",
        nextAction: "Read the case and retry the intended action.",
      },
    };
  }
}

type ParsedInput =
  | Readonly<{ ok: true; value: FindingToolInput | Record<string, never> }>
  | Readonly<{ ok: false }>;

function parseInput(name: WorkbenchToolName, input: unknown): ParsedInput {
  const schema =
    name === "explain_finding" || name === "stage_sandbox_fix"
      ? findingToolInputSchema
      : emptyToolInputSchema;
  const result = schema.safeParse(input);
  return result.success ? { ok: true, value: result.data } : { ok: false };
}

function commandFor(
  name: WorkbenchToolName,
  input: FindingToolInput | Record<string, never>,
): AgentCommand {
  if (name === "explain_finding" || name === "stage_sandbox_fix") {
    return { kind: name, findingId: (input as FindingToolInput).findingId };
  }
  return { kind: name };
}

async function serializeInvalidInput(
  agent: WorkbenchAgent,
  name: WorkbenchToolName,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    const current = await agent.execute({ kind: "read_case" }, { signal });
    const expectsFinding =
      name === "explain_finding" || name === "stage_sandbox_fix";
    return boundedOutcome(
      failureOutcome(
        name,
        current.phase,
        "INVALID_INPUT",
        expectsFinding
          ? "Input must contain only one valid findingId."
          : "This tool accepts only an empty input object.",
        expectsFinding
          ? `Call ${name} with only a findingId returned by run_diagnostics.`
          : `Call ${name} with an empty object.`,
        current.allowedNextActions,
      ),
    );
  } catch (error: unknown) {
    if (signal.aborted) {
      throw signal.reason;
    }
    return {
      ok: false,
      command: name,
      error: {
        code: "INVALID_INPUT",
        message: "The tool input did not match its strict schema.",
        nextAction: "Read the tool schema and retry without unknown fields.",
      },
    };
  }
}

function failureOutcome(
  command: WorkbenchToolName,
  phase: WorkbenchPhase,
  code: WorkbenchErrorCode,
  message: string,
  nextAction: string,
  allowedNextActions: readonly AllowedAction[],
): Outcome {
  return {
    ok: false,
    command,
    phase,
    error: { code, message, nextAction },
    allowedNextActions,
  };
}

function boundedOutcome(outcome: Outcome): Outcome {
  const serialized = JSON.stringify(outcome);
  if (serialized.length <= MAX_TOOL_RESULT_CHARACTERS) {
    return outcome;
  }

  const budgetFailure = failureOutcome(
    outcome.command as WorkbenchToolName,
    outcome.phase,
    "OUTPUT_BUDGET_EXCEEDED",
    "The safe result exceeded the WebMCP output budget and was withheld.",
    "Use the visible workbench for details, then call read_case.",
    outcome.allowedNextActions,
  );
  const boundedFailure = JSON.stringify(budgetFailure);

  if (boundedFailure.length > MAX_TOOL_RESULT_CHARACTERS) {
    return {
      ok: false,
      command: outcome.command,
      phase: outcome.phase,
      error: {
        code: "OUTPUT_BUDGET_EXCEEDED",
        message: "The safe result was withheld because it was too large.",
        nextAction: "Call read_case.",
      },
      allowedNextActions: [],
    };
  }

  return budgetFailure;
}

function safeErrorName(error: unknown): string {
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name)) {
    return error.name;
  }
  return "Error";
}
