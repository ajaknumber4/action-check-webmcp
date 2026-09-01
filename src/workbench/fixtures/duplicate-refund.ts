import type { SafeAssuranceCase } from "../interface";

export const DUPLICATE_REFUND_CASE_ID = "duplicate-refund-01";

export const duplicateRefundCase: SafeAssuranceCase = Object.freeze({
  id: DUPLICATE_REFUND_CASE_ID,
  kind: "duplicate_refund",
  title: "Refund retried twice",
  objective: "Create one refund when a lost response causes a retry.",
  synthetic: true,
  safetyNotice: "Synthetic test · No payment is changed",
  effectTest: Object.freeze({
    industry: "Payments",
    toolName: "issue_refund",
    intent: "A lost response triggers a retry. Only one refund may exist.",
    passingBehavior: "Two tool calls create exactly one provider refund.",
    passTitle: "Duplicate refund prevented",
    fault: Object.freeze({
      kind: "duplicate_delivery",
      label: "Response lost after commit",
      description: "The provider accepts the first refund, but its response never reaches the tool.",
    }),
    negativeControl: Object.freeze({
      label: "Drop idempotency reuse",
      expectedFailure: "The retry creates a second provider refund.",
    }),
    contract: Object.freeze({
      effectId: "payment.refund",
      target: "payment:pay-204",
      readBefore: "payment.status",
      precondition: "payment.status == captured",
      approvalBinding: "payment + amount + currency",
      idempotencyKey: "refund.request_id",
      execute: "issue_refund",
      readAfter: "refunds.by_payment",
      postcondition: "refund.count == 1",
      evidenceSource: "synthetic provider refund ledger",
    }),
  }),
  summary: Object.freeze([
    Object.freeze({ id: "tool", label: "WebMCP tool", value: "issue_refund" }),
    Object.freeze({ id: "fault", label: "Failure injected", value: "First response is lost after the refund commits", emphasis: "danger" as const }),
    Object.freeze({ id: "expected", label: "Passing result", value: "Two calls, one refund" }),
    Object.freeze({ id: "production-effect", label: "Real changes", value: "None — synthetic test" }),
  ]),
  timeline: Object.freeze([
    Object.freeze({ id: "first-call", label: "First call accepted", status: "completed" as const, detail: "The synthetic provider records one refund." }),
    Object.freeze({ id: "lost-response", label: "Response lost", status: "blocked" as const, detail: "The caller receives no completion response." }),
    Object.freeze({ id: "retry", label: "Tool retried", status: "pending" as const, detail: "The same logical request is delivered again." }),
  ]),
});
