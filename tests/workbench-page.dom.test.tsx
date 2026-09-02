import { useEffect, useState } from "react";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWorkbenchView } from "../src/adapters/react/use-workbench-view";
import { useRefundComparisonView } from "../src/adapters/react/use-refund-comparison-view";
import { App } from "../src/app/App";
import {
  WorkbenchPage,
  type ExternalTargetCanaryDisplay,
} from "../src/app/WorkbenchPage";
import {
  createRefundComparisonSession,
  type RefundTrialRef,
} from "../src/refund-comparison";
import {
  DUPLICATE_REFUND_CASE_ID,
  SOCIAL_PUBLISH_CASE_ID,
  createAssuranceWorkbenchSession,
  type AgentCommand,
  type HumanCommand,
} from "../src/workbench";

afterEach(cleanup);

function EffectRunnerHarness({
  caseId = DUPLICATE_REFUND_CASE_ID,
  canary = { state: "blocked", reason: "STAGING_NOT_CONFIGURED" },
  onRunCanary = async () => {},
}: {
  caseId?: string;
  canary?: ExternalTargetCanaryDisplay;
  onRunCanary?: () => Promise<void>;
}) {
  const [session] = useState(() =>
    createAssuranceWorkbenchSession({ caseId }),
  );
  const [refundComparison] = useState(() => createRefundComparisonSession());
  const view = useWorkbenchView(session.observe);
  const refundComparisonView = useRefundComparisonView(refundComparison.observe);
  useEffect(
    () => () => {
      session.close();
      refundComparison.close();
    },
    [refundComparison, session],
  );

  return (
    <WorkbenchPage
      view={view}
      refundComparison={refundComparisonView}
      registration={{ state: "ready", label: "Agent tools ready" }}
      externalTargetCanary={canary}
      onRunExternalTargetCanary={onRunCanary}
      onApproveRefundComparison={(expected: RefundTrialRef) =>
        refundComparison.human.approve(expected).then(() => undefined)
      }
      executeAgent={(command: AgentCommand) => session.agent.execute(command)}
      executeHuman={(command: HumanCommand) => session.human.execute(command)}
    />
  );
}

function dispatchPageHide(persisted: boolean) {
  const event = new Event("pagehide");
  Object.defineProperty(event, "persisted", { value: persisted });
  act(() => window.dispatchEvent(event));
}

