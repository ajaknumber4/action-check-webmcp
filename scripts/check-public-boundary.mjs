#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

const GENERATED_DIRECTORIES = new Set([
  ".git",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);

const LOCAL_ONLY_PATHS = [
  /^\.devpost-hackathon-state\.json$/,
  /^docs\/(?:archive|hackathon|research)(?:\/|$)/,
  /^webmcp_oauth_workbench_build_prompt\.md$/,
  /^nuACWEsO\.md\(1\)\.part$/,
];

const SECRET_FILE_PATHS = [
  /^\.env$/,
  /^\.env\.(?!example$).+$/,
  /(?:^|\/)\.secrets(?:\/|$)/,
  /\.(?:key|pem)$/i,
];

const FIELD_NAME_PARTS = [
  ["access", "token"],
  ["refresh", "token"],
  ["authorization", "code"],
  ["authorisation", "code"],
  ["client", "secret"],
  ["code", "verifier"],
  ["pkce", "verifier"],
  ["session", "cookie"],
  ["state", "value"],
];

const SOURCE_OR_DATA_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const SAFE_EMAIL_DOMAINS = new Set(["example.com", "example.net", "example.org"]);

function normalizePath(pathname) {
  return pathname.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isForbiddenPath(pathname) {
  const normalized = normalizePath(pathname);
  const rule = [...LOCAL_ONLY_PATHS, ...SECRET_FILE_PATHS].find((candidate) =>
    candidate.test(normalized),
  );
  return rule ? `forbidden public path (${rule.source})` : null;
}

function isFallbackExcluded(pathname) {
  const normalized = normalizePath(pathname);
  return (
    LOCAL_ONLY_PATHS.some((rule) => rule.test(normalized)) ||
    SECRET_FILE_PATHS.some((rule) => rule.test(normalized))
  );
}

function gitFileList() {
  try {
    const inside = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (inside !== "true") return null;

    const output = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: ROOT, encoding: "utf8" },
    );

    return output
      .split("\0")
      .filter(Boolean)
      .map(normalizePath)
      .sort();
  } catch {
    return null;
  }
}

function fallbackFileList(directory = ROOT) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && GENERATED_DIRECTORIES.has(entry.name)) continue;

    const absolute = resolve(directory, entry.name);
    const pathname = normalizePath(relative(ROOT, absolute));
    if (isFallbackExcluded(pathname)) continue;

    if (entry.isDirectory()) {
      files.push(...fallbackFileList(absolute));
    } else if (entry.isFile()) {
      files.push(pathname);
    }
  }

  return files.sort();
}

