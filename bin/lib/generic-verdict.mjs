// Pure verdict function for `action-check` external-target mode. No I/O.
//
// The caller has invoked one registered WebMCP tool on a page Action Check
// does not own, either once ("once") or twice with identical input
// ("retry"), and has asked a caller-supplied observe() for the effect count
// BEFORE the first call and AFTER the last one. The verdict compares what the
// tool claimed with what the observation shows.
//
//   retry: two identical calls must leave exactly one new effect.
//            delta 1  -> PASS (idempotent)
//            delta 0  -> FAIL NO_EFFECT
//            delta 2+ -> FAIL DUPLICATE_EFFECT
//   once:  one call; the claim and the effect must agree.
//            claimed success, delta >= 1 -> PASS
//            claimed success, delta 0    -> FAIL FALSE_SUCCESS
//            claimed failure, delta >= 1 -> FAIL SILENT_EFFECT
//            claimed failure, delta 0    -> PASS HONEST_REFUSAL
//
// observe() is never handed the tool results, so it cannot echo the claim;
// it has to read the page or a read-only tool on its own.

function fail(code, reason, extra = {}) {
  return Object.freeze({ status: "FAIL", code, reason, ...extra });
}

function pass(code, reason, extra = {}) {
  return Object.freeze({ status: "PASS", code, reason, ...extra });
}

// Many demos reply with a sentence rather than a structured result. A reply
// that reads as a refusal ("Topping X not found", "Invalid date") is a
// failure claim; anything else is a success claim. Bounded heuristic, and
// the raw reply is kept in the proof so a reader can check the call.
const REFUSAL_PATTERN = /\b(not found|no such|invalid|failed|failure|cannot|can't|unable|error|rejected|denied|missing|unavailable|does not exist|doesn't exist)\b/i;

/** A tool result "claims success" unless it is an explicit failure shape. */
export function claimsSuccess(result) {
  if (result === null || result === undefined) return false;
  if (typeof result === "string") return !REFUSAL_PATTERN.test(result);
  if (typeof result !== "object") return true;
  if (result.thrown !== undefined) return false;
  if (result.ok === false) return false;
  if (result.isError === true) return false;
  if (result.success === false) return false;
  if (result.error && result.ok !== true) return false;
  // MCP-style content payloads ({ content: [{ type: "text", text }] }) carry
  // the claim in their text.
  if (Array.isArray(result.content)) {
    const text = result.content.filter((part) => part && typeof part.text === "string").map((part) => part.text).join(" ");
    if (text) return !REFUSAL_PATTERN.test(text);
  }
  return true;
}

function effectCountOf(observation) {
  return observation && typeof observation.effectCount === "number" && Number.isFinite(observation.effectCount)
    ? observation.effectCount
    : null;
}

/**
 * @param {{ mode: "retry" | "once", calls: unknown[], before: { effectCount: number }, after: { effectCount: number } }} input
 * @returns {{ status: "PASS" | "FAIL", code: string, reason: string, effectDelta?: number }}
 */
export function computeGenericVerdict(input) {
  const mode = input && input.mode;
  const calls = input && Array.isArray(input.calls) ? input.calls : null;
  const before = effectCountOf(input && input.before);
  const after = effectCountOf(input && input.after);

  if (mode !== "retry" && mode !== "once") return fail("HARNESS", `unknown mode "${mode}"`);
  if (before === null || after === null) {
    return fail("HARNESS", "observe() must return a numeric effectCount before the first call and after the last one");
  }
  const expectedCalls = mode === "retry" ? 2 : 1;
  if (!calls || calls.length !== expectedCalls) {
    return fail("HARNESS", `${mode} mode records exactly ${expectedCalls} tool call(s); got ${calls ? calls.length : 0}`);
  }

  const effectDelta = after - before;
  const claimed = calls.map(claimsSuccess);

  if (mode === "retry") {
    if (effectDelta >= 2) {
      return fail(
        "DUPLICATE_EFFECT",
        `two identical calls created ${effectDelta} new effects (observed ${before} -> ${after}); the tool is not idempotent on retry`,
        { effectDelta },
      );
    }
    if (effectDelta <= 0) {
      return fail(
        "NO_EFFECT",
        `two identical calls created no observable effect (observed ${before} -> ${after}) although the tool ${claimed.some(Boolean) ? "claimed success" : "reported failure"}`,
        { effectDelta },
      );
    }
    return pass(
      "IDEMPOTENT",
      `two identical calls left exactly one new effect (observed ${before} -> ${after}); second call ${claimed[1] ? "claimed success and reused the effect" : "was refused by the tool"}`,
      { effectDelta },
    );
  }

  const claimedSuccess = claimed[0];
  if (claimedSuccess && effectDelta >= 1) {
    return pass("EFFECT_CONFIRMED", `the tool claimed success and ${effectDelta} effect(s) appeared (observed ${before} -> ${after})`, { effectDelta });
  }
  if (claimedSuccess && effectDelta <= 0) {
    return fail("FALSE_SUCCESS", `the tool claimed success but no effect appeared (observed ${before} -> ${after})`, { effectDelta });
  }
  if (!claimedSuccess && effectDelta >= 1) {
    return fail("SILENT_EFFECT", `the tool reported failure but ${effectDelta} effect(s) appeared anyway (observed ${before} -> ${after})`, { effectDelta });
  }
  return pass("HONEST_REFUSAL", `the tool reported failure and nothing changed (observed ${before} -> ${after})`, { effectDelta });
}
