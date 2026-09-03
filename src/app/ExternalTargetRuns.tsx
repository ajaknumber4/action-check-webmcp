import {
  EVIDENCE_URL,
  EXTERNAL_TARGET_CHROME,
  EXTERNAL_TARGET_COMMAND,
  EXTERNAL_TARGET_KNOWN_LIMIT,
  EXTERNAL_TARGET_RUNS,
  EXTERNAL_TARGET_RUNS_DATE,
  REPO_URL,
} from "./external-target-runs";

/**
 * "Run it on any page": the command-line mode that points the same check at
 * a page Action Check does not own, and a static table of the runs recorded
 * against Google's public WebMCP demos. Nothing here runs live; the page is
 * a record of the proof JSON committed in the repository.
 */
export function ExternalTargetRuns() {
  const failures = EXTERNAL_TARGET_RUNS.filter((run) => run.status === "FAIL").length;
  return (
    <section id="any-page" className="external-runs" aria-labelledby="external-runs-title">
      <header className="external-runs-head">
        <div className="external-runs-intro">
          <span className="refund-proof-kicker">Command line · any page’s registered tool</span>
          <h2 id="external-runs-title">Run it on any page</h2>
          <p>
            The same check, pointed at a page Action Check does not own. Your{" "}
            <code>observe()</code> reads that page’s own state before and after the call.
            The verdict never comes from the tool’s reply.
          </p>
        </div>
        <pre className="external-runs-command" aria-label="Example command" tabIndex={0}>
          <code>{EXTERNAL_TARGET_COMMAND}</code>
        </pre>
      </header>

      <div className="external-runs-scroll" role="region" aria-label="Recorded runs" tabIndex={0}>
      <table className="external-runs-table">
        <caption>
          {EXTERNAL_TARGET_RUNS.length} recorded runs, {failures} caught a bug
        </caption>
        <thead>
          <tr>
            <th scope="col">Demo page</th>
            <th scope="col">Tool and input</th>
            <th scope="col">Mode</th>
            <th scope="col">Observed</th>
            <th scope="col">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {EXTERNAL_TARGET_RUNS.map((run) => (
            <tr key={run.id} className={`external-run external-run-${run.status.toLowerCase()}`}>
              <th scope="row">
                <a href={run.pageUrl} rel="noreferrer">{run.demo}</a>
              </th>
              <td>
                <code>{run.tool}</code>
                <code className="external-run-input">{run.input}</code>
              </td>
              <td>{run.mode === "retry" ? "retry ×2" : "once"}</td>
              <td>
                <span className="external-run-delta">
                  {run.before} → {run.after}
                </span>
                <small>{run.observed}</small>
              </td>
              <td>
                <strong>{run.status}</strong>
                <code>{run.code}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <footer className="external-runs-foot">
        <p>
          Recorded {EXTERNAL_TARGET_RUNS_DATE} in {EXTERNAL_TARGET_CHROME}, against Google’s
          public WebMCP demos. A static record of those runs, not a live check.{" "}
          {EXTERNAL_TARGET_KNOWN_LIMIT}
        </p>
        <p className="external-runs-links">
          <a href={EVIDENCE_URL} rel="noreferrer">Proof JSON for every run</a>
          <a href={REPO_URL} rel="noreferrer">Source and CLI on GitHub</a>
        </p>
      </footer>
    </section>
  );
}
