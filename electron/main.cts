import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AiStreamEvent, AiToolCallTrace } from "../shared/electron-api";
import { appService } from "./services/app-service.cjs";
import { aiAgentService } from "./services/ai-agent-service.cjs";
import { settingsService } from "./services/settings-service.cjs";
import { sharkdService } from "./services/sharkd-service.cjs";

const IPC_CHANNELS = {
  appGetRuntimeDiagnostics: "app:getRuntimeDiagnostics",
  appGetStartupCapturePath: "app:getStartupCapturePath",
  openCapture: "files:openCapture",
  openExternal: "files:openExternal",
  sharkdInit: "sharkd:init",
  sharkdLoadPcap: "sharkd:loadPcap",
  sharkdGetFrames: "sharkd:getFrames",
  sharkdGetStatus: "sharkd:getStatus",
  sharkdCheckFilter: "sharkd:checkFilter",
  sharkdApplyFilter: "sharkd:applyFilter",
  sharkdGetFrameDetails: "sharkd:getFrameDetails",
  sharkdGetStream: "sharkd:getStream",
  sharkdGetCaptureStats: "sharkd:getCaptureStats",
  sharkdGetInstallHealth: "sharkd:getInstallHealth",
  aiStart: "ai:start",
  aiStop: "ai:stop",
  aiGetStatus: "ai:getStatus",
  aiBeginAnalyze: "ai:beginAnalyze",
  aiCancelAnalyze: "ai:cancelAnalyze",
  aiStreamEvent: "ai:streamEvent",
  sharkdError: "sharkd:error",
  settingsGet: "settings:get",
  settingsGetAvailableModels: "settings:getAvailableModels",
  settingsSetApiKey: "settings:setApiKey",
  settingsAcceptAiDisclosure: "settings:acceptAiDisclosure",
  settingsSetModel: "settings:setModel",
} as const;

let mainWindow: BrowserWindow | null = null;

interface SmokeTestResult {
  ok: boolean;
  windowLoaded: boolean;
  capturePath: string | null;
  filter: string | null;
  sharkd: {
    loadedCapture: boolean;
    frameCount: number;
    filteredFrameCount: number | null;
    firstFrameNumber: number | null;
    firstFrameHasTree: boolean;
  };
  ai: {
    required: boolean;
    started: boolean;
    skippedReason: string | null;
    scenario: string | null;
    query: string | null;
    model: string | null;
    resolvedModel: string | null;
    requestId: string | null;
    answer: string | null;
    suggestedFilter: string | null;
    toolCalls: AiToolCallTrace[];
    toolCount: number;
    latencyMs: number | null;
  };
  diagnostics: Awaited<ReturnType<typeof appService.getRuntimeDiagnostics>>;
  error?: string;
}

function isSmokeTestMode(): boolean {
  return process.env.PACKET_PILOT_SMOKE_TEST === "1";
}

async function withTimeout<T>(label: string, promise: Promise<T>, timeoutMs = 10000): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
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

function rendererEntryUrl(): string {
  return process.env.PACKET_PILOT_RENDERER_URL || "http://localhost:1420";
}

function rendererEntryFile(): string {
  return join(app.getAppPath(), "dist", "renderer", "index.html");
}

function startupCapturePath(): string | null {
  const raw = process.env.PACKET_PILOT_OPEN_CAPTURE?.trim() || "";
  if (!raw) {
    return null;
  }

  return resolve(raw);
}

function isTrustedRendererUrl(rawUrl: string): boolean {
  try {
    const actual = new URL(rawUrl);
    if (app.isPackaged) {
      const expected = pathToFileURL(rendererEntryFile());
      actual.hash = "";
      actual.search = "";
      return actual.href === expected.href;
    }

    return actual.origin === new URL(rendererEntryUrl()).origin;
  } catch {
    return false;
  }
}

async function openExternalSafely(rawUrl: string): Promise<void> {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new Error("Invalid external URL");
  }

  if (target.protocol !== "https:") {
    throw new Error(`Blocked external URL protocol: ${target.protocol}`);
  }

  await shell.openExternal(target.href);
}

function registerTrustedHandler(
  channel: string,
  listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!event.senderFrame || !isTrustedRendererUrl(event.senderFrame.url)) {
      throw new Error(`Blocked IPC request on ${channel} from an untrusted renderer`);
    }
    return listener(event, ...args);
  });
}

