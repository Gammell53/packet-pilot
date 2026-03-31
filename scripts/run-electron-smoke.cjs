#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const RESULT_PREFIX = "PACKET_PILOT_SMOKE_RESULT=";

function parseArgs(argv) {
  const options = {
    target: null,
    capture: null,
    filter: null,
    requireAi: false,
    timeoutMs: 30000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--target") {
      options.target = argv[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === "--capture") {
      options.capture = argv[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === "--filter") {
      options.filter = argv[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === "--require-ai") {
      options.requireAi = true;
      continue;
    }

    if (value === "--timeout-ms") {
      options.timeoutMs = Number(argv[index + 1] || options.timeoutMs);
      index += 1;
    }
  }

  return options;
}

function defaultPackagedTarget() {
  const candidates = {
    linux: path.join("dist", "linux-unpacked", "packet-pilot"),
    win32: path.join("dist", "win-unpacked", "PacketPilot.exe"),
    darwin: path.join("dist", "mac", "PacketPilot.app", "Contents", "MacOS", "PacketPilot"),
  };

  const candidate = candidates[process.platform];
  if (!candidate) {
    throw new Error(`Unsupported platform for smoke target autodetect: ${process.platform}`);
  }

  return candidate;
}

function resolveTarget(inputTarget) {
  const target = path.resolve(inputTarget || defaultPackagedTarget());
  if (!fs.existsSync(target)) {
    throw new Error(`Packaged app not found: ${target}`);
  }

  return target;
}

function buildLaunchCommand(target, env) {
  const shouldWrapWithXvfb =
    process.platform === "linux" && !process.env.DISPLAY && fs.existsSync("/usr/bin/xvfb-run");

  if (shouldWrapWithXvfb) {
    return {
      command: "/usr/bin/xvfb-run",
      args: ["-a", target],
      env,
    };
  }

  return {
    command: target,
    args: [],
    env,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const target = resolveTarget(options.target);

  const env = {
    ...process.env,
    PACKET_PILOT_SMOKE_TEST: "1",
  };
  const resultDir = fs.mkdtempSync(path.join(os.tmpdir(), "packet-pilot-smoke-"));
  const resultFile = path.join(resultDir, "result.json");
  env.PACKET_PILOT_SMOKE_RESULT_FILE = resultFile;

  if (options.capture) {
    env.PACKET_PILOT_SMOKE_CAPTURE = path.resolve(options.capture);
  }

  if (options.filter) {
    env.PACKET_PILOT_SMOKE_FILTER = options.filter;
  }

  if (options.requireAi) {
    env.PACKET_PILOT_SMOKE_REQUIRE_AI = "1";
  }

  const launch = buildLaunchCommand(target, env);
  let result = null;
  let stderr = "";
  let stdoutBuffer = "";

  const child = spawn(launch.command, launch.args, {
    env: launch.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
  }, options.timeoutMs);

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    process.stdout.write(text);

    stdoutBuffer += text;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith(RESULT_PREFIX)) {
        result = JSON.parse(line.slice(RESULT_PREFIX.length));
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    stderr += text;
    process.stderr.write(text);
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });

  clearTimeout(timeout);

  if (!result && stdoutBuffer.startsWith(RESULT_PREFIX)) {
    result = JSON.parse(stdoutBuffer.slice(RESULT_PREFIX.length));
  }

  if (!result && fs.existsSync(resultFile)) {
    result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  }

  fs.rmSync(resultDir, { recursive: true, force: true });

  if (!result) {
    throw new Error(`Smoke run exited without a result payload (exit=${exitCode}).\n${stderr}`);
  }

  if (!result.ok) {
    throw new Error(`Smoke run failed: ${result.error || "unknown error"}`);
  }

  console.log("");
  console.log("Smoke verification passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