describe("Action Check effect runner", () => {
  it("offers four cross-industry scenario choices and exposes the selected contract", async () => {
    const user = userEvent.setup();
    render(<EffectRunnerHarness />);

    expect(
      screen.getByRole("heading", {
        name: "Test what WebMCP actions actually change.",
      }),
    ).toBeVisible();
    expect(screen.getByText("4 synthetic contracts")).toBeVisible();

    const hero = screen.getByRole("region", {
      name: "Test what WebMCP actions actually change.",
    });
    const supporting = screen.getByRole("region", {
      name: "Supporting effect tests",
    });

    const suite = within(
      screen.getByRole("complementary", { name: "Test suite" }),
    );
    const suiteElement = screen.getByRole("complementary", {
      name: "Test suite",
    });
    expect(
      hero.compareDocumentPosition(suiteElement) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      suiteElement.compareDocumentPosition(supporting) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(suite.getByText("Simulated examples")).toBeVisible();
    expect(
      suite.getByText(/page controls, not registered agent tools/i),
    ).toBeVisible();
    expect(
      screen.queryByText(/External Target is one reference case/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText("AC", { exact: true })).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    const choices = [
      {
        label: "Booking changed after approval",
        effectId: "booking.confirm",
      },
      {
        label: "Refund retried twice",
        effectId: "payment.refund",
      },
      {
        label: "Deploy said done, state unchanged",
        effectId: "service.deploy",
      },
      {
        label: "Post said live, stayed draft",
        effectId: "social.publish",
      },
    ] as const;

    expect(suite.getAllByRole("button")).toHaveLength(4);

    for (const choice of choices) {
      const selector = suite.getByRole("button", {
        name: new RegExp(choice.label),
      });
      await user.click(selector);

      expect(
        await screen.findByRole("heading", { name: choice.label }),
      ).toBeVisible();
      expect(selector).toHaveAttribute("aria-pressed", "true");
      expect(
        within(
          screen.getByRole("region", { name: "What this test checks" }),
        ).getByText(choice.effectId),
      ).toBeVisible();
    }

    await user.click(
      screen.getByText("Technical details", { selector: "summary", exact: false }),
    );
    expect(screen.getByText("Execution path").closest("div")).toHaveTextContent(
      "UI-only synthetic fixture",
    );
    expect(screen.queryByText("Native WebMCP transport")).not.toBeInTheDocument();
  });

  it("passes the duplicate-refund test with one click, two calls, and one refund", async () => {
    const user = userEvent.setup();
    render(<EffectRunnerHarness />);

    await user.click(screen.getByRole("button", { name: "Run test" }));

    const report = within(
      await screen.findByRole("region", {
        name: "Duplicate refund prevented",
      }),
    );
    expect(report.getByText("Check result").closest("div")).toHaveTextContent(
      "PASS",
    );
    expect(
      report.getByRole("status", {
        name: "Check result: PASS. Duplicate refund prevented",
      }),
    ).toBeVisible();
    expect(report.getByText("Tool calls").closest("div")).toHaveTextContent(
      "2",
    );
    expect(
      report.getByText("Provider refunds").closest("div"),
    ).toHaveTextContent("1");
    expect(
      report.getByText("Observed outcome").closest("div"),
    ).toHaveTextContent("Safe effect achieved");
  });

  it("catches the broken duplicate-refund version and then recovers with the safe version", async () => {
    const user = userEvent.setup();
    render(<EffectRunnerHarness />);

    await user.click(
      screen.getByRole("button", { name: "Prove this test catches the bug" }),
    );

    const caughtReport = within(
      await screen.findByRole("region", { name: "Broken behavior caught" }),
    );
    expect(caughtReport.getByText("Deliberately broken").closest("div")).toHaveTextContent(
      "FAIL",
    );
    expect(
      caughtReport.getByRole("status", {
        name: "Deliberately broken: FAIL. Broken behavior caught. Sensitivity check passed",
      }),
    ).toBeVisible();
    expect(
      caughtReport.getByText("Protection removed").closest("p"),
    ).toHaveTextContent("Drop idempotency reuse");
    expect(
      caughtReport.getByText("Sensitivity check").closest("div"),
    ).toHaveTextContent("Passed");
    expect(
      caughtReport.getByText("Provider refunds").closest("div"),
    ).toHaveTextContent("2");
    expect(
      caughtReport.getByText("Final state").closest("div"),
    ).toHaveTextContent("Refunded twice");
    expect(screen.queryByRole("button", { name: "Download test report" })).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Run safe version" }),
    );

    const safeReport = within(
      await screen.findByRole("region", { name: "Duplicate refund prevented" }),
    );
    expect(safeReport.getByText("Check result").closest("div")).toHaveTextContent(
      "PASS",
    );
    expect(
      safeReport.getByText("Provider refunds").closest("div"),
    ).toHaveTextContent("1");
  });

  it("passes the cloud check while clearly reporting the unchanged outcome", async () => {
    const user = userEvent.setup();
    render(<EffectRunnerHarness />);

    const suite = within(
      screen.getByRole("complementary", { name: "Test suite" }),
    );
    await user.click(
      suite.getByRole("button", {
        name: /Deploy said done, state unchanged/,
      }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Deploy said done, state unchanged",
      }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Run test" }));

    const report = within(
      await screen.findByRole("region", {
        name: "False cloud success rejected",
      }),
    );
    expect(report.getByText("Check result").closest("div")).toHaveTextContent(
      "PASS",
    );
    expect(
      report.getByText("Observed outcome").closest("div"),
    ).toHaveTextContent("Unchanged — false success caught");
    expect(
      report.getByText("Operation said done").closest("div"),
    ).toHaveTextContent("Yes");
    expect(
      report.getByText("Service health").closest("div"),
    ).toHaveTextContent("Unhealthy");
    expect(
      report.getByText("False success rejected").closest("div"),
    ).toHaveTextContent("Yes");
  });

  it("runs all four contracts and reports a status for every scenario", async () => {
    const user = userEvent.setup();
    render(<EffectRunnerHarness />);

    await user.click(
      screen.getByRole("button", { name: "Run 4 UI examples" }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Run 4 UI examples" }),
      ).toBeEnabled();
    });

    const suite = within(
      screen.getByRole("complementary", { name: "Test suite" }),
    );
    expect(suite.getAllByRole("img", { name: "passed" })).toHaveLength(4);
    expect(suite.queryByRole("img", { name: "failed" })).not.toBeInTheDocument();
    expect(suite.queryByRole("img", { name: "running" })).not.toBeInTheDocument();
  });

  it("labels disconnected External Target staging as an optional disabled integration", () => {
    render(<EffectRunnerHarness caseId={SOCIAL_PUBLISH_CASE_ID} />);

    const staging = screen.getByRole("region", {
      name: "External Target staging check",
    });
    expect(within(staging).getByText("Optional external-target staging · disabled")).toBeVisible();
    expect(within(staging).getByText("Optional staging integration")).toBeVisible();
    expect(
      within(staging).getByText(
        /disabled in this build.*UI-only fixture below remains synthetic/i,
      ),
    ).toBeVisible();
    expect(within(staging).queryByText(/not connected/i)).not.toBeInTheDocument();
    expect(
      within(staging).queryByRole("button", { name: "Run staging check" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Run simulated test" }),
    ).toBeVisible();
  });

  it("offers the fixed staging action only after readiness was attested", async () => {
    const user = userEvent.setup();
    const onRunCanary = vi.fn(async () => {});
    render(
      <EffectRunnerHarness
        caseId={SOCIAL_PUBLISH_CASE_ID}
        canary={{
          state: "ready",
          deploymentId: "deploy-ui-test",
        }}
        onRunCanary={onRunCanary}
      />,
    );

    const staging = screen.getByRole("region", {
      name: "External Target staging check",
    });
    expect(within(staging).getByText("Real workflow ready")).toBeVisible();
    await user.click(
      within(staging).getByRole("button", { name: "Run staging check" }),
    );
    expect(onRunCanary).toHaveBeenCalledTimes(1);
  });

  it("states that a running External Target check stays in isolated staging", () => {
    render(
      <EffectRunnerHarness
        caseId={SOCIAL_PUBLISH_CASE_ID}
        canary={{ state: "running", deploymentId: "deploy-ui-test" }}
      />,
    );

    const stagingElement = screen.getByRole("region", {
      name: "External Target staging check",
    });
    const staging = within(stagingElement);
    expect(staging.getByText("Checking External Target…")).toBeVisible();
    expect(staging.getByText(/isolated staging/i)).toBeVisible();
    expect(staging.getByText(/no social network is contacted/i)).toBeVisible();
    expect(stagingElement).toHaveClass("canary-panel-running");
    expect(stagingElement).not.toHaveClass("canary-running");
  });

  it("never invokes staging while running the synthetic suite", async () => {
    const user = userEvent.setup();
    const onRunCanary = vi.fn(async () => {});
    render(
      <EffectRunnerHarness
        caseId={SOCIAL_PUBLISH_CASE_ID}
        canary={{ state: "ready", deploymentId: "deploy-ui-test" }}
        onRunCanary={onRunCanary}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Run 4 UI examples" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Run 4 UI examples" }),
      ).toBeEnabled(),
    );
    expect(onRunCanary).not.toHaveBeenCalled();
  });

  it("keeps the session usable after a persisted pagehide", async () => {
    const user = userEvent.setup();
    render(<App />);

    dispatchPageHide(true);
    await user.click(screen.getByRole("button", { name: "Run test" }));

    expect(
      await screen.findByRole(
        "region",
        { name: "Duplicate refund prevented" },
        { timeout: 3_000 },
      ),
    ).toBeVisible();
  });

  it("closes the session after a non-persisted pagehide", async () => {
    const user = userEvent.setup();
    render(<App />);

    dispatchPageHide(false);
    await user.click(screen.getByRole("button", { name: "Run test" }));

    expect(
      await screen.findByText("This workbench session is closed."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Duplicate refund prevented" }),
    ).not.toBeInTheDocument();
  });
});
