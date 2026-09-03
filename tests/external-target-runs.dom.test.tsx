import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ExternalTargetRuns } from "../src/app/ExternalTargetRuns";
import {
  EVIDENCE_URL,
  EXTERNAL_TARGET_RUNS,
  REPO_URL,
} from "../src/app/external-target-runs";

afterEach(cleanup);

describe("Run it on any page", () => {
  it("records every external-target run with its verdict and links to the proof", () => {
    render(<ExternalTargetRuns />);

    const region = screen.getByRole("region", { name: "Run it on any page" });
    const table = within(region).getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(EXTERNAL_TARGET_RUNS.length);

    const failures = rows.filter((row) => within(row).queryByText("FAIL") !== null);
    const passes = rows.filter((row) => within(row).queryByText("PASS") !== null);
    expect(failures).toHaveLength(5);
    expect(passes).toHaveLength(7);
    expect(within(table).getAllByText("DUPLICATE_EFFECT", { selector: "code" })).toHaveLength(3);
    expect(within(table).getAllByText("FALSE_SUCCESS", { selector: "code" })).toHaveLength(2);
    expect(within(table).getAllByText("HONEST_REFUSAL", { selector: "code" })).toHaveLength(3);

    expect(within(region).getByLabelText("Example command")).toHaveTextContent("--input");
    expect(within(region).getByRole("link", { name: "Proof JSON for every run" })).toHaveAttribute(
      "href",
      EVIDENCE_URL,
    );
    expect(within(region).getByRole("link", { name: "Source and CLI on GitHub" })).toHaveAttribute(
      "href",
      REPO_URL,
    );
    expect(within(region).getByText(/not a live check/)).toBeVisible();
  });
});
