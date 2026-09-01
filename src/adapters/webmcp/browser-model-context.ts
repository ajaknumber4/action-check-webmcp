import type {
  ModelContextRegistrar,
  ModelContextRegistrationOptions,
  WebMcpToolDefinition,
} from "./model-context-registrar";

type BrowserWindowLike = Readonly<{
  top: unknown;
  isSecureContext?: boolean;
}>;

export type BrowserDocumentLike = Readonly<{
  defaultView: BrowserWindowLike | null;
  modelContext?: unknown;
}>;

type ImperativeModelContext = Readonly<{
  registerTool(
    tool: WebMcpToolDefinition,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<void>;
}>;

export type BrowserModelContextUnavailableReason =
  | "NO_ACTIVE_DOCUMENT"
  | "NOT_TOP_LEVEL"
  | "INSECURE_CONTEXT"
  | "API_UNAVAILABLE";

export type BrowserModelContextAvailability =
  | Readonly<{
      state: "available";
      message: "WebMCP is available in this top-level secure document.";
      registrar: ModelContextRegistrar;
    }>
  | Readonly<{
      state: "unavailable";
      reason: BrowserModelContextUnavailableReason;
      message: string;
    }>;

const registrarCache = new WeakMap<object, BrowserModelContextRegistrar>();

/**
 * Detects the judging-path prerequisites without claiming registration worked.
 * Actual progress and failures are exposed by registerWorkbenchTools().
 */
export function detectBrowserModelContext(
  documentLike: BrowserDocumentLike | undefined = currentDocument(),
): BrowserModelContextAvailability {
  if (!documentLike?.defaultView) {
    return unavailable(
      "NO_ACTIVE_DOCUMENT",
      "WebMCP needs an active browser document.",
    );
  }

  if (!isTopLevel(documentLike.defaultView)) {
    return unavailable(
      "NOT_TOP_LEVEL",
      "WebMCP tools are registered only from the top-level page.",
    );
  }

  if (documentLike.defaultView.isSecureContext === false) {
    return unavailable(
      "INSECURE_CONTEXT",
      "WebMCP needs a secure browser context.",
    );
  }

  if (!isImperativeModelContext(documentLike.modelContext)) {
    return unavailable(
      "API_UNAVAILABLE",
      "This browser does not expose the WebMCP imperative API.",
    );
  }

  const modelContext = documentLike.modelContext;
  let registrar = registrarCache.get(modelContext);
  if (!registrar) {
    registrar = new BrowserModelContextRegistrar(modelContext);
    registrarCache.set(modelContext, registrar);
  }

  return {
    state: "available",
    message: "WebMCP is available in this top-level secure document.",
    registrar,
  };
}

class BrowserModelContextRegistrar implements ModelContextRegistrar {
  readonly #modelContext: ImperativeModelContext;

  constructor(modelContext: ImperativeModelContext) {
    this.#modelContext = modelContext;
  }

  async registerTool(
    tool: WebMcpToolDefinition,
    options: ModelContextRegistrationOptions,
  ): Promise<void> {
    // No exposedTo option is supplied: same-origin is the intended boundary.
    await this.#modelContext.registerTool(tool, { signal: options.signal });
  }
}

function currentDocument(): BrowserDocumentLike | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }
  return document as unknown as BrowserDocumentLike;
}

function isTopLevel(view: BrowserWindowLike): boolean {
  try {
    return view.top === view;
  } catch {
    return false;
  }
}

function isImperativeModelContext(
  value: unknown,
): value is ImperativeModelContext & object {
  return (
    typeof value === "object" &&
    value !== null &&
    "registerTool" in value &&
    typeof value.registerTool === "function"
  );
}

function unavailable(
  reason: BrowserModelContextUnavailableReason,
  message: string,
): BrowserModelContextAvailability {
  return { state: "unavailable", reason, message };
}
