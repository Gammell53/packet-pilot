#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { spawn } = require("node:child_process");
const {
  PUBLIC_PCAP_MANIFEST_PATH,
  loadPublicPcapManifest,
  downloadPublicPcap,
  getPublicPcapLocalPath,
} = require("./lib/public-pcap-corpus.cjs");

const RESULT_PREFIX = "PACKET_PILOT_SMOKE_RESULT=";
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_REPORT_DIR = path.resolve("test-results", "ai-harness");
const DEFAULT_FILTER = "frame.number >= 1";
const KNOWN_PROTOCOL_TOKENS = ["http", "tls", "ssh", "smtp", "imap", "pop3", "ftp"];
const KNOWN_FILTER_PREFIXES = ["arp", "bootp", "dhcp", "dns", "eth", "frame", "ftp", "http", "icmp", "ip", "ipv6", "quic", "ssl", "tcp", "tls", "udp", "ws"];

let directHarnessModules = null;

function parseArgs(argv) {
  const options = {
    scenario: null,
    model: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    driver: "smoke",
    reportDir: DEFAULT_REPORT_DIR,
    suite: "synthetic",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--scenario") {
      options.scenario = argv[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === "--model") {
      options.model = argv[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === "--timeout-ms") {
      options.timeoutMs = Number(argv[index + 1] || options.timeoutMs);
      index += 1;
      continue;
    }

    if (value === "--driver") {
      options.driver = argv[index + 1] || options.driver;
      index += 1;
      continue;
    }

    if (value === "--report-dir") {
      options.reportDir = path.resolve(argv[index + 1] || options.reportDir);
      index += 1;
      continue;
    }

    if (value === "--suite") {
      options.suite = argv[index + 1] || options.suite;
      index += 1;
    }
  }

  if (!["smoke", "direct"].includes(options.driver)) {
    throw new Error(`Unsupported AI harness driver: ${options.driver}`);
  }

  if (!["synthetic", "public-pcaps"].includes(options.suite)) {
    throw new Error(`Unsupported AI harness suite: ${options.suite}`);
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1000) {
    throw new Error(`Invalid --timeout-ms value: ${options.timeoutMs}`);
  }

  return options;
}

function sanitizeName(value) {
  return String(value || "run")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "run";
}

function createTimestampKey() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function buildLaunchCommand(command, args, env) {
  const shouldWrapWithXvfb =
    process.platform === "linux" && !process.env.DISPLAY && fs.existsSync("/usr/bin/xvfb-run");

  if (shouldWrapWithXvfb) {
    return {
      command: "/usr/bin/xvfb-run",
      args: ["-a", command, ...args],
      env,
    };
  }

  return { command, args, env };
}

function resolveElectronCommand() {
  const localElectron = path.resolve(
    "node_modules",
    ".bin",
    process.platform === "win32" ? "electron.cmd" : "electron",
  );

  if (fs.existsSync(localElectron)) {
    return localElectron;
  }

  return require("electron");
}

function requireCommand(command) {
  const result = spawn(command, ["--version"], { stdio: "ignore" });
  return new Promise((resolve, reject) => {
    result.once("error", reject);
    result.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} is required but was not found or failed to run`));
    });
  });
}

async function withTimeout(label, promise, timeoutMs) {
  let timeoutId = null;

  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function generateCapture(scenario, fixtureRoot, outputPath) {
  const fixturePath = path.resolve(fixtureRoot, scenario.fixture);
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`AI harness fixture not found: ${fixturePath}`);
  }

  const extension = path.extname(fixturePath).toLowerCase();
  if ([".pcap", ".pcapng", ".cap"].includes(extension)) {
    fs.copyFileSync(fixturePath, outputPath);
    return;
  }

  await requireCommand("text2pcap");
  const args = [...(scenario.text2pcapArgs || []), fixturePath, outputPath];

  await new Promise((resolve, reject) => {
    const child = spawn("text2pcap", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`text2pcap failed with exit code ${code}\n${stderr}`));
    });
  });
}

async function waitForJsonFile(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return null;
}

function loadSyntheticManifest() {
  const manifestPath = path.resolve("e2e", "fixtures", "ai", "scenarios.json");
  return {
    suite: "synthetic",
    manifestPath,
    defaultScenario: null,
    defaultModel: null,
    scenarios: {},
    ...JSON.parse(fs.readFileSync(manifestPath, "utf8")),
  };
}

function loadPublicCorpusManifest() {
  const manifest = loadPublicPcapManifest();
  const scenarios = Object.fromEntries(
    Object.entries(manifest.captures || {}).map(([id, capture]) => [
      id,
      {
        id,
        drivers: ["smoke", "direct"],
        ...capture,
      },
    ]),
  );

  return {
    suite: "public-pcaps",
    manifestPath: PUBLIC_PCAP_MANIFEST_PATH,
    defaultScenario: manifest.defaultId || Object.keys(scenarios)[0] || null,
    defaultModel: manifest.defaultModel || null,
    scenarios,
    manifest,
  };
}

function loadSuiteManifest(suite) {
  if (suite === "public-pcaps") {
    return loadPublicCorpusManifest();
  }

  return loadSyntheticManifest();
}

function selectScenarioEntries(manifest, scenarioArg, driver) {
  const scenarioName = scenarioArg || manifest.defaultScenario;
  const allEntries = Object.entries(manifest.scenarios || {});

  if (scenarioName === "all") {
    const filtered = allEntries.filter(([, scenario]) => {
      const drivers = Array.isArray(scenario.drivers) ? scenario.drivers : ["smoke", "direct"];
      return drivers.includes(driver);
    });

    if (filtered.length === 0) {
      throw new Error(`No AI harness scenarios support driver "${driver}"`);
    }

    return filtered;
  }

  const scenario = manifest.scenarios?.[scenarioName];
  if (!scenario) {
    throw new Error(`Unknown AI harness scenario: ${scenarioName}`);
  }

  const drivers = Array.isArray(scenario.drivers) ? scenario.drivers : ["smoke", "direct"];
  if (!drivers.includes(driver)) {
    throw new Error(`Scenario "${scenarioName}" does not support driver "${driver}"`);
  }

  return [[scenarioName, scenario]];
}

function createBaseHarnessResult({ capturePath, scenarioName, scenario, requestedModel }) {
  return {
    ok: false,
    windowLoaded: false,
    capturePath,
    filter: DEFAULT_FILTER,
    sharkd: {
      loadedCapture: false,
      frameCount: 0,
      filteredFrameCount: null,
      firstFrameNumber: null,
      firstFrameHasTree: false,
    },
    ai: {
      required: true,
      started: false,
      skippedReason: null,
      scenario: scenarioName,
      query: scenario.query,
      model: requestedModel,
      resolvedModel: null,
      requestId: null,
      answer: null,
      suggestedFilter: null,
      toolCalls: [],
      toolCount: 0,
      latencyMs: null,
    },
    diagnostics: null,
    error: null,
  };
}

async function runSmokeScenario({ capturePath, scenarioName, scenario, requestedModel, apiKey, timeoutMs }) {
  const resultFile = path.join(path.dirname(capturePath), `${scenarioName}-smoke-result.json`);
  const electronBinary = resolveElectronCommand();
  const launchEnv = {
    ...process.env,
    PACKET_PILOT_SMOKE_TEST: "1",
    PACKET_PILOT_SMOKE_RESULT_FILE: resultFile,
    PACKET_PILOT_SMOKE_CAPTURE: capturePath,
    PACKET_PILOT_SMOKE_REQUIRE_AI: "1",
    PACKET_PILOT_SMOKE_API_KEY: apiKey,
    PACKET_PILOT_SMOKE_AI_QUERY: scenario.query,
    PACKET_PILOT_SMOKE_AI_SCENARIO: scenarioName,
    PACKET_PILOT_SMOKE_AI_MODEL: requestedModel,
    PACKET_PILOT_SMOKE_STEP_TIMEOUT_MS: String(timeoutMs),
  };

  const launch = buildLaunchCommand(
    electronBinary,
    [path.resolve(".electron/electron/main.cjs")],
    launchEnv,
  );

  const cleanupWarnings = [];
  let result = null;
  let stderr = "";
  let stdoutBuffer = "";
  const startedAt = Date.now();
  const child = spawn(launch.command, launch.args, {
    env: launch.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
  }, timeoutMs + 5000);

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

  if (!result && exitCode === 0) {
    result = await waitForJsonFile(resultFile, 1500);
  }

  if (!result) {
    throw new Error(`Live AI harness exited without a smoke result (exit=${exitCode}).\n${stderr}`);
  }

  if (exitCode !== 0 && result.ok) {
    cleanupWarnings.push(`Smoke driver exited with code ${exitCode} after producing a valid result.`);
  }

  if (stderr.trim()) {
    cleanupWarnings.push("Smoke driver emitted stderr output. Inspect the raw stderr in the JSON report.");
  }

  return {
    result,
    exitCode,
    stderr,
    cleanupWarnings,
    runtimeMs: Date.now() - startedAt,
  };
}

function loadDirectHarnessModules() {
  if (directHarnessModules) {
    return directHarnessModules;
  }

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "electron") {
      return {
        app: {
          getPath: () => path.join(os.tmpdir(), "packet-pilot-ai-harness-live"),
          getAppPath: () => process.cwd(),
          isPackaged: false,
        },
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const OpenAI = require("openai");
    const { AiAgentService } = require(path.resolve(".electron/electron/services/ai-agent-service.cjs"));
    const { sharkdService } = require(path.resolve(".electron/electron/services/sharkd-service.cjs"));
    directHarnessModules = {
      OpenAI: OpenAI.default || OpenAI,
      AiAgentService,
      sharkdService,
    };
  } finally {
    Module._load = originalLoad;
  }

  return directHarnessModules;
}

async function runDirectScenario({ capturePath, scenarioName, scenario, requestedModel, apiKey, timeoutMs }) {
  const { OpenAI, AiAgentService, sharkdService } = loadDirectHarnessModules();
  const result = createBaseHarnessResult({
    capturePath,
    scenarioName,
    scenario,
    requestedModel,
  });
  const cleanupWarnings = [];
  const startedAt = Date.now();
  const onSharkdError = (message) => {
    cleanupWarnings.push(String(message));
  };

  sharkdService.on("error", onSharkdError);

  try {
    await withTimeout("sharkd init", sharkdService.init(), timeoutMs);
    const loadResult = await withTimeout("capture load", sharkdService.loadPcap(capturePath), timeoutMs);
    if (!loadResult.success) {
      throw new Error(loadResult.error || "Failed to load AI harness capture");
    }

    result.sharkd.loadedCapture = true;
    result.sharkd.frameCount = loadResult.frame_count;

    const isFilterValid = await withTimeout("filter validation", sharkdService.checkFilter(DEFAULT_FILTER), timeoutMs);
    if (!isFilterValid) {
      throw new Error(`AI harness filter is invalid: ${DEFAULT_FILTER}`);
    }

    result.sharkd.filteredFrameCount = await withTimeout(
      "filter apply",
      sharkdService.applyFilter(DEFAULT_FILTER),
      timeoutMs,
    );

    const frames = await withTimeout(
      "frame fetch",
      sharkdService.getFrames(0, 5, sharkdService.getActiveFilter()),
      timeoutMs,
    );
    const firstFrame = frames.frames[0] || null;
    result.sharkd.firstFrameNumber = firstFrame?.number ?? null;

    if (firstFrame) {
      const details = await withTimeout("frame details", sharkdService.getFrameDetails(firstFrame.number), timeoutMs);
      result.sharkd.firstFrameHasTree = Array.isArray(details.tree) && details.tree.length > 0;
    }

    const aiService = new AiAgentService({
      settings: {
        getSettings: () => ({
          apiKey,
          model: requestedModel,
        }),
      },
      sharkd: sharkdService,
      createClient: (config) => new OpenAI(config),
    });

    const startResult = await withTimeout("ai start", aiService.start(), timeoutMs);
    if (!startResult.is_running) {
      throw new Error(startResult.error || "Failed to start AI runtime for direct harness");
    }

    result.ai.started = true;

    const analyzeResult = await withTimeout(
      "ai analyze",
      aiService.analyzeOnce({
        query: scenario.query,
        model: requestedModel,
        conversation_history: [],
        context: {
          selectedPacketId: result.sharkd.firstFrameNumber,
          selectedStreamId: null,
          visibleRange: { start: 1, end: Math.max(1, Math.min(result.sharkd.frameCount, 200)) },
          currentFilter: sharkdService.getActiveFilter(),
          fileName: capturePath ? path.basename(capturePath) : null,
          totalFrames: result.sharkd.frameCount,
        },
      }),
      timeoutMs,
    );

    result.ai.answer = analyzeResult.message;
    result.ai.suggestedFilter = analyzeResult.suggested_filter || null;
    result.ai.resolvedModel = analyzeResult.model || requestedModel;
    result.ai.requestId = analyzeResult.request_id || null;
    result.ai.toolCalls = analyzeResult.tool_calls || [];
    result.ai.toolCount = analyzeResult.tool_count ?? result.ai.toolCalls.length;
    result.ai.latencyMs = analyzeResult.latency_ms ?? null;
    result.ok = true;

    await withTimeout("ai stop", aiService.stop(), timeoutMs);
    return {
      result,
      exitCode: 0,
      stderr: "",
      cleanupWarnings,
      runtimeMs: Date.now() - startedAt,
    };
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return {
      result,
      exitCode: 1,
      stderr: "",
      cleanupWarnings,
      runtimeMs: Date.now() - startedAt,
    };
  } finally {
    try {
      sharkdService.stop();
    } catch (error) {
      cleanupWarnings.push(error instanceof Error ? error.message : String(error));
    }
    sharkdService.off("error", onSharkdError);
  }
}

function includesText(haystack, needle) {
  return String(haystack || "").toLowerCase().includes(String(needle || "").toLowerCase());
}

function hasEvidenceCitation(answer) {
  return /(?:packet|frame)\s*#?\d+/i.test(answer);
}

function findUnexpectedProtocols(answer) {
  const lowered = String(answer || "").toLowerCase();
  return KNOWN_PROTOCOL_TOKENS.filter((token) => lowered.includes(token));
}

function looksLikeDisplayFilter(candidate) {
  const value = String(candidate || "").trim();
  if (!value) {
    return false;
  }

  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    return false;
  }

  if (/[\\/]/.test(value)) {
    return false;
  }

  if (/\b(?:contains|matches)\b|==|!=|>=|<=|>|<|\|\||&&/.test(value)) {
    return true;
  }

  return KNOWN_FILTER_PREFIXES.some((prefix) => value === prefix || value.startsWith(`${prefix}.`));
}

function makeCheck(name, pass, details) {
  return { name, pass, details };
}

function evaluateScenario({ scenarioName, scenario, requestedModel, driver, execution }) {
  const result = execution.result || {};
  const ai = result.ai || {};
  const answer = String(ai.answer || "");
  const suggestedFilter = String(ai.suggestedFilter || "");
  const toolCalls = Array.isArray(ai.toolCalls) ? ai.toolCalls : [];
  const toolNames = toolCalls.map((entry) => entry.name);
  const resolvedModel = ai.resolvedModel || ai.model || null;
  const checks = [];
  const warnings = [...execution.cleanupWarnings];

  checks.push(
    makeCheck(
      "driver completed",
      Boolean(result.ok),
      result.ok ? `${driver} driver returned a result.` : result.error || `${driver} driver failed.`,
    ),
  );

  checks.push(
    makeCheck(
      "answer returned",
      answer.trim().length > 0,
      answer.trim().length > 0 ? "The model returned non-empty text." : "The model returned an empty answer.",
    ),
  );

  checks.push(
    makeCheck(
      "requested model used",
      Boolean(resolvedModel) && resolvedModel === requestedModel,
      resolvedModel ? `Resolved model: ${resolvedModel}` : "The harness did not receive a resolved model id.",
    ),
  );

  for (const fact of scenario.requiredFacts || []) {
    checks.push(
      makeCheck(
        `fact: ${fact}`,
        includesText(answer, fact),
        includesText(answer, fact) ? `Found "${fact}" in the answer.` : `Missing required fact "${fact}".`,
      ),
    );
  }

  for (const pattern of scenario.requiredPatterns || []) {
    const regex = new RegExp(pattern, "i");
    checks.push(
      makeCheck(
        `pattern: /${pattern}/`,
        regex.test(answer),
        regex.test(answer) ? `Matched /${pattern}/.` : `Missing expected pattern /${pattern}/.`,
      ),
    );
  }

  for (const forbidden of scenario.forbiddenFacts || []) {
    checks.push(
      makeCheck(
        `forbidden: ${forbidden}`,
        !includesText(answer, forbidden),
        !includesText(answer, forbidden)
          ? `Did not find forbidden text "${forbidden}".`
          : `Answer included forbidden text "${forbidden}".`,
      ),
    );
  }

  if (scenario.expectTools === true) {
    checks.push(
      makeCheck(
        "tool usage",
        toolCalls.length > 0,
        toolCalls.length > 0 ? `Tool trace: ${toolNames.join(", ")}` : "Expected at least one tool call.",
      ),
    );
  } else if (scenario.expectTools === false && toolCalls.length > 0) {
    warnings.push(`Tools were used even though they were not required: ${toolNames.join(", ")}`);
  }

  if (Array.isArray(scenario.requiredAnyToolNames) && scenario.requiredAnyToolNames.length > 0) {
    checks.push(
      makeCheck(
        "required tool family",
        scenario.requiredAnyToolNames.some((name) => toolNames.includes(name)),
        toolCalls.length > 0
          ? `Observed tools: ${toolNames.join(", ")}`
          : `Expected one of: ${scenario.requiredAnyToolNames.join(", ")}`,
      ),
    );
  }

  if (scenario.expectEvidence) {
    checks.push(
      makeCheck(
        "evidence citation",
        hasEvidenceCitation(answer),
        hasEvidenceCitation(answer)
          ? "The answer cites a packet or frame number."
          : "Expected the answer to cite packet or frame evidence.",
      ),
    );
  }

  if (scenario.expectedSuggestedFilterContains) {
    checks.push(
      makeCheck(
        "suggested filter",
        includesText(suggestedFilter, scenario.expectedSuggestedFilterContains),
        suggestedFilter
          ? `Suggested filter: ${suggestedFilter}`
          : `Expected a suggested filter containing "${scenario.expectedSuggestedFilterContains}".`,
      ),
    );
  } else if (scenario.optionalSuggestedFilterContains && suggestedFilter) {
    if (!includesText(suggestedFilter, scenario.optionalSuggestedFilterContains)) {
      warnings.push(
        `Suggested filter did not include "${scenario.optionalSuggestedFilterContains}": ${suggestedFilter}`,
      );
    }
  }

  if (suggestedFilter && !looksLikeDisplayFilter(suggestedFilter)) {
    warnings.push(`Suggested filter does not look like a Wireshark display filter: ${suggestedFilter}`);
  }

  if (scenarioName === "tcp-follow-basic") {
    const unexpectedProtocols = findUnexpectedProtocols(answer);
    if (unexpectedProtocols.length > 0) {
      warnings.push(`Answer mentioned higher-level protocol terms: ${unexpectedProtocols.join(", ")}`);
    }
  }

  const strengths = checks.filter((check) => check.pass).map((check) => check.details);
  const misses = checks.filter((check) => !check.pass).map((check) => check.details);
  const passed = misses.length === 0;

  return {
    scenario: scenarioName,
    title: scenario.title || null,
    category: scenario.category || null,
    sourcePage: scenario.sourcePage || null,
    driver,
    requestedModel,
    resolvedModel,
    requestId: ai.requestId || null,
    latencyMs: ai.latencyMs ?? null,
    toolCalls,
    toolCount: ai.toolCount ?? toolCalls.length,
    suggestedFilter: suggestedFilter || null,
    answer,
    checks,
    strengths,
    misses,
    warnings,
    runtimeMs: execution.runtimeMs,
    stderr: execution.stderr || "",
    pass: passed,
    failureReason: passed ? null : misses[0] || result.error || "Scenario assertions failed.",
  };
}

function renderAnswerBlock(answer) {
  if (!answer) {
    return "_No answer returned._";
  }

  return answer
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function buildMarkdownReport(summary) {
  const lines = [
    "# AI Harness Report",
    "",
    `- Created: ${summary.createdAt}`,
    `- Suite: ${summary.suite}`,
    `- Driver: ${summary.driver}`,
    `- Requested model: ${summary.model}`,
    `- Scenarios: ${summary.scenarioNames.join(", ")}`,
    `- Passed: ${summary.passedCount}/${summary.scenarioCount}`,
    "",
  ];

  for (const scenario of summary.scenarios) {
    lines.push(`## ${scenario.scenario} ${scenario.pass ? "PASS" : "FAIL"}`);
    lines.push("");
    if (scenario.title) {
      lines.push(`- Title: ${scenario.title}`);
    }
    if (scenario.category) {
      lines.push(`- Category: ${scenario.category}`);
    }
    if (scenario.sourcePage) {
      lines.push(`- Source: ${scenario.sourcePage}`);
    }
    lines.push(`- Resolved model: ${scenario.resolvedModel || "<none>"}`);
    lines.push(`- Latency: ${scenario.latencyMs ?? "n/a"} ms`);
    lines.push(`- Tool count: ${scenario.toolCount}`);
    lines.push(`- Runtime: ${scenario.runtimeMs} ms`);
    lines.push(`- Suggested filter: ${scenario.suggestedFilter || "<none>"}`);
    lines.push(`- Request id: ${scenario.requestId || "<none>"}`);
    lines.push("");

    if (scenario.strengths.length > 0) {
      lines.push("Strengths:");
      for (const item of scenario.strengths) {
        lines.push(`- ${item}`);
      }
      lines.push("");
    }

    if (scenario.misses.length > 0) {
      lines.push("Misses:");
      for (const item of scenario.misses) {
        lines.push(`- ${item}`);
      }
      lines.push("");
    }

    if (scenario.warnings.length > 0) {
      lines.push("Warnings:");
      for (const item of scenario.warnings) {
        lines.push(`- ${item}`);
      }
      lines.push("");
    }

    if (scenario.toolCalls.length > 0) {
      lines.push("Tool trace:");
      for (const call of scenario.toolCalls) {
        lines.push(`- ${call.name} ${JSON.stringify(call.arguments)}`);
      }
      lines.push("");
    }

    lines.push("Answer:");
    lines.push(renderAnswerBlock(scenario.answer));
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function writeReports({ reportDir, suite, driver, scenarioLabel, model, summary }) {
  fs.mkdirSync(reportDir, { recursive: true });
  const stem = `${createTimestampKey()}-${sanitizeName(suite)}-${sanitizeName(driver)}-${sanitizeName(scenarioLabel)}-${sanitizeName(model)}`;
  const jsonPath = path.join(reportDir, `${stem}.json`);
  const markdownPath = path.join(reportDir, `${stem}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
  fs.writeFileSync(markdownPath, buildMarkdownReport(summary));

  return { jsonPath, markdownPath };
}

async function executeScenario({ driver, capturePath, scenarioName, scenario, requestedModel, apiKey, timeoutMs }) {
  try {
    if (driver === "direct") {
      return await runDirectScenario({
        capturePath,
        scenarioName,
        scenario,
        requestedModel,
        apiKey,
        timeoutMs,
      });
    }

    return await runSmokeScenario({
      capturePath,
      scenarioName,
      scenario,
      requestedModel,
      apiKey,
      timeoutMs,
    });
  } catch (error) {
    return {
      result: {
        ...createBaseHarnessResult({
          capturePath,
          scenarioName,
          scenario,
          requestedModel,
        }),
        error: error instanceof Error ? error.message : String(error),
      },
      exitCode: 1,
      stderr: "",
      cleanupWarnings: [],
      runtimeMs: 0,
    };
  }
}

async function prepareScenarioCapture({ suite, scenarioName, scenario, fixtureRoot, tempDir }) {
  if (suite === "public-pcaps") {
    await downloadPublicPcap(scenario);
    return getPublicPcapLocalPath(scenario);
  }

  const capturePath = path.join(tempDir, `${scenarioName}.pcapng`);
  await generateCapture(scenario, fixtureRoot, capturePath);
  return capturePath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required for the live AI harness");
  }

  const manifest = loadSuiteManifest(options.suite);
  const scenarioEntries = selectScenarioEntries(manifest, options.scenario, options.driver);
  const requestedModel = options.model || manifest.defaultModel || "google/gemini-3.1-flash-lite-preview";
  const tempDir = options.suite === "synthetic" ? fs.mkdtempSync(path.join(os.tmpdir(), "packet-pilot-ai-harness-")) : null;
  const fixtureRoot = path.dirname(manifest.manifestPath);
  const evaluations = [];

  try {
    for (const [scenarioName, scenario] of scenarioEntries) {
      const capturePath = await prepareScenarioCapture({
        suite: options.suite,
        scenarioName,
        scenario,
        fixtureRoot,
        tempDir,
      });

      const execution = await executeScenario({
        driver: options.driver,
        capturePath,
        scenarioName,
        scenario,
        requestedModel,
        apiKey,
        timeoutMs: options.timeoutMs,
      });

      evaluations.push(
        evaluateScenario({
          scenarioName,
          scenario,
          requestedModel,
          driver: options.driver,
          execution,
        }),
      );
    }
  } finally {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  const passedCount = evaluations.filter((entry) => entry.pass).length;
  const scenarioLabel = options.scenario || manifest.defaultScenario;
  const summary = {
    createdAt: new Date().toISOString(),
    suite: options.suite,
    driver: options.driver,
    model: requestedModel,
    manifestPath: manifest.manifestPath,
    scenarioNames: evaluations.map((entry) => entry.scenario),
    scenarioCount: evaluations.length,
    passedCount,
    failedCount: evaluations.length - passedCount,
    pass: evaluations.every((entry) => entry.pass),
    scenarios: evaluations,
  };
  const reportPaths = writeReports({
    reportDir: options.reportDir,
    suite: options.suite,
    driver: options.driver,
    scenarioLabel,
    model: requestedModel,
    summary,
  });

  console.log("");
  console.log(`AI harness report written to ${reportPaths.jsonPath}`);
  console.log(`AI harness summary written to ${reportPaths.markdownPath}`);

  for (const evaluation of evaluations) {
    console.log(
      `${evaluation.pass ? "PASS" : "FAIL"} ${evaluation.scenario}: ${evaluation.pass ? evaluation.strengths[0] || "scenario passed" : evaluation.failureReason}`,
    );
  }

  if (!summary.pass) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
