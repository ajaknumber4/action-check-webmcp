import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RefundProofHero } from "../src/app/RefundProofHero";
import type {
  RefundComparisonView,
  RefundTrialRef,
} from "../src/refund-comparison";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
});

const TRIAL_REF: RefundTrialRef = {
  trialId: "refund-trial-1",
  epoch: 1,
  digest: "trial-digest-1",
};

const EMPTY_LANE = {
  attempts: 0,
  providerRefunds: 0,
  recovery: "ready",
  finalState: "not_run",
  lastClaim: "none",
} as const;

const IDLE_VIEW: RefundComparisonView = {
  phase: "idle",
  trial: null,
  lanes: { broken: EMPTY_LANE, protected: EMPTY_LANE },
  proof: null,
};

function pendingView(): RefundComparisonView {
  return {
    ...IDLE_VIEW,
    phase: "awaiting_approval",
    trial: {
      ref: TRIAL_REF,
      approvalStatus: "pending",
      paymentId: "pay-204",
      amountMinor: 4200,
      currency: "USD",
      requestId: "refund-request-204",
    },
  };
}

function approvedView(): RefundComparisonView {
  const pending = pendingView();
  return {
    ...pending,
    phase: "approved",
    trial: { ...pending.trial!, approvalStatus: "approved" },
  };
}

function laneView(
  lane: "broken" | "protected",
  attempts: 0 | 1 | 2,
): RefundComparisonView["lanes"]["broken"] {
  if (attempts === 0) return EMPTY_LANE;
  if (attempts === 1) {
    return {
      attempts: 1,
      providerRefunds: 1,
      recovery: "ready",
      finalState: "refunded_once",
      lastClaim: "provider_ack_lost",
    };
  }
  return lane === "broken"
    ? {
        attempts: 2,
        providerRefunds: 2,
        recovery: "ready",
        finalState: "refunded_twice",
        lastClaim: "created",
      }
    : {
        attempts: 2,
        providerRefunds: 1,
        recovery: "ready",
        finalState: "refunded_once",
        lastClaim: "reused",
      };
}

function runningView(
  brokenAttempts: 0 | 1 | 2,
  protectedAttempts: 0 | 1 | 2,
): RefundComparisonView {
  const approved = approvedView();
  return {
    ...approved,
    phase: "running",
    lanes: {
      broken: laneView("broken", brokenAttempts),
      protected: laneView("protected", protectedAttempts),
    },
  };
}

function proofReadyView(): RefundComparisonView {
  return {
    phase: "proof_ready",
    trial: {
      ref: TRIAL_REF,
      approvalStatus: "approved",
      paymentId: "pay-204",
      amountMinor: 4200,
      currency: "USD",
      requestId: "refund-request-204",
    },
    lanes: {
      broken: {
        attempts: 2,
        providerRefunds: 2,
        recovery: "ready",
        finalState: "refunded_twice",
        lastClaim: "created",
      },
      protected: {
        attempts: 2,
        providerRefunds: 1,
        recovery: "ready",
        finalState: "refunded_once",
        lastClaim: "reused",
      },
    },
    proof: {
      status: "passed",
      summary:
        "The same retry duplicated the broken refund and was deduplicated by the protected target.",
      broken: {
        verdict: "failed_as_expected",
        attempts: 2,
        providerRefunds: 2,
        effectIds: ["sim-refund-1-broken-1", "sim-refund-1-broken-2"],
      },
      protected: {
        verdict: "passed",
        attempts: 2,
        providerRefunds: 1,
        effectIds: ["sim-refund-1-protected-1"],
      },
      trialRef: TRIAL_REF,
      requestId: "refund-request-204",
      deploymentId: "browser-contract-fixture",
      attestationDigest: "browser-contract-fixture:v1",
      evidenceDigests: {
        broken: "fixture-broken",
        protected: "fixture-protected",
      },
      evidenceSource: "one append-only synthetic provider ledger with separate lane records",
      receipt: "# Refund retry proof",
    },
  };
}

