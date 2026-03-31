import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
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
  return join(app.getAppPath(), "dist", "index.html");
}

function startupCapturePath(): string | null {
  const raw = process.env.PACKET_PILOT_OPEN_CAPTURE?.trim() || "";
  if (!raw) {
    return null;
  }

  return resolve(raw);
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
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isSmokeTestMode()) {
    await mainWindow.loadURL("data:text/html,<html><body>PacketPilot smoke test</body></html>");
  } else if (!app.isPackaged) {
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
  ipcMain.handle(IPC_CHANNELS.appGetRuntimeDiagnostics, () => appService.getRuntimeDiagnostics());
  ipcMain.handle(IPC_CHANNELS.appGetStartupCapturePath, () => startupCapturePath());

  ipcMain.handle(IPC_CHANNELS.openCapture, async () => {
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

  ipcMain.handle(IPC_CHANNELS.openExternal, async (_event, url: string) => {
    await shell.openExternal(url);
  });

  ipcMain.handle(IPC_CHANNELS.sharkdInit, () => sharkdService.init());
  ipcMain.handle(IPC_CHANNELS.sharkdLoadPcap, (_event, path: string) => sharkdService.loadPcap(path));
  ipcMain.handle(IPC_CHANNELS.sharkdGetFrames, (_event, skip: number, limit: number, filter?: string) =>
    sharkdService.getFrames(skip, limit, filter ?? sharkdService.getActiveFilter()),
  );
  ipcMain.handle(IPC_CHANNELS.sharkdGetStatus, () => sharkdService.getStatus());
  ipcMain.handle(IPC_CHANNELS.sharkdCheckFilter, (_event, filter: string) => sharkdService.checkFilter(filter));
  ipcMain.handle(IPC_CHANNELS.sharkdApplyFilter, (_event, filter: string) => sharkdService.applyFilter(filter));
  ipcMain.handle(IPC_CHANNELS.sharkdGetFrameDetails, (_event, frameNum: number) =>
    sharkdService.getFrameDetails(frameNum),
  );
  ipcMain.handle(IPC_CHANNELS.sharkdGetStream, (_event, streamId: number, protocol?: string, format?: string) =>
    sharkdService.getStream(streamId, protocol, format),
  );
  ipcMain.handle(IPC_CHANNELS.sharkdGetCaptureStats, () => sharkdService.getCaptureStats());
  ipcMain.handle(IPC_CHANNELS.sharkdGetInstallHealth, () => sharkdService.getInstallHealth());

  ipcMain.handle(IPC_CHANNELS.aiStart, () => aiAgentService.start());
  ipcMain.handle(IPC_CHANNELS.aiStop, () => aiAgentService.stop());
  ipcMain.handle(IPC_CHANNELS.aiGetStatus, () => aiAgentService.getStatus());
  ipcMain.handle(IPC_CHANNELS.aiBeginAnalyze, (_event, request) => aiAgentService.beginAnalyze(request));
  ipcMain.handle(IPC_CHANNELS.aiCancelAnalyze, (_event, streamId: string) => aiAgentService.cancelAnalyze(streamId));

  ipcMain.handle(IPC_CHANNELS.settingsGet, () => settingsService.getSettings());
  ipcMain.handle(IPC_CHANNELS.settingsGetAvailableModels, () => settingsService.getAvailableModels());
  ipcMain.handle(IPC_CHANNELS.settingsSetApiKey, (_event, apiKey: string | null) => settingsService.setApiKey(apiKey));
  ipcMain.handle(IPC_CHANNELS.settingsSetModel, (_event, model: string) => settingsService.setModel(model));
}

async function waitForWindowLoad(window: BrowserWindow): Promise<void> {
  const webContents = window.webContents as any;

  if (!webContents.isLoadingMainFrame()) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      webContents.off("did-finish-load", handleLoad);
      webContents.off("did-fail-load", handleFail);
    };

    const handleLoad = () => {
      cleanup();
      resolve();
    };

    const handleFail = (_event: Event, _errorCode: number, errorDescription: string) => {
      cleanup();
      reject(new Error(`Renderer failed to load: ${errorDescription}`));
    };

    webContents.once("did-finish-load", handleLoad);
    webContents.once("did-fail-load", handleFail);
  });
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
    windowLoaded: true,
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
    await withTimeout("sharkd status", sharkdService.getStatus(), stepTimeoutMs);

    if (capturePath) {
      const loadResult = await withTimeout("capture load", sharkdService.loadPcap(capturePath), stepTimeoutMs);
      if (!loadResult.success) {
        throw new Error(loadResult.error ?? "Failed to load smoke-test capture");
      }

      result.sharkd.loadedCapture = true;
      result.sharkd.frameCount = loadResult.frame_count;

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
      }

      const frames = await withTimeout(
        "frame fetch",
        sharkdService.getFrames(0, 5, sharkdService.getActiveFilter()),
        stepTimeoutMs,
      );
      const firstFrame = frames.frames[0] ?? null;
      result.sharkd.firstFrameNumber = firstFrame?.number ?? null;

      if (firstFrame) {
        const details = await withTimeout(
          "frame details",
          sharkdService.getFrameDetails(firstFrame.number),
          stepTimeoutMs,
        );
        result.sharkd.firstFrameHasTree = Array.isArray(details.tree) && details.tree.length > 0;
      }
    }

    if (aiApiKey) {
      settingsService.setApiKey(aiApiKey);
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