function fieldIdentifiers() {
  return FIELD_NAME_PARTS.flatMap((parts) => {
    const snake = parts.join("_");
    const camel = parts[0] + parts.slice(1).map(capitalize).join("");
    return [snake, camel];
  });
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineNumber(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function findMatches(text, regex, onMatch) {
  const matches = [];
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const detail = onMatch(match);
    if (detail) matches.push({ line: lineNumber(text, match.index), detail });
    if (match[0].length === 0) regex.lastIndex += 1;
  }
  return matches;
}

function scanSensitiveFieldNames(pathname, text) {
  if (!SOURCE_OR_DATA_EXTENSIONS.has(extname(pathname).toLowerCase())) return [];

  const names = fieldIdentifiers().map(escapeRegex).join("|");
  const assignedField = new RegExp(
    `(?:["']\\s*)?\\b(${names})\\b(?:\\s*["'])?\\s*(?=[:=])`,
    "g",
  );

  return findMatches(text, assignedField, (match) =>
    `forbidden raw-secret field name: ${match[1]}`,
  );
}

function secretPatterns() {
  return [
    {
      label: "private-key block",
      regex: new RegExp(
        ["---", "--BE", "GIN", "[^\\n]{0,40}", "PRI", "VATE", " KEY", "-----"].join(""),
        "g",
      ),
    },
    { label: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
    { label: "GitHub credential", regex: new RegExp(`\\b${"gh"}[pousr]_[A-Za-z0-9]{20,}\\b`, "g") },
    { label: "OpenAI-style credential", regex: new RegExp(`\\b${"s" + "k"}-[A-Za-z0-9_-]{20,}\\b`, "g") },
    { label: "Slack credential", regex: new RegExp(`\\b${"xox"}[aboprs]-[A-Za-z0-9-]{16,}\\b`, "g") },
    { label: "live payment credential", regex: new RegExp(`\\b${"s" + "k"}_live_[A-Za-z0-9]{16,}\\b`, "g") },
    {
      label: "JWT-like value",
      regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    },
    {
      label: "credential assignment",
      regex: /\b(?:api[_-]?key|client[_-]?secret|password|passwd)\b\s*[:=]\s*["'][A-Za-z0-9_./+=-]{12,}["']/gi,
    },
  ];
}

function scanSecrets(text) {
  return secretPatterns().flatMap(({ label, regex }) =>
    findMatches(text, regex, () => `possible ${label}`),
  );
}

function scanPersonalInformation(text) {
  const findings = [];
  const email = /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
  findings.push(
    ...findMatches(text, email, (match) => {
      const domain = match[1].toLowerCase();
      return SAFE_EMAIL_DOMAINS.has(domain) ? null : `possible email address (${domain})`;
    }),
  );

  const phone = /(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,4}\)|\d{2,4})[ .-]\d{3}[ .-]\d{4}\b/g;
  findings.push(...findMatches(text, phone, () => "possible phone number"));

  const privateAccountId = new RegExp(`\\b(?:${"cus"}|${"sub"})_[A-Za-z0-9]{8,}\\b`, "g");
  findings.push(
    ...findMatches(text, privateAccountId, () => "possible private account identifier"),
  );

  const personalHomePath = /(?:\/Users\/|[A-Z]:\\\\Users\\\\)[^/\\\s"']+/g;
  findings.push(
    ...findMatches(text, personalHomePath, () => "possible personal home-directory path"),
  );

  return findings;
}

function scanText(pathname, text) {
  return [
    ...scanSensitiveFieldNames(pathname, text),
    ...scanSecrets(text),
    ...scanPersonalInformation(text),
  ];
}

function runSelfTest() {
  assert.ok(isForbiddenPath(".env.local"), "forbidden-path detector did not fire");

  const fieldName = ["access", "token"].join("_");
  assert.ok(
    scanText("src/unsafe.ts", `const record = { ${fieldName}: "[redacted]" };`).length > 0,
    "forbidden-field detector did not fire",
  );

  const credential = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
  assert.ok(
    scanText("src/unsafe.ts", `const value = "${credential}";`).length > 0,
    "secret detector did not fire",
  );

  const address = ["person", "private.invalid"].join("@");
  assert.ok(
    scanText("README.md", `Contact ${address}.`).length > 0,
    "personal-information detector did not fire",
  );

  const safeFixture = [
    "const fixture = {",
    '  registeredRedirectUri: "https://demo.example.com/oauth/callback",',
    "  stateMatches: false,",
    "  authorizationCodeAgeSeconds: 42,",
    "};",
  ].join("\n");
  assert.deepEqual(scanText("src/safe-fixture.ts", safeFixture), []);

  console.log("Public boundary self-test passed (path, field, secret, PII, safe fixture).");
}

function scanRepository() {
  const files = gitFileList() ?? fallbackFileList();
  const findings = [];
  const binaryFiles = [];
  let scannedFiles = 0;

  for (const pathname of files) {
    const forbidden = isForbiddenPath(pathname);
    if (forbidden) {
      findings.push({ pathname, line: 1, detail: forbidden });
      continue;
    }

    const absolute = resolve(ROOT, pathname);
    const stats = statSync(absolute);
    if (stats.size > MAX_TEXT_BYTES) {
      findings.push({ pathname, line: 1, detail: `text scan limit exceeded (${stats.size} bytes)` });
      continue;
    }

    const buffer = readFileSync(absolute);
    if (buffer.includes(0)) {
      binaryFiles.push(pathname);
      continue;
    }

    const text = buffer.toString("utf8");
    scannedFiles += 1;
    for (const finding of scanText(pathname, text)) {
      findings.push({ pathname, ...finding });
    }
  }

  if (findings.length > 0) {
    console.error(`Public boundary check failed with ${findings.length} finding(s):`);
    for (const finding of findings) {
      console.error(`- ${finding.pathname}:${finding.line} ${finding.detail}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Public boundary check passed (${scannedFiles} text file(s) scanned).`);
  if (binaryFiles.length > 0) {
    console.log(
      `Manual metadata/licence review required for ${binaryFiles.length} binary file(s): ${binaryFiles.join(", ")}`,
    );
  }
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  scanRepository();
}
