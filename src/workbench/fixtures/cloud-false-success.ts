import type { SafeAssuranceCase } from "../interface";

export const CLOUD_FALSE_SUCCESS_CASE_ID = "cloud-false-success-01";

export const cloudFalseSuccessCase: SafeAssuranceCase = Object.freeze({
  id: CLOUD_FALSE_SUCCESS_CASE_ID,
  kind: "cloud_false_success",
  title: "Deploy said done, state unchanged",
  objective: "Report success only after the service is healthy.",
  synthetic: true,
  safetyNotice: "Synthetic test · No service is deployed",
  effectTest: Object.freeze({
    industry: "Cloud",
    toolName: "deploy_service",
    intent: "The operation says complete, but the service remains unhealthy.",
    passingBehavior: "The tool rejects the success claim after checking service health.",
    passTitle: "False cloud success rejected",
    fault: Object.freeze({
      kind: "false_success",
      label: "Success response, unhealthy service",
      description: "The deploy operation returns done while the authoritative health check remains unhealthy.",
    }),
    negativeControl: Object.freeze({
      label: "Trust the operation response",
      expectedFailure: "An unhealthy service is reported as successfully deployed.",
    }),
    contract: Object.freeze({
      effectId: "service.deploy",
      target: "service:checkout-api",
      readBefore: "service.release + service.health",
      precondition: "release == approved.release",
      approvalBinding: "service + release + environment",
      idempotencyKey: "deployment.request_id",
      execute: "deploy_service",
      readAfter: "service.health",
      postcondition: "service.health == healthy",
      evidenceSource: "synthetic service control plane",
    }),
  }),
  summary: Object.freeze([
    Object.freeze({ id: "tool", label: "WebMCP tool", value: "deploy_service" }),
    Object.freeze({ id: "fault", label: "Failure injected", value: "Operation says done while service stays unhealthy", emphasis: "danger" as const }),
    Object.freeze({ id: "expected", label: "Passing result", value: "The tool reports the deployment as failed" }),
    Object.freeze({ id: "production-effect", label: "Real changes", value: "None — synthetic test" }),
  ]),
  timeline: Object.freeze([
    Object.freeze({ id: "deploy", label: "Deploy requested", status: "completed" as const, detail: "The synthetic operation accepts the request." }),
    Object.freeze({ id: "response", label: "Operation said done", status: "completed" as const, detail: "The operation returns a successful response." }),
    Object.freeze({ id: "health", label: "Service stayed unhealthy", status: "blocked" as const, detail: "The authoritative state contradicts the response." }),
  ]),
});