describe("RefundProofHero", () => {
  it("shows exactly the three registered agent tools and their ready state", () => {
    render(
      <RefundProofHero
        view={IDLE_VIEW}
        registration={{ state: "ready", label: "Native WebMCP ready" }}
        onApprove={async () => {}}
      />,
    );

    const tools = within(screen.getByRole("region", { name: "Agent tools" }));
    expect(tools.getAllByRole("listitem")).toHaveLength(3);
    for (const toolName of [
      "stage_refund_comparison",
      "issue_refund",
      "prove_refund_comparison",
    ]) {
      expect(tools.getByText(toolName)).toBeVisible();
    }
    expect(tools.getByText("Ready", { exact: true })).toBeVisible();
    expect(tools.getByText("3 registered tools", { exact: true })).toBeVisible();
    expect(tools.queryByText("run_social_neuron_canary")).not.toBeInTheDocument();
  });

  it("keeps registered WebMCP tools visibly blocked when external staging is missing", () => {
    render(
      <RefundProofHero
        view={IDLE_VIEW}
        registration={{ state: "ready", label: "Native WebMCP ready" }}
        stagingTarget={{ state: "missing", label: "Not configured" }}
        onApprove={async () => {}}
      />,
    );

    expect(
      screen.getByRole("status", {
        name: "External staging target: Not configured",
      }),
    ).toBeVisible();
    expect(screen.getByRole("region", { name: "Workflow blocked" })).toHaveAttribute(
      "data-next-action",
      "configure-target",
    );
    expect(screen.getByText("Connect the external staging target")).toBeVisible();
    expect(screen.queryByLabelText("Agent prompt")).not.toBeInTheDocument();
  });

  it("guides the human-agent handoff through every workflow state", () => {
    const registration = { state: "ready", label: "Native WebMCP ready" } as const;
    const { rerender } = render(
      <RefundProofHero
        view={IDLE_VIEW}
        registration={registration}
        onApprove={async () => {}}
      />,
    );

    const expectGuide = (
      accessibleName: string,
      action: string,
      visibleInstruction: string,
    ) => {
      const guide = screen.getByRole("region", { name: accessibleName });
      expect(guide).toHaveAttribute("data-next-action", action);
      expect(guide).toHaveAttribute("aria-live", "polite");
      expect(within(guide).getByText(visibleInstruction, { exact: false })).toBeVisible();
      return guide;
    };

    expectGuide("Next actor: Agent", "stage", "Send this instruction to your agent");
    expect(
      screen.getByRole("list", { name: "Agent to outcome proof path" })
        .querySelector('[aria-current="step"]'),
    ).toHaveTextContent("You + agent");
    expect(screen.getByRole("button", { name: "Copy agent instruction" })).toBeVisible();

    rerender(
      <RefundProofHero
        view={pendingView()}
        registration={registration}
        onApprove={async () => {}}
      />,
    );
    expectGuide("Next actor: Human", "approve", "Staging reset passed");
    expect(screen.getAllByText("Agent is waiting", { exact: true })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Approve exact staging refund" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Copy agent instruction" })).not.toBeInTheDocument();

    rerender(
      <RefundProofHero
        view={approvedView()}
        registration={registration}
        onApprove={async () => {}}
      />,
    );
    expectGuide("Next actor: Agent", "deliver", "Return to your agent and say continue");
    expect(screen.getByRole("button", { name: "Copy agent instruction" })).toBeVisible();

    rerender(
      <RefundProofHero
        view={runningView(1, 0)}
        registration={registration}
        onApprove={async () => {}}
      />,
    );
    expectGuide("Next actor: Agent", "retry", "Retry with the same request ID");
    expect(screen.getByLabelText("Agent prompt")).toHaveTextContent(
      'Retry issue_refund once for lane "broken"',
    );

    rerender(
      <RefundProofHero
        view={runningView(2, 0)}
        registration={registration}
        onApprove={async () => {}}
      />,
    );
    expectGuide("Next actor: Agent", "deliver", "Run the remaining version");
    expect(screen.getByLabelText("Agent prompt")).not.toHaveTextContent(
      'Call issue_refund twice for lane "broken"',
    );
    expect(screen.getByLabelText("Agent prompt")).toHaveTextContent(
      'Do not call issue_refund again for lane "broken"',
    );

    rerender(
      <RefundProofHero
        view={runningView(2, 2)}
        registration={registration}
        onApprove={async () => {}}
      />,
    );
    expectGuide("Next actor: Agent", "prove", "Verify the outcome");
    expect(
      screen.getByRole("list", { name: "Agent to outcome proof path" })
        .querySelector('[aria-current="step"]'),
    ).toHaveTextContent("Action Check");

    rerender(
      <RefundProofHero
        view={proofReadyView()}
        registration={registration}
        onApprove={async () => {}}
      />,
    );
    expectGuide("Workflow complete", "complete", "Unsafe created 2 refunds. Protected created 1.");
    expect(
      screen.getByRole("list", { name: "Agent to outcome proof path" })
        .querySelector('[aria-current="step"]'),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy agent instruction" })).not.toBeInTheDocument();
  });

  it("stages a fresh trial instead of telling the agent to retry a locked lane", () => {
    const locked = runningView(1, 0);
    render(
      <RefundProofHero
        view={{
          ...locked,
          lanes: {
            ...locked.lanes,
            broken: { ...locked.lanes.broken, recovery: "reset_required" },
          },
        }}
        registration={{ state: "ready", label: "Native WebMCP ready" }}
        onApprove={async () => {}}
      />,
    );

    const guide = screen.getByRole("region", { name: "Workflow blocked" });
    expect(guide).toHaveAttribute("data-next-action", "stage");
    expect(guide).toHaveTextContent("Outcome evidence did not match");
    expect(guide).toHaveTextContent("Do not retry the locked lane");
    expect(screen.getByLabelText("Agent prompt")).toHaveTextContent(
      "Call stage_refund_comparison",
    );
    expect(screen.getByText("Fresh trial required", { selector: "span" })).toBeVisible();
  });

  it("explains the native WebMCP boundary while idle", () => {
    render(
      <RefundProofHero
        view={IDLE_VIEW}
        registration={{ state: "unavailable", label: "Unavailable in this browser" }}
        onApprove={async () => {}}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Can one retry accidentally refund twice?" }),
    ).toBeVisible();
    expect(screen.getByText("Native WebMCP").closest("div")).toHaveTextContent(
      "Unavailable in this browser",
    );
    const tools = within(screen.getByRole("region", { name: "Agent tools" }));
    expect(tools.getByText("Available on this page", { exact: true })).toBeVisible();
    expect(tools.getByText("Unavailable", { exact: true })).toBeVisible();
    expect(tools.getByText("0 registered tools", { exact: true })).toBeVisible();
    expect(screen.queryByLabelText("Agent prompt")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Agent prompt unavailable")).toHaveTextContent(
      "WebMCP-capable top-level browser",
    );
    expect(screen.getByText(/cannot register the three-tool agent path/)).toBeVisible();
    expect(screen.queryByText(/real, registered WebMCP tool/)).not.toBeInTheDocument();
    expect(screen.getByText(/UI-only synthetic suite below remains available/)).toBeVisible();
    expect(screen.getByLabelText("Agent prompt unavailable")).toHaveTextContent(
      "native agent path",
    );
    expect(screen.getByText(/Chrome 149\+.*ChatGPT.*browser/i)).toBeVisible();
    const path = within(
      screen.getByRole("list", { name: "Agent to outcome proof path" }),
    );
    for (const stage of ["You + agent", "You", "Agent", "Action Check"]) {
      expect(path.getByText(stage)).toBeVisible();
    }
    expect(screen.getByRole("region", { name: "Workflow blocked" })).toHaveAttribute(
      "data-next-action",
      "enable-webmcp",
    );
    expect(screen.getAllByText("Not staged")).toHaveLength(4);
    expect(
      screen.queryByRole("button", { name: "Approve exact staging refund" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Staging sandbox only.")).toBeVisible();
  });

  it("copies the exact state-aware agent prompt and confirms the action", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <RefundProofHero
        view={IDLE_VIEW}
        registration={{ state: "ready", label: "Native WebMCP ready" }}
        onApprove={async () => {}}
      />,
    );

    const prompt = screen.getByLabelText("Agent prompt");
    const exactPrompt = prompt.querySelector("code")?.textContent;
    expect(exactPrompt).toBeTruthy();
    expect(prompt).toHaveTextContent("The agent will stage the $42 test and stop for your approval.");
    const exactInstructions = within(prompt).getByText(
      "View exact WebMCP instructions",
    );
    expect(exactInstructions).toBeVisible();
    expect(prompt.querySelector("code")).not.toBeVisible();
    await user.click(exactInstructions);
    expect(prompt.querySelector("code")).toBeVisible();

    await user.click(
      within(prompt).getByRole("button", { name: "Copy agent instruction" }),
    );

    expect(writeText).toHaveBeenCalledWith(exactPrompt);
    expect(
      within(prompt).getByRole("button", { name: "Copied" }),
    ).toBeVisible();
    expect(
      within(prompt).getByRole("status", { name: "Prompt copied" }),
    ).toBeInTheDocument();
  });

  it("shows the exact staged values and sends the bound trial reference for approval", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn(async (_expected: RefundTrialRef) => {});
    render(
      <RefundProofHero
        view={pendingView()}
        registration={{ state: "ready", label: "Native WebMCP ready" }}
        onApprove={onApprove}
      />,
    );

    const checkpoint = screen.getByRole("region", {
      name: "Exact staging refund fixture",
    });
    expect(within(checkpoint).getByText("pay-204")).toBeVisible();
    expect(within(checkpoint).getByText("42.00 USD")).toBeVisible();
    expect(within(checkpoint).getByText("refund-request-204")).toBeVisible();
    expect(within(checkpoint).getByText("refund-trial-1")).toBeVisible();
    expect(within(checkpoint).getByText("Pending")).toBeVisible();

    const prompt = screen.getByLabelText("Agent prompt");
    for (const requiredText of [
      'lane "broken"',
      'lane "protected"',
      'paymentId "pay-204"',
      "amountMinor 4200",
      'currency "USD"',
      'requestId "refund-request-204"',
      "PROVIDER_ACK_LOST_AFTER_COMMIT",
      "retry once with identical arguments",
    ]) {
      expect(prompt).toHaveTextContent(requiredText);
    }

    expect(within(checkpoint).getByText("trial-digest-1")).not.toBeVisible();
    await user.click(
      within(checkpoint).getByText("Show binding details"),
    );
    expect(within(checkpoint).getByText("1", { selector: "code" })).toBeVisible();
    expect(within(checkpoint).getByText("trial-digest-1")).toBeVisible();

    await user.click(
      within(checkpoint).getByRole("button", {
        name: "Approve exact staging refund",
      }),
    );

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledWith(TRIAL_REF);
  });

  it("keeps the checkpoint blocked when approval is rejected", async () => {
    const user = userEvent.setup();
    render(
      <RefundProofHero
        view={pendingView()}
        registration={{ state: "ready", label: "Native WebMCP ready" }}
        onApprove={async () => {
          throw new Error("stale approval");
        }}
      />,
    );

    const button = screen.getByRole("button", {
      name: "Approve exact staging refund",
    });
    await user.click(button);

    expect(
      await screen.findByText(/Approval did not complete/),
    ).toHaveAttribute("role", "alert");
    expect(button).toBeEnabled();
    expect(screen.getByText("Pending")).toBeVisible();
  });

  it("renders effect-ledger proof metrics when proof is ready", () => {
    render(
      <RefundProofHero
        view={proofReadyView()}
        registration={{ state: "ready", label: "3 native tools ready" }}
        onApprove={async () => {}}
      />,
    );

    const comparison = screen.getByLabelText("Refund retry comparison");
    const broken = within(comparison).getByRole("region", {
      name: "Unsafe retry",
    });
    const protectedLane = within(comparison).getByRole("region", {
      name: "Protected retry",
    });

    expect(broken).toHaveTextContent("Tool calls2");
    expect(broken).toHaveTextContent("Refunds created2");
    expect(broken).toHaveTextContent("Refunded twice");
    expect(protectedLane).toHaveTextContent("Tool calls2");
    expect(protectedLane).toHaveTextContent("Refunds created1");
    expect(protectedLane).toHaveTextContent("Refunded once");

    const proof = screen.getByRole("region", {
      name: "Caught the unsafe duplicate. Protected stayed single.",
    });
    expect(within(proof).getByText("Checker validated", { exact: true })).toBeVisible();
    expect(proof).toHaveTextContent("2 calls → 2 effects");
    expect(proof).toHaveTextContent("2 calls → 1 effect");
    expect(proof).toHaveTextContent("one append-only synthetic provider ledger with separate lane records");
    expect(proof).toHaveTextContent("trial-digest-1");
    expect(proof).toHaveTextContent("sim-refund-1-broken-2");
    expect(proof).toHaveTextContent("sim-refund-1-protected-1");
    expect(screen.queryByLabelText("Agent prompt")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve exact staging refund" }),
    ).not.toBeInTheDocument();
  });

  it("announces one next actor and moves focus to the required human action and proof", () => {
    const readyRegistration = { state: "ready", label: "Native WebMCP ready" } as const;
    const { rerender } = render(
      <RefundProofHero
        view={IDLE_VIEW}
        registration={readyRegistration}
        onApprove={async () => {}}
      />,
    );

    rerender(
      <RefundProofHero
        view={pendingView()}
        registration={readyRegistration}
        onApprove={async () => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Approve exact staging refund" }),
    ).toHaveFocus();
    expect(screen.getByRole("region", { name: "Next actor: Human" })).toHaveAttribute(
      "aria-live",
      "polite",
    );

    const approved = pendingView();
    rerender(
      <RefundProofHero
        view={{
          ...approved,
          phase: "approved",
          trial: { ...approved.trial!, approvalStatus: "approved" },
        }}
        registration={readyRegistration}
        onApprove={async () => {}}
      />,
    );
    expect(
      screen.getByRole("region", { name: "Exact staging refund fixture" }),
    ).toHaveFocus();
    expect(screen.getByRole("region", { name: "Next actor: Agent" })).toHaveAttribute(
      "data-next-action",
      "deliver",
    );

    rerender(
      <RefundProofHero
        view={proofReadyView()}
        registration={readyRegistration}
        onApprove={async () => {}}
      />,
    );
    expect(
      screen.getByRole("region", { name: "Caught the unsafe duplicate. Protected stayed single." }),
    ).toHaveFocus();
    expect(screen.getByRole("region", { name: "Workflow complete" })).toHaveAttribute(
      "data-next-action",
      "complete",
    );
  });
});
