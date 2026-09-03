import { useMemo, useState } from "react";

import {
  buildCommand,
  buildObserveModule,
  CHECK_BUILDER_DEFAULTS,
  observeModuleName,
  validate,
  type CheckBuilderInput,
  type CheckMode,
} from "./check-builder";

type CopyKey = "observe" | "command";
type CopyState = "idle" | "copied" | "failed";

/**
 * "Point it at your own page": four fields in, two copy-pasteable artefacts out.
 *
 * This deliberately does not run anything. A page can only call tools registered
 * on its own `document.modelContext`; it cannot reach another origin's, so no
 * amount of JavaScript here could check someone else's site. The check runs from
 * a real Chrome driven by the CLI, and the honest thing this page can do is hand
 * over a correct command instead of implying a capability it does not have.
 */
export function CheckBuilder() {
  const [form, setForm] = useState<CheckBuilderInput>(CHECK_BUILDER_DEFAULTS);
  const [copyState, setCopyState] = useState<Record<CopyKey, CopyState>>({
    observe: "idle",
    command: "idle",
  });

  const errors = useMemo(() => validate(form), [form]);
  const errorFor = (field: "url" | "tool" | "input") =>
    errors.find((error) => error.field === field)?.message;

  const valid = errors.length === 0;
  const moduleName = observeModuleName(form.url);
  const observeSource = useMemo(() => (valid ? buildObserveModule(form) : ""), [form, valid]);
  const command = useMemo(() => (valid ? buildCommand(form) : ""), [form, valid]);

  const update = (patch: Partial<CheckBuilderInput>) => {
    setForm((current) => ({ ...current, ...patch }));
    setCopyState({ observe: "idle", command: "idle" });
  };

  const copy = async (key: CopyKey, text: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setCopyState((current) => ({ ...current, [key]: "copied" }));
    } catch {
      setCopyState((current) => ({ ...current, [key]: "failed" }));
    }
  };

  const copyLabel = (key: CopyKey) =>
    copyState[key] === "copied" ? "Copied" : copyState[key] === "failed" ? "Try again" : "Copy";

  return (
    <div className="check-builder" data-testid="check-builder">
      <div className="check-builder-intro">
        <h3 id="check-builder-title">Point it at your own page</h3>
        <p>
          Fill these in and you get the two files you need. Nothing runs here: a page can
          only see tools registered on its own <code>document.modelContext</code>, so the
          check has to drive a real Chrome from outside.
        </p>
      </div>

      <div className="check-builder-form">
        <div className="check-builder-field">
          <label htmlFor="check-builder-url">Target page URL</label>
          <input
            id="check-builder-url"
            type="url"
            name="url"
            inputMode="url"
            spellCheck={false}
            autoComplete="off"
            value={form.url}
            aria-invalid={errorFor("url") !== undefined}
            aria-describedby={errorFor("url") ? "check-builder-url-error" : undefined}
            onChange={(event) => update({ url: event.target.value })}
          />
          {errorFor("url") ? (
            <small id="check-builder-url-error" className="check-builder-error" role="alert">
              {errorFor("url")}
            </small>
          ) : null}
        </div>

        <div className="check-builder-field">
          <label htmlFor="check-builder-tool">Registered tool name</label>
          <input
            id="check-builder-tool"
            type="text"
            name="tool"
            spellCheck={false}
            autoComplete="off"
            value={form.tool}
            aria-invalid={errorFor("tool") !== undefined}
            aria-describedby={errorFor("tool") ? "check-builder-tool-error" : undefined}
            onChange={(event) => update({ tool: event.target.value })}
          />
          {errorFor("tool") ? (
            <small id="check-builder-tool-error" className="check-builder-error" role="alert">
              {errorFor("tool")}
            </small>
          ) : null}
        </div>

        <div className="check-builder-field check-builder-field-wide">
          <label htmlFor="check-builder-input">Tool input (JSON)</label>
          <input
            id="check-builder-input"
            type="text"
            name="input"
            spellCheck={false}
            autoComplete="off"
            value={form.input}
            aria-invalid={errorFor("input") !== undefined}
            aria-describedby={errorFor("input") ? "check-builder-input-error" : undefined}
            onChange={(event) => update({ input: event.target.value })}
          />
          {errorFor("input") ? (
            <small id="check-builder-input-error" className="check-builder-error" role="alert">
              {errorFor("input")}
            </small>
          ) : null}
        </div>

        <fieldset className="check-builder-field check-builder-modes">
          <legend>Mode</legend>
          {(
            [
              ["retry", "retry ×2", "Calls twice with identical input. Passes on exactly one new effect."],
              ["once", "once", "Calls once and compares the reply's claim against what changed."],
            ] as [CheckMode, string, string][]
          ).map(([value, label, hint]) => (
            <label key={value} className="check-builder-mode">
              <input
                type="radio"
                name="check-builder-mode"
                value={value}
                checked={form.mode === value}
                onChange={() => update({ mode: value })}
              />
              <span>
                <strong>{label}</strong>
                <small>{hint}</small>
              </span>
            </label>
          ))}
        </fieldset>
      </div>

      {valid ? (
        <ol className="check-builder-output">
          <li>
            <div className="check-builder-step-head">
              <h4>
                Save as <code>examples/{moduleName}</code>
              </h4>
              <button
                type="button"
                className="check-builder-copy"
                onClick={() => void copy("observe", observeSource)}
              >
                {copyLabel("observe")}
                <span className="visually-hidden"> the observe module</span>
              </button>
            </div>
            <pre tabIndex={0} aria-label={`observe module for ${form.tool}`}>
              <code>{observeSource}</code>
            </pre>
          </li>
          <li>
            <div className="check-builder-step-head">
              <h4>Run it</h4>
              <button
                type="button"
                className="check-builder-copy"
                onClick={() => void copy("command", command)}
              >
                {copyLabel("command")}
                <span className="visually-hidden"> the command</span>
              </button>
            </div>
            <pre tabIndex={0} aria-label="Command line for this check">
              <code>{command}</code>
            </pre>
            <p className="check-builder-note">
              Needs Node and your own Chrome 149 or newer; the CLI launches it with
              WebMCP enabled. Exit code 0 is a pass, 1 is a fail, 2 means the harness
              could not reach a verdict.
            </p>
          </li>
        </ol>
      ) : (
        <p className="check-builder-blocked" role="status">
          Fix the fields above and the observe module and command appear here.
        </p>
      )}

      {copyState.observe !== "idle" || copyState.command !== "idle" ? (
        <span className="visually-hidden" role="status">
          {copyState.observe === "copied" || copyState.command === "copied"
            ? "Copied to clipboard."
            : "Copy failed. Select the text instead."}
        </span>
      ) : null}
    </div>
  );
}
