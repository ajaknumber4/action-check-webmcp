import { duplicateEffectCase } from "../fixtures/duplicate-effect";
import type {
  AssuranceFinding,
  OutcomeProofView,
} from "../interface";
import type { AssuranceScenarioDefinition } from "./definition";
import { freezePlan } from "./definition";

export const DUPLICATE_EFFECT_FINDING_ID = "finding-duplicate-effect-01";

export const duplicateEffectFinding: AssuranceFinding = Object.freeze({
  id: DUPLICATE_EFFECT_FINDING_ID,
  category: "duplicate_effect",
  severity: "blocking",
  title: "A retry created a second post",
  summary: "One publish request ran twice.",
  failedInvariant: "One publish request may create only one post.",
  evidence: Object.freeze([
    Object.freeze({
      label: "Posts created",
      expected: "1",
      observed: "2",
    }),
  ]),
  smallestSafeCorrection: "Reuse one publish ID so retries cannot create another post.",
  confidence: "high",
  requiresHumanApproval: true,
  repairAvailable: true,
});

export const duplicateEffectScenario: AssuranceScenarioDefinition = Object.freeze({
  safeCase: duplicateEffectCase,
  finding: duplicateEffectFinding,
  patch: Object.freeze({
    patchId: "patch-retry-policy-01",
    field: "retry_policy" as const,
    fieldLabel: "Retry handling",
    before: "Publish every retry",
    recommendedAfter: "Reuse one publish ID",
    permittedValues: Object.freeze([
      "Publish every retry",
      "Reuse one publish ID",
    ]),
  }),
  plan(patch) {
    const deduplicates = patch.after === "Reuse one publish ID";
    return freezePlan([
      {
        id: "capture-attempts",
        label: "Read attempts",
        status: "passed",
        detail: "Found two attempts for one publish request.",
      },
      {
        id: "commit-first",
        label: "Create first post",
        status: "passed",
        detail: "The first demo attempt created one post.",
      },
      {
        id: "handle-retry",
        label: "Stop duplicate",
        status: deduplicates ? "passed" : "failed",
        detail: deduplicates
          ? "The repeated publish ID was stopped before a second post."
          : "The retry created a second post.",
      },
      {
        id: "verify-effect-count",
        label: "Count posts",
        status: deduplicates ? "passed" : "failed",
        detail: deduplicates
          ? "The demo platform contains exactly one post."
          : "The demo platform contains two posts.",
      },
    ]);
  },
  createRuntime(patch) {
    const deduplicates = patch.after === "Reuse one publish ID";
    const logicalActionKey = "publish:P-204";
    const committedEffects: string[] = [];
    let attempts = 0;
    let duplicatesBlocked = 0;

    return Object.freeze({
      record(step) {
        if (step.id === "commit-first") {
          attempts += 1;
          committedEffects.push(logicalActionKey);
        }
        if (step.id === "handle-retry") {
          attempts += 1;
          if (deduplicates && committedEffects.includes(logicalActionKey)) {
            duplicatesBlocked += 1;
          } else {
            committedEffects.push(logicalActionKey);
          }
        }
      },
      evaluate() {
        const passed =
          attempts === 2 &&
          committedEffects.length === 1 &&
          duplicatesBlocked === 1;
        const proof: OutcomeProofView = Object.freeze({
          status: passed ? "passed" : "failed",
          disposition: passed ? "unsafe_outcome_prevented" : "invariant_failed",
          businessOutcome: passed ? "achieved" : "unsafe",
          invariant: duplicateEffectFinding.failedInvariant,
          summary: passed
            ? "Two attempts ran, but only one post was created."
            : "Two attempts created two posts because the retry was not stopped.",
          metrics: Object.freeze([
            Object.freeze({ label: "Publish attempts", value: String(attempts) }),
            Object.freeze({
              label: "Posts created",
              value: String(committedEffects.length),
            }),
            Object.freeze({
              label: "Duplicates stopped",
              value: String(duplicatesBlocked),
            }),
          ]),
          evidence: Object.freeze([
            Object.freeze({
              label: "Live post count",
              expected: "1 post",
              observed: committedEffects.length + " post" +
                (committedEffects.length === 1 ? "" : "s"),
            }),
          ]),
        });
        return Object.freeze({
          residualFindings: passed
            ? Object.freeze([])
            : Object.freeze([duplicateEffectFinding]),
          proof,
        });
      },
    });
  },
});
