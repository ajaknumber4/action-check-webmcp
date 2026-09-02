// Pure verdict function for `action-check`. No I/O, no browser, no network --
// takes the recorded tool calls and the independently observed effect counts
// for each lane and decides PASS or FAIL.
//
// The scenario this checks: an agent that only trusts a WebMCP tool's own
// claims cannot tell a duplicated side effect from a safely-deduplicated
// retry. The "broken" lane's first `issue_refund` call always reports an
// ack-lost claim (the tool itself does not know whether the mutation landed),
// so a naive reading of the tool's claims alone implies at most one
// confirmed effect. The independent observation must show the broken lane
// actually produced two effects (the unsafe duplicate) and the protected
// lane produced exactly one (the retry was deduplicated). If the independent
// observation ever collapses back onto what the tool claimed, the whole
// point of the check -- that tool claims are not sufficient evidence -- is
// no longer being tested, so that also fails.

const ACK_LOST_ERROR_CODE = "PROVIDER_ACK_LOST_AFTER_COMMIT";

function isAckLostClaim(call) {
  if (!call || typeof call !== "object") return false;
  if (call.error && call.error.code === ACK_LOST_ERROR_CODE) return true;
  if (call.data && call.data.claim === "ack_lost") return true;
  return false;
}

function countClaimedNewEffects(calls) {
  if (!Array.isArray(calls)) return 0;
  return calls.filter((call) => {
    const claim = call && call.data && call.data.claim;
    return claim === "new_refund_created" || claim === "created";
  }).length;
}

function fail(reason) {
  return Object.freeze({ status: "FAIL", reason });
}

function pass(reason) {
  return Object.freeze({ status: "PASS", reason });
}

/**
 * @param {{ lanes: { broken: { calls: unknown[], observed: { effectCount: number } },
 *                     protected: { calls: unknown[], observed: { effectCount: number } } } }} input
 * @returns {{ status: "PASS" | "FAIL", reason: string }}
 */
export function computeVerdict(input) {
  const lanes = input && input.lanes;
  const broken = lanes && lanes.broken;
  const protectedLane = lanes && lanes.protected;

  if (!broken || !protectedLane) {
    return fail("missing broken or protected lane data");
  }
  if (!Array.isArray(broken.calls) || broken.calls.length < 2) {
    return fail("broken lane does not have two recorded issue_refund calls");
  }
  if (!Array.isArray(protectedLane.calls) || protectedLane.calls.length < 2) {
    return fail("protected lane does not have two recorded issue_refund calls");
  }
  if (!broken.observed || typeof broken.observed.effectCount !== "number") {
    return fail("broken lane has no independent observation with a numeric effectCount");
  }
  if (!protectedLane.observed || typeof protectedLane.observed.effectCount !== "number") {
    return fail("protected lane has no independent observation with a numeric effectCount");
  }

  if (!isAckLostClaim(broken.calls[0])) {
    return fail(
      "broken lane's first issue_refund call did not report an ack-lost claim; the retry-ambiguity scenario this check depends on was not reproduced",
    );
  }

  const claimedNewEffects = countClaimedNewEffects(broken.calls);
  if (claimedNewEffects > 1) {
    return fail(
      "broken lane's tool claims alone already imply more than one effect; the ack-lost ambiguity is not present in this run",
    );
  }

  if (broken.observed.effectCount !== 2) {
    return fail(
      `broken lane independent observation reports effectCount ${broken.observed.effectCount}, expected 2 (the unsafe retry should have duplicated the effect even though tool claims alone implied at most ${claimedNewEffects})`,
    );
  }

  if (protectedLane.observed.effectCount !== 1) {
    return fail(
      `protected lane independent observation reports effectCount ${protectedLane.observed.effectCount}, expected 1 (the idempotency-protected retry should have deduplicated)`,
    );
  }

  return pass(
    "broken lane's independently observed effectCount is 2 even though its tool claims alone implied at most 1 (first call: ack_lost); protected lane's independently observed effectCount is 1; the independent observation caught what tool claims alone could not.",
  );
}
