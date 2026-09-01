import { BOOKING_STATE_DRIFT_CASE_ID } from "../fixtures/booking-state-drift";
import { CLOUD_FALSE_SUCCESS_CASE_ID } from "../fixtures/cloud-false-success";
import { DUPLICATE_EFFECT_CASE_ID } from "../fixtures/duplicate-effect";
import { DUPLICATE_REFUND_CASE_ID } from "../fixtures/duplicate-refund";
import { FALSE_SUCCESS_CASE_ID } from "../fixtures/false-success";
import { REDIRECT_MISMATCH_CASE_ID } from "../fixtures/redirect-mismatch";
import { SOCIAL_PUBLISH_CASE_ID } from "../fixtures/social-publish";
import type { AssuranceScenarioDefinition } from "./definition";
import { bookingStateDriftScenario } from "./booking-state-drift";
import { cloudFalseSuccessScenario } from "./cloud-false-success";
import { duplicateEffectScenario } from "./duplicate-effect";
import { duplicateRefundScenario } from "./duplicate-refund";
import { falseSuccessScenario } from "./false-success";
import { socialPublishScenario } from "./social-publish";
import { staleApprovalScenario } from "./stale-approval";

const definitions = new Map<string, AssuranceScenarioDefinition>([
  [BOOKING_STATE_DRIFT_CASE_ID, bookingStateDriftScenario],
  [DUPLICATE_REFUND_CASE_ID, duplicateRefundScenario],
  [CLOUD_FALSE_SUCCESS_CASE_ID, cloudFalseSuccessScenario],
  [SOCIAL_PUBLISH_CASE_ID, socialPublishScenario],
  [REDIRECT_MISMATCH_CASE_ID, staleApprovalScenario],
  [DUPLICATE_EFFECT_CASE_ID, duplicateEffectScenario],
  [FALSE_SUCCESS_CASE_ID, falseSuccessScenario],
]);

export function getScenarioDefinition(
  caseId: string,
): AssuranceScenarioDefinition | undefined {
  return definitions.get(caseId);
}
