import type { SafeAssuranceCase } from "../interface";

export const BOOKING_STATE_DRIFT_CASE_ID = "booking-state-drift-01";

export const bookingStateDriftCase: SafeAssuranceCase = Object.freeze({
  id: BOOKING_STATE_DRIFT_CASE_ID,
  kind: "booking_state_drift",
  title: "Booking changed after approval",
  objective: "Confirm a booking only while the approved quote is still current.",
  synthetic: true,
  safetyNotice: "Synthetic test · No booking is created",
  effectTest: Object.freeze({
    industry: "Travel",
    toolName: "confirm_booking",
    intent: "The price changes after approval. The tool must stop before booking.",
    passingBehavior: "No booking is created after the approved quote changes.",
    passTitle: "Changed booking stopped",
    fault: Object.freeze({
      kind: "state_drift",
      label: "Quote changes after approval",
      description: "The quote moves from version 17 to 18 before the tool runs.",
    }),
    negativeControl: Object.freeze({
      label: "Skip the quote-version check",
      expectedFailure: "A booking is created from the changed quote.",
    }),
    contract: Object.freeze({
      effectId: "booking.confirm",
      target: "booking:trip-204",
      readBefore: "quote.version + quote.total",
      precondition: "quote.version == approved.version",
      approvalBinding: "traveler + itinerary + total + version",
      idempotencyKey: "booking.request_id",
      execute: "confirm_booking",
      readAfter: "bookings.by_request_id",
      postcondition: "on drift: booking.count == 0",
      evidenceSource: "synthetic booking ledger",
    }),
  }),
  summary: Object.freeze([
    Object.freeze({ id: "tool", label: "WebMCP tool", value: "confirm_booking" }),
    Object.freeze({ id: "fault", label: "Failure injected", value: "Approved quote changes before execution", emphasis: "danger" as const }),
    Object.freeze({ id: "expected", label: "Passing result", value: "The tool refuses to create the booking" }),
    Object.freeze({ id: "production-effect", label: "Real changes", value: "None — synthetic test" }),
  ]),
  timeline: Object.freeze([
    Object.freeze({ id: "approval", label: "Quote approved", status: "completed" as const, detail: "Quote version 17 was approved." }),
    Object.freeze({ id: "drift", label: "Quote changed", status: "blocked" as const, detail: "The price changed and the quote advanced to version 18." }),
    Object.freeze({ id: "execute", label: "Booking attempted", status: "pending" as const, detail: "The contract decides whether execution is allowed." }),
  ]),
});