async function createWindow(): Promise<void> {
  const preloadPath = join(__dirname, "preload.cjs");
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "PacketPilot",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalSafely(url).catch((error) => {
      console.error("Blocked external window request:", error);
    });
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isTrustedRendererUrl(url)) {
      return;
    }
    event.preventDefault();
    void openExternalSafely(url).catch((error) => {
      console.error("Blocked renderer navigation:", error);
    });
  });

  if (!app.isPackaged) {
    await mainWindow.loadURL(rendererEntryUrl());
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(rendererEntryFile());
  }
}

function sendToRenderer(channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send(channel, payload);
}

function registerIpcHandlers(): void {
  registerTrustedHandler(IPC_CHANNELS.appGetRuntimeDiagnostics, () => appService.getRuntimeDiagnostics());
  registerTrustedHandler(IPC_CHANNELS.appGetStartupCapturePath, () => startupCapturePath());

  registerTrustedHandler(IPC_CHANNELS.openCapture, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        {
          name: "Capture Files",
          extensions: ["pcap", "pcapng", "cap", "pcap.gz"],
        },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0] ?? null;
  });

  registerTrustedHandler(IPC_CHANNELS.openExternal, async (_event, url: string) => {
    await openExternalSafely(url);
  });

  registerTrustedHandler(IPC_CHANNELS.sharkdInit, () => sharkdService.init());
  registerTrustedHandler(IPC_CHANNELS.sharkdLoadPcap, (_event, path: string) => sharkdService.loadPcap(path));
  registerTrustedHandler(IPC_CHANNELS.sharkdGetFrames, (_event, skip: number, limit: number, filter?: string) =>
    sharkdService.getFrames(skip, limit, filter ?? sharkdService.getActiveFilter()),
  );
  registerTrustedHandler(IPC_CHANNELS.sharkdGetStatus, () => sharkdService.getStatus());
  registerTrustedHandler(IPC_CHANNELS.sharkdCheckFilter, (_event, filter: string) => sharkdService.checkFilter(filter));
  registerTrustedHandler(IPC_CHANNELS.sharkdApplyFilter, (_event, filter: string) => sharkdService.applyFilter(filter));
  registerTrustedHandler(IPC_CHANNELS.sharkdGetFrameDetails, (_event, frameNum: number) =>
    sharkdService.getFrameDetails(frameNum),
  );
  registerTrustedHandler(IPC_CHANNELS.sharkdGetStream, (_event, streamId: number, protocol?: string, format?: string) =>
    sharkdService.getStream(streamId, protocol, format),
  );
  registerTrustedHandler(IPC_CHANNELS.sharkdGetCaptureStats, () => sharkdService.getCaptureStats());
  registerTrustedHandler(IPC_CHANNELS.sharkdGetInstallHealth, () => sharkdService.getInstallHealth());

  registerTrustedHandler(IPC_CHANNELS.aiStart, () => aiAgentService.start());
  registerTrustedHandler(IPC_CHANNELS.aiStop, () => aiAgentService.stop());
  registerTrustedHandler(IPC_CHANNELS.aiGetStatus, () => aiAgentService.getStatus());
  registerTrustedHandler(IPC_CHANNELS.aiBeginAnalyze, (_event, request) => aiAgentService.beginAnalyze(request));
  registerTrustedHandler(IPC_CHANNELS.aiCancelAnalyze, (_event, streamId: string) => aiAgentService.cancelAnalyze(streamId));

  registerTrustedHandler(IPC_CHANNELS.settingsGet, () => settingsService.getSettings());
  registerTrustedHandler(IPC_CHANNELS.settingsGetAvailableModels, () => settingsService.getAvailableModels());
  registerTrustedHandler(IPC_CHANNELS.settingsSetApiKey, async (_event, apiKey: string | null) => {
    await aiAgentService.stop();
    return settingsService.setApiKey(apiKey);
  });
  registerTrustedHandler(IPC_CHANNELS.settingsAcceptAiDisclosure, () => settingsService.acceptAiDisclosure());
  registerTrustedHandler(IPC_CHANNELS.settingsSetModel, (_event, model: string) => settingsService.setModel(model));
}

