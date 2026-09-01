import { z } from "zod";

export const emptyToolInputSchema = z.object({}).strict();

export const findingToolInputSchema = z
  .object({
    findingId: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/),
  })
  .strict();

export const emptyToolInputJsonSchema = Object.freeze({
  type: "object",
  properties: Object.freeze({}),
  required: Object.freeze([]),
  additionalProperties: false,
}) satisfies Readonly<Record<string, unknown>>;

export const findingToolInputJsonSchema = Object.freeze({
  type: "object",
  properties: Object.freeze({
    findingId: Object.freeze({
      type: "string",
      minLength: 1,
      maxLength: 80,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$",
      description: "Identifier returned by run_diagnostics.",
    }),
  }),
  required: Object.freeze(["findingId"]),
  additionalProperties: false,
}) satisfies Readonly<Record<string, unknown>>;

export type FindingToolInput = z.infer<typeof findingToolInputSchema>;
