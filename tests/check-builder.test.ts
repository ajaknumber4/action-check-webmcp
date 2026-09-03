import { describe, expect, it } from "vitest";

import {
  buildCommand,
  buildObserveModule,
  CHECK_BUILDER_DEFAULTS,
  observeModuleName,
  shellQuote,
  validate,
  type CheckBuilderInput,
} from "../src/app/check-builder";

/**
 * Minimal reader for the POSIX single-quoting `shellQuote` produces, used to
 * assert round-tripping rather than pattern-matching the escape by eye.
 */
function shellUnquote(word: string): string {
  let out = "";
  let i = 0;
  while (i < word.length) {
    if (word[i] === "'") {
      i += 1;
      while (i < word.length && word[i] !== "'") {
        out += word[i];
        i += 1;
      }
      i += 1;
    } else if (word[i] === "\\") {
      out += word[i + 1] ?? "";
      i += 2;
    } else {
      out += word[i];
      i += 1;
    }
  }
  return out;
}

const base: CheckBuilderInput = {
  url: "https://shop.example/checkout",
  tool: "place_order",
  input: '{"sku":"ABC-1","qty":1}',
  mode: "retry",
};

describe("shellQuote", () => {
  it("single-quotes a plain value", () => {
    expect(shellQuote("https://a.example/x")).toBe("'https://a.example/x'");
  });

  it("closes, escapes and reopens an embedded single quote", () => {
    // A single quote cannot appear inside a single-quoted shell word, so the
    // word is closed, the quote escaped, and the word reopened.
    expect(shellQuote("https://a.example/it's")).toBe("'https://a.example/it'\\''s'");
  });

  it("round-trips any value through a POSIX single-quote reader", () => {
    for (const value of [
      "plain",
      "https://a.example/it's",
      `{"a":"b'c"}`,
      "; rm -rf / #",
      "$(whoami)",
      "back\\slash",
      "'",
      "''",
    ]) {
      expect(shellUnquote(shellQuote(value))).toBe(value);
    }
  });

  it("leaves double quotes alone, so JSON survives intact", () => {
    expect(shellQuote('{"a":1}')).toBe(`'{"a":1}'`);
  });
});

describe("observeModuleName", () => {
  it("derives a slug from the host", () => {
    expect(observeModuleName("https://shop.example/checkout")).toBe("observe-shop-example.mjs");
  });

  it("drops a www prefix", () => {
    expect(observeModuleName("https://www.shop.example/")).toBe("observe-shop-example.mjs");
  });

  it("falls back when the URL cannot be parsed", () => {
    expect(observeModuleName("not a url")).toBe("observe-my-target.mjs");
  });

  it("gives two different hosts two different module names", () => {
    expect(observeModuleName("https://a.example/")).not.toBe(observeModuleName("https://b.example/"));
  });
});

describe("validate", () => {
  it("accepts the shipped defaults", () => {
    expect(validate(CHECK_BUILDER_DEFAULTS)).toEqual([]);
  });

  it("accepts a well-formed target", () => {
    expect(validate(base)).toEqual([]);
  });

  it("rejects a missing URL", () => {
    expect(validate({ ...base, url: "  " })).toContainEqual(
      expect.objectContaining({ field: "url" }),
    );
  });

  it("rejects a non-http scheme, which Chrome cannot be pointed at here", () => {
    expect(validate({ ...base, url: "file:///etc/passwd" })).toContainEqual(
      expect.objectContaining({ field: "url" }),
    );
  });

  it("rejects a tool name that is not an identifier", () => {
    expect(validate({ ...base, tool: "place order; rm -rf /" })).toContainEqual(
      expect.objectContaining({ field: "tool" }),
    );
  });

  it("rejects input that is not valid JSON", () => {
    expect(validate({ ...base, input: "{sku:1}" })).toContainEqual(
      expect.objectContaining({ field: "input" }),
    );
  });

  it("rejects a JSON array, because tool arguments are an object", () => {
    expect(validate({ ...base, input: "[1,2]" })).toContainEqual(
      expect.objectContaining({ field: "input" }),
    );
  });

  it("accepts an empty object for a tool that takes no arguments", () => {
    expect(validate({ ...base, input: "{}" })).toEqual([]);
  });
});

describe("buildCommand", () => {
  it("emits every flag the CLI parser needs", () => {
    const command = buildCommand(base);
    expect(command).toContain("node bin/action-check.mjs run");
    for (const flag of ["--url", "--tool", "--input", "--observe", "--mode"]) {
      expect(command).toContain(flag);
    }
  });

  it("quotes the URL and the JSON so a shell receives them whole", () => {
    const command = buildCommand(base);
    expect(command).toContain(`--url 'https://shop.example/checkout'`);
    expect(command).toContain(`--input '{"sku":"ABC-1","qty":1}'`);
  });

  it("points --observe at the module name it also generates", () => {
    expect(buildCommand(base)).toContain(`--observe examples/${observeModuleName(base.url)}`);
  });

  it("compacts pretty-printed JSON onto one line", () => {
    const command = buildCommand({ ...base, input: '{\n  "sku": "ABC-1"\n}' });
    expect(command).toContain(`--input '{"sku":"ABC-1"}'`);
    expect(command.split("\n").filter((line) => line.includes("--input"))).toHaveLength(1);
  });

  it("carries the selected mode through", () => {
    expect(buildCommand({ ...base, mode: "once" })).toContain("--mode once");
    expect(buildCommand({ ...base, mode: "retry" })).toContain("--mode retry");
  });

  it("neutralises a shell metacharacter smuggled into the URL", () => {
    const hostile = "https://a.example/?x=1'; touch pwned; #";
    const command = buildCommand({ ...base, url: hostile });
    // A shell reading the emitted word must recover the hostile string whole,
    // rather than the quote terminating the word and `touch` becoming a command.
    const urlLine = command.split("\n").find((line) => line.trimStart().startsWith("--url"));
    expect(urlLine).toBeDefined();
    // Drop the flag and the trailing line-continuation backslash, leaving the word.
    const urlWord = (urlLine as string).trim().slice("--url ".length).replace(/\s*\\$/, "");
    expect(shellUnquote(urlWord)).toBe(hostile);
  });
});

describe("buildObserveModule", () => {
  it("produces a module with the default export the CLI loader requires", () => {
    const module = buildObserveModule(base);
    expect(module).toContain("export default async function observe(ctx)");
  });

  it("returns the shape observeOnce validates", () => {
    const module = buildObserveModule(base);
    expect(module).toContain("effectCount");
    expect(module).toContain("evidence");
  });

  it("states the rule that keeps the check honest", () => {
    // The whole claim of the project is that the verdict never touches the
    // tool's reply. A template that omitted this would teach the opposite.
    expect(buildObserveModule(base)).toMatch(/never given the tool's response/);
  });

  it("names the file it tells the reader to save", () => {
    const module = buildObserveModule(base);
    expect(module).toContain(observeModuleName(base.url));
  });

  it("explains retry semantics in retry mode and once semantics in once mode", () => {
    expect(buildObserveModule({ ...base, mode: "retry" })).toContain("DUPLICATE_EFFECT");
    expect(buildObserveModule({ ...base, mode: "once" })).toContain("FALSE_SUCCESS");
    expect(buildObserveModule({ ...base, mode: "once" })).not.toContain("DUPLICATE_EFFECT");
  });

  it("embeds a runnable command in its own header comment", () => {
    expect(buildObserveModule(base)).toContain("node bin/action-check.mjs run");
  });
});
