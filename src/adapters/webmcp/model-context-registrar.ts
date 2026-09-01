export type WebMcpToolAnnotations = Readonly<{
  readOnlyHint: boolean;
  untrustedContentHint: boolean;
}>;

export type WebMcpToolExecutionOptions = Readonly<{
  signal?: AbortSignal;
}>;

export type WebMcpToolDefinition = Readonly<{
  name: string;
  title: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
  annotations: WebMcpToolAnnotations;
  execute(
    input: unknown,
    options?: WebMcpToolExecutionOptions,
  ): Promise<unknown>;
}>;

export type ModelContextRegistrationOptions = Readonly<{
  signal: AbortSignal;
}>;

/**
 * The only external seam used by the WebMCP adapter. Browser production code
 * and contract tests both implement this interface.
 */
export interface ModelContextRegistrar {
  registerTool(
    tool: WebMcpToolDefinition,
    options: ModelContextRegistrationOptions,
  ): Promise<void>;
}