async function emitSmokeResult(result: SmokeTestResult): Promise<void> {
  const payload = JSON.stringify(result);
  const resultFile = process.env.PACKET_PILOT_SMOKE_RESULT_FILE?.trim();

  if (resultFile) {
    writeFileSync(resultFile, payload);
  }

  await new Promise<void>((resolve, reject) => {
    process.stdout.write(`PACKET_PILOT_SMOKE_RESULT=${payload}\n`, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function waitForRendererReady(window: BrowserWindow, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = (await window.webContents.executeJavaScript(
      `Boolean(document.querySelector("#root")?.children.length && window.packetPilot)`,
      true,
    )) as boolean;
    if (ready) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`renderer readiness timed out after ${timeoutMs}ms`);
}

async function runSmokeTest(): Promise<SmokeTestResult> {
  if (!mainWindow) {
    throw new Error("Smoke test requires an application window");
  }

  const capturePath = process.env.PACKET_PILOT_SMOKE_CAPTURE?.trim() || null;
  const filter = capturePath ? process.env.PACKET_PILOT_SMOKE_FILTER?.trim() || "frame.number >= 1" : null;
  const requireAi = process.env.PACKET_PILOT_SMOKE_REQUIRE_AI === "1";
  const aiQuery = process.env.PACKET_PILOT_SMOKE_AI_QUERY?.trim() || null;
  const aiModel = process.env.PACKET_PILOT_SMOKE_AI_MODEL?.trim() || null;
  const aiScenario = process.env.PACKET_PILOT_SMOKE_AI_SCENARIO?.trim() || null;
  const aiApiKey = process.env.PACKET_PILOT_SMOKE_API_KEY?.trim() || null;
  const stepTimeoutMs = Number(process.env.PACKET_PILOT_SMOKE_STEP_TIMEOUT_MS || 10000);
  const diagnostics = await withTimeout("runtime diagnostics", appService.getRuntimeDiagnostics(), stepTimeoutMs);

  const result: SmokeTestResult = {
    ok: false,
    windowLoaded: false,
    capturePath,
    filter,
    sharkd: {
      loadedCapture: false,
      frameCount: diagnostics.sharkd.lastKnownStatus?.frames ?? 0,
      filteredFrameCount: null,
      firstFrameNumber: null,
      firstFrameHasTree: false,
    },
    ai: {
      required: requireAi,
      started: false,
      skippedReason: null,
      scenario: aiScenario,
      query: aiQuery,
      model: aiModel,
      resolvedModel: null,
      requestId: null,
      answer: null,
      suggestedFilter: null,
      toolCalls: [],
      toolCount: 0,
      latencyMs: null,
    },
    diagnostics,
  };

  try {
    await waitForRendererReady(mainWindow, stepTimeoutMs);
    result.windowLoaded = true;

    await withTimeout("sharkd status", sharkdService.getStatus(), stepTimeoutMs);

    if (capturePath) {
      const loadResult = await withTimeout("capture load", sharkdService.loadPcap(capturePath), stepTimeoutMs);
      if (!loadResult.success) {
        throw new Error(loadResult.error ?? "Failed to load smoke-test capture");
      }

      result.sharkd.loadedCapture = true;
      result.sharkd.frameCount = loadResult.frame_count;
      if (!Number.isFinite(loadResult.frame_count) || loadResult.frame_count <= 0) {
        throw new Error("Smoke-test capture loaded without any frames");
      }

      if (filter) {
        const isFilterValid = await withTimeout("filter validation", sharkdService.checkFilter(filter), stepTimeoutMs);
        if (!isFilterValid) {
          throw new Error(`Smoke-test filter is invalid: ${filter}`);
        }

        result.sharkd.filteredFrameCount = await withTimeout(
          "filter apply",
          sharkdService.applyFilter(filter),
          stepTimeoutMs,
        );
        if (result.sharkd.filteredFrameCount <= 0) {
          throw new Error(`Smoke-test filter returned no frames: ${filter}`);
        }
      }

      const frames = await withTimeout(
        "frame fetch",
        sharkdService.getFrames(0, 5, sharkdService.getActiveFilter()),
        stepTimeoutMs,
      );
      const firstFrame = frames.frames[0] ?? null;
      result.sharkd.firstFrameNumber = firstFrame?.number ?? null;
      if (!firstFrame) {
        throw new Error("Smoke-test frame fetch returned no frames");
      }

      const details = await withTimeout(
        "frame details",
        sharkdService.getFrameDetails(firstFrame.number),
        stepTimeoutMs,
      );
      result.sharkd.firstFrameHasTree = Array.isArray(details.tree) && details.tree.length > 0;
      if (!result.sharkd.firstFrameHasTree) {
        throw new Error(`Smoke-test frame ${firstFrame.number} returned no protocol detail tree`);
      }
    }

    if (aiApiKey) {
      settingsService.setApiKey(aiApiKey);
      settingsService.acceptAiDisclosure();
    }

    if (aiModel) {
      settingsService.setModel(aiModel);
    }

    const aiStatus = await withTimeout("ai status", aiAgentService.getStatus(), stepTimeoutMs);
    if (requireAi) {
      const startResult = await withTimeout("ai start", aiAgentService.start(), stepTimeoutMs);
      if (!startResult.is_running) {
        throw new Error(startResult.error ?? "Failed to start AI runtime for smoke test");
      }

      result.ai.started = true;

      if (aiQuery) {
        const analyzeResult = await withTimeout(
          "ai analyze",
          aiAgentService.analyzeOnce({
            query: aiQuery,
            model: aiModel || undefined,
            conversation_history: [],
            context: {
              selectedPacketId: result.sharkd.firstFrameNumber,
              selectedStreamId: null,
              visibleRange: { start: 1, end: Math.max(1, Math.min(result.sharkd.frameCount, 200)) },
              currentFilter: sharkdService.getActiveFilter(),
              fileName: capturePath ? basename(capturePath) : null,
              totalFrames: result.sharkd.frameCount,
            },
          }),
          stepTimeoutMs,
        );

        result.ai.answer = analyzeResult.message;
        result.ai.suggestedFilter = analyzeResult.suggested_filter ?? null;
        result.ai.resolvedModel = analyzeResult.model ?? aiModel;
        result.ai.requestId = analyzeResult.request_id ?? null;
        result.ai.toolCalls = analyzeResult.tool_calls ?? [];
        result.ai.toolCount = analyzeResult.tool_count ?? result.ai.toolCalls.length;
        result.ai.latencyMs = analyzeResult.latency_ms ?? null;
      }
    } else if (aiStatus.is_running) {
      result.ai.started = true;
    } else {
      result.ai.skippedReason = aiStatus.error ?? "AI smoke test not requested";
    }

    result.diagnostics = await withTimeout("final runtime diagnostics", appService.getRuntimeDiagnostics(), stepTimeoutMs);
    if (app.isPackaged && process.platform !== "darwin") {
      const resolvedSharkd = result.diagnostics.sharkd.resolvedPath
        ? resolve(result.diagnostics.sharkd.resolvedPath)
        : null;
      const resourcesRoot = resolve(process.resourcesPath);
      const relativeSharkdPath = resolvedSharkd ? relative(resourcesRoot, resolvedSharkd) : "";
      if (
        !resolvedSharkd ||
        !relativeSharkdPath ||
        relativeSharkdPath.startsWith("..") ||
        isAbsolute(relativeSharkdPath)
      ) {
        throw new Error("Packaged smoke resolved sharkd outside application resources");
      }
    }
    result.ok = true;
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.diagnostics = await withTimeout(
      "error runtime diagnostics",
      appService.getRuntimeDiagnostics(),
      stepTimeoutMs,
    );
    return result;
  }
}

app.whenReady().then(async () => {
  try {
    registerIpcHandlers();
    sharkdService.on("error", (message: string) => sendToRenderer(IPC_CHANNELS.sharkdError, String(message)));
    aiAgentService.on("stream-event", (event: AiStreamEvent) => sendToRenderer(IPC_CHANNELS.aiStreamEvent, event));

    await sharkdService.init();
  } catch (error) {
    sendToRenderer(
      IPC_CHANNELS.sharkdError,
      error instanceof Error ? error.message : String(error),
    );
  }

  await createWindow();

  if (isSmokeTestMode()) {
    const result = await runSmokeTest();
    await emitSmokeResult(result);
    app.exit(result.ok ? 0 : 1);
    return;
  }

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  aiAgentService.stop().catch(() => undefined);
  sharkdService.stop();

  if (process.platform !== "darwin") {
    app.quit();
  }
});
