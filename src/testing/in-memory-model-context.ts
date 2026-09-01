import type {
  ModelContextRegistrar,
  ModelContextRegistrationOptions,
  WebMcpToolDefinition,
} from "../adapters/webmcp/model-context-registrar";

export type InvokeToolOptions = Readonly<{ signal?: AbortSignal }>;

type StoredTool = Readonly<{
  definition: WebMcpToolDefinition;
  registrationSignal: AbortSignal;
  unregister: () => void;
}>;

export class InMemoryModelContext implements ModelContextRegistrar {
  readonly registrationAttempts: WebMcpToolDefinition[] = [];

  readonly #tools = new Map<string, StoredTool>();
  readonly #registrationFailures = new Map<string, Error>();

  failRegistration(
    toolName: string,
    error = new Error("Synthetic registration failure."),
  ): void {
    this.#registrationFailures.set(toolName, error);
  }

  async registerTool(
    tool: WebMcpToolDefinition,
    options: ModelContextRegistrationOptions,
  ): Promise<void> {
    this.registrationAttempts.push(tool);

    if (options.signal.aborted) {
      throw options.signal.reason;
    }

    const configuredFailure = this.#registrationFailures.get(tool.name);
    if (configuredFailure) {
      this.#registrationFailures.delete(tool.name);
      throw configuredFailure;
    }

    if (this.#tools.has(tool.name)) {
      throw new DOMException(
        `A tool named ${tool.name} is already registered.`,
        "InvalidStateError",
      );
    }

    const unregister = (): void => {
      const current = this.#tools.get(tool.name);
      if (current?.definition === tool) {
        this.#tools.delete(tool.name);
      }
      options.signal.removeEventListener("abort", unregister);
    };

    options.signal.addEventListener("abort", unregister, { once: true });
    this.#tools.set(tool.name, {
      definition: tool,
      registrationSignal: options.signal,
      unregister,
    });
  }

  listTools(): readonly WebMcpToolDefinition[] {
    return [...this.#tools.values()].map(({ definition }) => definition);
  }

  getTool(name: string): WebMcpToolDefinition | undefined {
    return this.#tools.get(name)?.definition;
  }

  async invoke(
    name: string,
    input: unknown = {},
    options: InvokeToolOptions = {},
  ): Promise<string> {
    const stored = this.#tools.get(name);
    if (!stored) {
      throw new Error(`No registered tool named ${name}.`);
    }

    const executionController = options.signal ? null : new AbortController();
    const signal = options.signal ?? executionController!.signal;

    if (signal.aborted) {
      throw signal.reason;
    }

    const result = await rejectWhenAborted(
      stored.definition.execute(input, { signal }),
      signal,
    );
    const serialized = JSON.stringify(result);
    if (serialized === undefined) {
      throw new TypeError("The tool result is not JSON serializable.");
    }
    return serialized;
  }
}

async function rejectWhenAborted<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    throw signal.reason;
  }

  return await new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });

    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
