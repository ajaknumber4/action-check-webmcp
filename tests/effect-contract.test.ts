import { describe, expect, it } from "vitest";

import {
  ASSURANCE_SCENARIO_OPTIONS,
  BOOKING_STATE_DRIFT_CASE_ID,
  CLOUD_FALSE_SUCCESS_CASE_ID,
  DUPLICATE_REFUND_CASE_ID,
  SOCIAL_PUBLISH_CASE_ID,
  createAssuranceWorkbenchSession,
  type EffectContractView,
  type EffectTestProfile,
} from "../src/workbench";

const EXPECTED_PROFILES = [
  {
    id: BOOKING_STATE_DRIFT_CASE_ID,
    industry: "Travel",
    toolName: "confirm_booking",
    effectId: "booking.confirm",
  },
  {
    id: DUPLICATE_REFUND_CASE_ID,
    industry: "Payments",
    toolName: "issue_refund",
    effectId: "payment.refund",
  },
  {
    id: CLOUD_FALSE_SUCCESS_CASE_ID,
    industry: "Cloud",
    toolName: "deploy_service",
    effectId: "service.deploy",
  },
  {
    id: SOCIAL_PUBLISH_CASE_ID,
    industry: "Social",
    toolName: "publish_post",
    effectId: "social.publish",
  },
] as const;

const CONTRACT_STAGES = [
  "readBefore",
  "precondition",
  "approvalBinding",
  "idempotencyKey",
  "execute",
  "readAfter",
  "postcondition",
] as const satisfies readonly (keyof EffectContractView)[];

function profileFor(caseId: string): EffectTestProfile {
  const session = createAssuranceWorkbenchSession({ caseId });
  const profile = session.observe.getSnapshot().case.effectTest;
  session.close();
  if (!profile) throw new Error(`Missing effect-test profile for ${caseId}`);
  return profile;
}

describe("EffectContract profiles", () => {
  it("publishes exactly four frozen and unique cross-industry profiles", () => {
    expect(Object.isFrozen(ASSURANCE_SCENARIO_OPTIONS)).toBe(true);
    expect(
      ASSURANCE_SCENARIO_OPTIONS.map(({ id, industry, toolName }) => ({
        id,
        industry,
        toolName,
      })),
    ).toEqual(
      EXPECTED_PROFILES.map(({ id, industry, toolName }) => ({
        id,
        industry,
        toolName,
      })),
    );

    const profiles = EXPECTED_PROFILES.map(({ id }) => profileFor(id));
    for (const option of ASSURANCE_SCENARIO_OPTIONS) {
      expect(Object.isFrozen(option)).toBe(true);
    }
    for (const profile of profiles) {
      expect(Object.isFrozen(profile)).toBe(true);
      expect(Object.isFrozen(profile.fault)).toBe(true);
      expect(Object.isFrozen(profile.negativeControl)).toBe(true);
      expect(Object.isFrozen(profile.contract)).toBe(true);
      expect(profile.negativeControl.label).toMatch(/\S/);
      expect(profile.negativeControl.expectedFailure).toMatch(/\S/);
    }

    expect(new Set(EXPECTED_PROFILES.map(({ id }) => id)).size).toBe(4);
    expect(new Set(profiles.map(({ industry }) => industry)).size).toBe(4);
    expect(new Set(profiles.map(({ toolName }) => toolName)).size).toBe(4);
    expect(
      new Set(profiles.map(({ contract }) => contract.effectId)).size,
    ).toBe(4);
    expect(new Set(profiles.map(({ contract }) => contract.target)).size).toBe(
      4,
    );
  });

  it.each(EXPECTED_PROFILES)(
    "exposes the full seven-stage contract for $industry/$toolName",
    ({ id, toolName, effectId }) => {
      const profile = profileFor(id);

      expect(profile.contract.effectId).toBe(effectId);
      expect(profile.contract.execute).toBe(toolName);
      expect(profile.contract.target.length).toBeGreaterThan(0);
      expect(profile.contract.evidenceSource.length).toBeGreaterThan(0);
      expect(
        CONTRACT_STAGES.map((stage) => [stage, profile.contract[stage]]),
      ).toEqual(
        CONTRACT_STAGES.map((stage) => [
          stage,
          expect.stringMatching(/\S/),
        ]),
      );
    },
  );
});
