import type {
  AssuranceScenarioOption,
  SafeAssuranceCase,
} from "../interface";
import {
  BOOKING_STATE_DRIFT_CASE_ID,
  bookingStateDriftCase,
} from "./booking-state-drift";
import {
  CLOUD_FALSE_SUCCESS_CASE_ID,
  cloudFalseSuccessCase,
} from "./cloud-false-success";
import {
  DUPLICATE_EFFECT_CASE_ID,
  duplicateEffectCase,
} from "./duplicate-effect";
import {
  DUPLICATE_REFUND_CASE_ID,
  duplicateRefundCase,
} from "./duplicate-refund";
import {
  FALSE_SUCCESS_CASE_ID,
  falseSuccessCase,
} from "./false-success";
import {
  REDIRECT_MISMATCH_CASE_ID,
  redirectMismatchCase,
} from "./redirect-mismatch";
import {
  SOCIAL_PUBLISH_CASE_ID,
  socialPublishCase,
} from "./social-publish";

const casesById = new Map<string, SafeAssuranceCase>([
  [BOOKING_STATE_DRIFT_CASE_ID, bookingStateDriftCase],
  [DUPLICATE_REFUND_CASE_ID, duplicateRefundCase],
  [CLOUD_FALSE_SUCCESS_CASE_ID, cloudFalseSuccessCase],
  [SOCIAL_PUBLISH_CASE_ID, socialPublishCase],
  [REDIRECT_MISMATCH_CASE_ID, redirectMismatchCase],
  [DUPLICATE_EFFECT_CASE_ID, duplicateEffectCase],
  [FALSE_SUCCESS_CASE_ID, falseSuccessCase],
]);

export const ASSURANCE_SCENARIO_OPTIONS: readonly AssuranceScenarioOption[] =
  Object.freeze([
    Object.freeze({
      id: BOOKING_STATE_DRIFT_CASE_ID,
      kind: "booking_state_drift" as const,
      industry: "Travel" as const,
      toolName: "confirm_booking",
      label: "Booking changed after approval",
      description: "Changed quote must stop the booking.",
    }),
    Object.freeze({
      id: DUPLICATE_REFUND_CASE_ID,
      kind: "duplicate_refund" as const,
      industry: "Payments" as const,
      toolName: "issue_refund",
      label: "Refund retried twice",
      description: "Two calls must create one refund.",
    }),
    Object.freeze({
      id: CLOUD_FALSE_SUCCESS_CASE_ID,
      kind: "cloud_false_success" as const,
      industry: "Cloud" as const,
      toolName: "deploy_service",
      label: "Deploy said done, state unchanged",
      description: "Unhealthy service must be reported failed.",
    }),
    Object.freeze({
      id: SOCIAL_PUBLISH_CASE_ID,
      kind: "social_publish" as const,
      industry: "Social" as const,
      toolName: "publish_post",
      label: "Post said live, stayed draft",
      description: "Draft state must reject the success claim.",
    }),
  ]);

export function getAssuranceCase(caseId: string): SafeAssuranceCase | undefined {
  return casesById.get(caseId);
}

export function isAssuranceCaseId(caseId: string): boolean {
  return casesById.has(caseId);
}

export {
  BOOKING_STATE_DRIFT_CASE_ID,
  CLOUD_FALSE_SUCCESS_CASE_ID,
  DUPLICATE_EFFECT_CASE_ID,
  DUPLICATE_REFUND_CASE_ID,
  FALSE_SUCCESS_CASE_ID,
  REDIRECT_MISMATCH_CASE_ID,
  SOCIAL_PUBLISH_CASE_ID,
};
