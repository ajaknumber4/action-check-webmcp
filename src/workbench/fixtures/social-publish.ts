import type { SafeAssuranceCase } from "../interface";

export const SOCIAL_PUBLISH_CASE_ID = "social-publish-false-success-01";

export const socialPublishCase: SafeAssuranceCase = Object.freeze({
  id: SOCIAL_PUBLISH_CASE_ID,
  kind: "social_publish",
  title: "Post said live, stayed draft",
  objective: "Report a post as live only after the platform confirms it.",
  synthetic: true,
  safetyNotice: "Synthetic External Target reference · No post is published",
  effectTest: Object.freeze({
    industry: "Social",
    toolName: "publish_post",
    intent: "The publish call says done, but the platform still holds a draft.",
    passingBehavior: "The tool rejects the success claim until the post is live.",
    passTitle: "False publish success rejected",
    fault: Object.freeze({
      kind: "false_success",
      label: "Success response, draft post",
      description: "The publish action returns success while the authoritative post state remains Draft.",
    }),
    negativeControl: Object.freeze({
      label: "Trust the publish response",
      expectedFailure: "A draft post is reported as live.",
    }),
    contract: Object.freeze({
      effectId: "social.publish",
      target: "post:demo-205",
      readBefore: "post.version + post.status",
      precondition: "post.status == approved",
      approvalBinding: "account + content + media + version",
      idempotencyKey: "publish.request_id",
      execute: "publish_post",
      readAfter: "post.status",
      postcondition: "post.status == published",
      evidenceSource: "synthetic social platform state",
    }),
  }),
  summary: Object.freeze([
    Object.freeze({ id: "tool", label: "WebMCP tool", value: "publish_post" }),
    Object.freeze({ id: "fault", label: "Failure injected", value: "Publish says done while the post remains Draft", emphasis: "danger" as const }),
    Object.freeze({ id: "expected", label: "Passing result", value: "The false success is rejected" }),
    Object.freeze({ id: "production-effect", label: "Real changes", value: "None — synthetic test" }),
  ]),
  timeline: Object.freeze([
    Object.freeze({ id: "publish", label: "Publish requested", status: "completed" as const, detail: "The synthetic publish tool receives the request." }),
    Object.freeze({ id: "response", label: "Tool said live", status: "completed" as const, detail: "The tool returns a successful response." }),
    Object.freeze({ id: "state", label: "Post stayed draft", status: "blocked" as const, detail: "The platform state contradicts the tool response." }),
  ]),
});
