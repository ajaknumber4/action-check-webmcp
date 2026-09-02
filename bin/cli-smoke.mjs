#!/usr/bin/env node
// Smoke test for `bin/action-check.mjs` (npm run cli:smoke).
//
// Starts the refund-staging Worker on :8787 and the built app preview on
// :4173 (reusing either if already listening -- checked with a real TCP
// probe, not just a pid lookup), runs the CLI against the bundled example
// observe() module, and asserts exit 0 with the expected effect counts.
// Only kills the child processes this script itself started.

import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKER_PORT = 8787;
const PREVIEW_PORT = 4173;
const HOST = "127.0.0.1";

function log(...args) {
  console.error("[cli:smoke]", ...args);
}

function checkPort(port, host = HOST) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

async function waitForPort(port, host, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkPort(port, host)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

function runToCompletion(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

function startBackground(command, args) {
  const child = spawn(command, args, { cwd: ROOT, stdio: "ignore" });
  return child;
}

function runCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

async function main() {
  const startedProcesses = [];

  try {
    const workerAlreadyUp = await checkPort(WORKER_PORT);
    if (workerAlreadyUp) {
      log(`reusing refund-staging Worker already listening on :${WORKER_PORT}`);
    } else {
      log(`starting refund-staging Worker on :${WORKER_PORT}`);
      const worker = startBackground("npm", [
        "--prefix",
        "workers/refund-staging-target",
        "run",
        "dev",
      ]);
      startedProcesses.push(worker);
      const ready = await waitForPort(WORKER_PORT, HOST, 30_000);
      if (!ready) throw new Error(`Worker did not start listening on :${WORKER_PORT} within 30s`);
    }

    const previewAlreadyUp = await checkPort(PREVIEW_PORT);
    if (previewAlreadyUp) {
      log(`reusing preview server already listening on :${PREVIEW_PORT}`);
    } else {
      log("building the app before preview");
      await runToCompletion("npm", ["run", "build"]);
      log(`starting preview server on :${PREVIEW_PORT}`);
      const preview = startBackground("npm", [
        "run",
        "preview",
        "--",
        "--host",
        HOST,
        "--port",
        String(PREVIEW_PORT),
        "--strictPort",
      ]);
      startedProcesses.push(preview);
      const ready = await waitForPort(PREVIEW_PORT, HOST, 30_000);
      if (!ready) throw new Error(`Preview did not start listening on :${PREVIEW_PORT} within 30s`);
    }

    log("running bin/action-check.mjs against the fixture");
    const result = await runCapture("node", [
      "bin/action-check.mjs",
      "run",
      "--url",
      `http://${HOST}:${PREVIEW_PORT}`,
      "--tool",
      "issue_refund",
      "--observe",
      "examples/observe-refund-staging.mjs",
    ]);

    if (result.code !== 0) {
      throw new Error(`action-check exited ${result.code}, expected 0`);
    }

    let proof;
    try {
      proof = JSON.parse(result.stdout);
    } catch (error) {
      throw new Error(`action-check stdout was not valid JSON: ${error?.message ?? error}`);
    }

    const brokenCount = proof?.lanes?.broken?.observed?.effectCount;
    const protectedCount = proof?.lanes?.protected?.observed?.effectCount;
    if (brokenCount !== 2) {
      throw new Error(`expected broken lane effectCount 2, got ${brokenCount}`);
    }
    if (protectedCount !== 1) {
      throw new Error(`expected protected lane effectCount 1, got ${protectedCount}`);
    }
    if (proof?.verdict?.status !== "PASS") {
      throw new Error(`expected verdict PASS, got ${proof?.verdict?.status}: ${proof?.verdict?.reason}`);
    }

    log(`PASS: exit 0, broken=${brokenCount}, protected=${protectedCount}, verdict=PASS`);
  } finally {
    for (const child of startedProcesses) {
      child.kill("SIGTERM");
    }
  }
}

main().catch((error) => {
  log(`FAIL: ${error?.stack ?? error}`);
  process.exitCode = 1;
});
