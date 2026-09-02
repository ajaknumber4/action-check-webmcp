import type {
  BrowserCanaryReport,
  BrowserExternalTargetCanaryRunner,
} from "../../integrations/external-target-staging/browser-client";
import type {
  ModelContextRegistrar,
  WebMcpToolDefinition,
} from "./model-context-registrar";
import {
  emptyToolInputJsonSchema,
  emptyToolInputSchema,
} from "./tool-schemas";

export const EXTERNAL_TARGET_CANARY_TOOL_NAME = "run_external_target_canary";
export const MAX_EXTERNAL_TARGET_CANARY_RESULT_CHARACTERS = 1_500;

export type ExternalTargetCanaryToolRegistration = Readonly<{
  ready: Promise<void>;
  dispose(): void;
}>;

/**
 * Opt-in registration for the attested staging canary. The caller is
 * responsible for checking broker readiness before exposing this tool.
 */
export function registerExternalTargetCanaryTool(
  runner: BrowserExternalTargetCanaryRunner,
  registrar: ModelContextRegistrar,
): ExternalTargetCanaryToolRegistration {
  const lifecycle = new AbortController();
  const definition = createExternalTargetCanaryToolDefinition(runner);
  const ready = registrar
    .registerTool(definition, { signal: lifecycle.signal })
    .catch((error: unknown) => {
      lifecycle.abort(error);
      throw error;
    });

  return {
    ready,
    dispose() {
      if (lifecycle.signal.aborted) return;
      lifecycle.abort(
        new DOMException(
          "The External Target staging tool was disposed.",
          "AbortError",
        ),
      );
    },
  };
}

export function createExternalTargetCanaryToolDefinition(
  runner: BrowserExternalTargetCanaryRunner,
): WebMcpToolDefinition {
  return {
    name: EXTERNAL_TARGET_CANARY_TOOL_NAME,
    title: "Run External Target staging check",
    description:
      "Run the fixed isolated External Target staging publish canary. It cannot choose accounts, content, providers, credentials, or production targets.",
    inputSchema: emptyToolInputJsonSchema,
    annotations: {
      readOnlyHint: false,
      untrustedContentHint: false,
    },
    async execute(input, options) {
      const signal = options?.signal ?? new AbortController().signal;
      signal.throwIfAborted();

      if (!emptyToolInputSchema.safeParse(input).success) {
        return blockedReport("INVALID_REQUEST");
      }

      try {
        const report = await runner.run({ signal });
        signal.throwIfAborted();
        return boundedReport(report);
      } catch (error: unknown) {
        if (signal.aborted) {
          throw signal.reason ?? error;
        }
        return blockedReport("STAGING_REQUEST_FAILED");
      }
    },
  };
}

function boundedReport(report: BrowserCanaryReport): BrowserCanaryReport {
  try {
    if (
      JSON.stringify(report).length <=
      MAX_EXTERNAL_TARGET_CANARY_RESULT_CHARACTERS
    ) {
      return report;
    }
  } catch {
    // Fail closed without exposing malformed or unexpectedly large evidence.
  }

  return blockedReport("STAGING_REQUEST_FAILED");
}

function blockedReport(
  reason: "INVALID_REQUEST" | "STAGING_REQUEST_FAILED",
): BrowserCanaryReport {
  return {
    status: "blocked",
    reason,
    mutationAttempted: false,
    cleanup: "not_needed",
  };
}
