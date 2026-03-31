import type { PacketPilotApi } from "../../shared/electron-api";

function getPacketPilotApi(): PacketPilotApi {
  if (!window.packetPilot) {
    throw new Error("PacketPilot desktop API is unavailable. Launch the app through Electron.");
  }

  return window.packetPilot;
}

export const desktop = {
  app: {
    getRuntimeDiagnostics: () => getPacketPilotApi().app.getRuntimeDiagnostics(),
    getStartupCapturePath: () => getPacketPilotApi().app.getStartupCapturePath(),
  },
  files: {
    openCapture: () => getPacketPilotApi().files.openCapture(),
    openExternal: (url: string) => getPacketPilotApi().files.openExternal(url),
  },
  sharkd: {
    init: () => getPacketPilotApi().sharkd.init(),
    loadPcap: (path: string) => getPacketPilotApi().sharkd.loadPcap(path),
    getFrames: (skip: number, limit: number, filter?: string) =>
      getPacketPilotApi().sharkd.getFrames(skip, limit, filter),
    getStatus: () => getPacketPilotApi().sharkd.getStatus(),
    checkFilter: (filter: string) => getPacketPilotApi().sharkd.checkFilter(filter),
    applyFilter: (filter: string) => getPacketPilotApi().sharkd.applyFilter(filter),
    getFrameDetails: (frameNum: number) => getPacketPilotApi().sharkd.getFrameDetails(frameNum),
    getStream: (streamId: number, protocol?: string, format?: string) =>
      getPacketPilotApi().sharkd.getStream(streamId, protocol, format),
    getCaptureStats: () => getPacketPilotApi().sharkd.getCaptureStats(),
    getInstallHealth: () => getPacketPilotApi().sharkd.getInstallHealth(),
    onError: (callback: (message: string) => void) => getPacketPilotApi().sharkd.onError(callback),
  },
  ai: {
    start: () => getPacketPilotApi().ai.start(),
    stop: () => getPacketPilotApi().ai.stop(),
    getStatus: () => getPacketPilotApi().ai.getStatus(),
    beginAnalyze: (request: Parameters<PacketPilotApi["ai"]["beginAnalyze"]>[0]) =>
      getPacketPilotApi().ai.beginAnalyze(request),
    cancelAnalyze: (streamId: string) => getPacketPilotApi().ai.cancelAnalyze(streamId),
    onStreamEvent: (callback: Parameters<PacketPilotApi["ai"]["onStreamEvent"]>[0]) =>
      getPacketPilotApi().ai.onStreamEvent(callback),
  },
  settings: {
    get: () => getPacketPilotApi().settings.get(),
    getAvailableModels: () => getPacketPilotApi().settings.getAvailableModels(),
    setApiKey: (apiKey: string | null) => getPacketPilotApi().settings.setApiKey(apiKey),
    setModel: (model: string) => getPacketPilotApi().settings.setModel(model),
  },
};
