import { contextBridge, ipcRenderer } from "electron";
import type { AiStreamEvent, PacketPilotApi } from "../shared/electron-api";

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
  sharkdError: "sharkd:error",
  aiStart: "ai:start",
  aiStop: "ai:stop",
  aiGetStatus: "ai:getStatus",
  aiBeginAnalyze: "ai:beginAnalyze",
  aiCancelAnalyze: "ai:cancelAnalyze",
  aiStreamEvent: "ai:streamEvent",
  settingsGet: "settings:get",
  settingsGetAvailableModels: "settings:getAvailableModels",
  settingsSetApiKey: "settings:setApiKey",
  settingsSetModel: "settings:setModel",
} as const;

const api: PacketPilotApi = {
  app: {
    getRuntimeDiagnostics: () => ipcRenderer.invoke(IPC_CHANNELS.appGetRuntimeDiagnostics),
    getStartupCapturePath: () => ipcRenderer.invoke(IPC_CHANNELS.appGetStartupCapturePath),
  },
  files: {
    openCapture: () => ipcRenderer.invoke(IPC_CHANNELS.openCapture),
    openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.openExternal, url),
  },
  sharkd: {
    init: () => ipcRenderer.invoke(IPC_CHANNELS.sharkdInit),
    loadPcap: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.sharkdLoadPcap, path),
    getFrames: (skip: number, limit: number, filter?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.sharkdGetFrames, skip, limit, filter),
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.sharkdGetStatus),
    checkFilter: (filter: string) => ipcRenderer.invoke(IPC_CHANNELS.sharkdCheckFilter, filter),
    applyFilter: (filter: string) => ipcRenderer.invoke(IPC_CHANNELS.sharkdApplyFilter, filter),
    getFrameDetails: (frameNum: number) => ipcRenderer.invoke(IPC_CHANNELS.sharkdGetFrameDetails, frameNum),
    getStream: (streamId: number, protocol?: string, format?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.sharkdGetStream, streamId, protocol, format),
    getCaptureStats: () => ipcRenderer.invoke(IPC_CHANNELS.sharkdGetCaptureStats),
    getInstallHealth: () => ipcRenderer.invoke(IPC_CHANNELS.sharkdGetInstallHealth),
    onError: (callback: (message: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
      ipcRenderer.on(IPC_CHANNELS.sharkdError, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.sharkdError, handler);
    },
  },
  ai: {
    start: () => ipcRenderer.invoke(IPC_CHANNELS.aiStart),
    stop: () => ipcRenderer.invoke(IPC_CHANNELS.aiStop),
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.aiGetStatus),
    beginAnalyze: (request) => ipcRenderer.invoke(IPC_CHANNELS.aiBeginAnalyze, request),
    cancelAnalyze: (streamId: string) => ipcRenderer.invoke(IPC_CHANNELS.aiCancelAnalyze, streamId),
    onStreamEvent: (callback: (event: AiStreamEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: AiStreamEvent) => callback(payload);
      ipcRenderer.on(IPC_CHANNELS.aiStreamEvent, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.aiStreamEvent, handler);
    },
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGet),
    getAvailableModels: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGetAvailableModels),
    setApiKey: (apiKey: string | null) => ipcRenderer.invoke(IPC_CHANNELS.settingsSetApiKey, apiKey),
    setModel: (model: string) => ipcRenderer.invoke(IPC_CHANNELS.settingsSetModel, model),
  },
};

contextBridge.exposeInMainWorld("packetPilot", api);
