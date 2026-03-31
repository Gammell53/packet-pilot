import type { FrameData, FrameDetails, AppSettings, InstallHealthStatus, RuntimeDiagnostics, CaptureStatsResponse } from "../../shared/electron-api";

export interface MockApiOptions {
  frames?: FrameData[];
  frameDetails?: Record<number, FrameDetails>;
  settings?: AppSettings;
  installHealth?: InstallHealthStatus;
  runtimeDiagnostics?: RuntimeDiagnostics;
  captureStats?: CaptureStatsResponse;
  aiRunning?: boolean;
  /** If true, openCapture returns null (simulates cancel) */
  cancelFileOpen?: boolean;
}

/**
 * Creates a JS script string that sets up window.packetPilot mock.
 * Must be injected via page.addInitScript() BEFORE React mounts.
 */
export function createMockApiScript(options: MockApiOptions): string {
  const frames = JSON.stringify(options.frames ?? []);
  const frameDetails = JSON.stringify(options.frameDetails ?? {});
  const settings = JSON.stringify(options.settings ?? { apiKey: null, model: "anthropic/claude-sonnet-4" });
  const installHealth = JSON.stringify(options.installHealth ?? { ok: true, issues: [], checked_paths: [], recommended_action: "" });
  const diagnostics = JSON.stringify(options.runtimeDiagnostics ?? {});
  const captureStats = JSON.stringify(options.captureStats ?? { summary: {}, protocol_hierarchy: [], tcp_conversations: [], udp_conversations: [], endpoints: [] });
  const aiRunning = options.aiRunning ?? false;
  const cancelFileOpen = options.cancelFileOpen ?? false;

  return `(() => {
  const _frames = ${frames};
  const _frameDetails = ${frameDetails};
  let _settings = ${settings};
  const _installHealth = ${installHealth};
  const _diagnostics = ${diagnostics};
  const _captureStats = ${captureStats};
  let _aiRunning = ${aiRunning};
  const _cancelFileOpen = ${cancelFileOpen};

  // Track whether a file has been "loaded"
  let _fileLoaded = false;
  let _activeFilter = "";

  // Callback registries for test control
  const _sharkdErrorCallbacks = [];
  const _streamEventCallbacks = [];

  // Expose test helpers on window
  window.__mockEmitStreamEvent = function(event) {
    _streamEventCallbacks.forEach(function(cb) { cb(event); });
  };
  window.__mockEmitSharkdError = function(msg) {
    _sharkdErrorCallbacks.forEach(function(cb) { cb(msg); });
  };
  window.__mockSetAiRunning = function(running) {
    _aiRunning = running;
  };

  function filterFrames(filter) {
    if (!filter) return _frames;
    var f = filter.toLowerCase();
    // Support protocol filters
    var protoMatch = _frames.filter(function(fr) {
      return fr.protocol.toLowerCase() === f;
    });
    if (protoMatch.length > 0) return protoMatch;
    // Support ip.src filters
    var srcMatch = f.match(/^ip\\.src\\s*==\\s*(.+)$/);
    if (srcMatch) {
      return _frames.filter(function(fr) { return fr.source === srcMatch[1].trim(); });
    }
    // Support ip.dst filters
    var dstMatch = f.match(/^ip\\.dst\\s*==\\s*(.+)$/);
    if (dstMatch) {
      return _frames.filter(function(fr) { return fr.destination === dstMatch[1].trim(); });
    }
    // Default: return all frames
    return _frames;
  }

  function isValidFilter(filter) {
    if (!filter || !filter.trim()) return true;
    var f = filter.toLowerCase().trim();
    // Known good filters
    var goodFilters = ["tcp", "udp", "dns", "http", "icmp", "arp", "tls", "tlsv1.3", "ip", "eth", "frame.number >= 1"];
    if (goodFilters.indexOf(f) >= 0) return true;
    // Pattern-based filters
    if (/^ip\\.(src|dst)\\s*==\\s*.+$/.test(f)) return true;
    if (/^tcp\\.port\\s*==\\s*\\d+$/.test(f)) return true;
    if (/^frame\\.number\\s*(>=|<=|==|>|<)\\s*\\d+$/.test(f)) return true;
    return false;
  }

  var streamIdCounter = 0;

  window.packetPilot = {
    app: {
      getRuntimeDiagnostics: function() {
        return Promise.resolve(JSON.parse(JSON.stringify(_diagnostics)));
      }
    },
    files: {
      openCapture: function() {
        if (_cancelFileOpen) return Promise.resolve(null);
        return Promise.resolve("/mock/test-capture.pcap");
      },
      openExternal: function() {
        return Promise.resolve();
      }
    },
    sharkd: {
      init: function() {
        return Promise.resolve("ok");
      },
      loadPcap: function(path) {
        _fileLoaded = true;
        _activeFilter = "";
        return Promise.resolve({
          success: true,
          frame_count: _frames.length,
          duration: 0.5,
          error: null
        });
      },
      getFrames: function(skip, limit, filter) {
        var source = _activeFilter ? filterFrames(_activeFilter) : _frames;
        // Re-number frames in filtered results for consistency
        var sliced = source.slice(skip, skip + limit);
        return Promise.resolve({
          frames: sliced,
          total: source.length
        });
      },
      getStatus: function() {
        return Promise.resolve({
          frames: _fileLoaded ? _frames.length : 0,
          duration: _fileLoaded ? 0.5 : undefined,
          filename: _fileLoaded ? "test-capture.pcap" : undefined
        });
      },
      checkFilter: function(filter) {
        return Promise.resolve(isValidFilter(filter));
      },
      applyFilter: function(filter) {
        _activeFilter = filter;
        var filtered = filterFrames(filter);
        return Promise.resolve(filtered.length);
      },
      getFrameDetails: function(frameNum) {
        var details = _frameDetails[String(frameNum)];
        if (details) {
          return Promise.resolve(JSON.parse(JSON.stringify(details)));
        }
        // Return a minimal details object for any frame
        return Promise.resolve({
          tree: [{ l: "Frame " + frameNum + ": mock data", n: [{ l: "No detailed dissection available" }] }],
          bytes: "${btoa(String.fromCharCode(...Array.from({ length: 16 }, (_, i) => i)))}"
        });
      },
      getStream: function(streamId, protocol, format) {
        return Promise.resolve({
          server: { host: "10.0.0.1", port: "443" },
          client: { host: "192.168.1.100", port: "49152" },
          server_bytes: 4096,
          client_bytes: 584,
          segments: [],
          combined_text: null
        });
      },
      getCaptureStats: function() {
        return Promise.resolve(JSON.parse(JSON.stringify(_captureStats)));
      },
      getInstallHealth: function() {
        return Promise.resolve(JSON.parse(JSON.stringify(_installHealth)));
      },
      onError: function(callback) {
        _sharkdErrorCallbacks.push(callback);
        return function() {
          var idx = _sharkdErrorCallbacks.indexOf(callback);
          if (idx >= 0) _sharkdErrorCallbacks.splice(idx, 1);
        };
      }
    },
    ai: {
      start: function() {
        _aiRunning = true;
        return Promise.resolve({ is_running: true, model: _settings.model });
      },
      stop: function() {
        _aiRunning = false;
        return Promise.resolve();
      },
      getStatus: function() {
        return Promise.resolve({ is_running: _aiRunning });
      },
      beginAnalyze: function(request) {
        streamIdCounter++;
        var sid = "mock-stream-" + streamIdCounter;
        return Promise.resolve({ streamId: sid });
      },
      cancelAnalyze: function(streamId) {
        return Promise.resolve();
      },
      onStreamEvent: function(callback) {
        _streamEventCallbacks.push(callback);
        return function() {
          var idx = _streamEventCallbacks.indexOf(callback);
          if (idx >= 0) _streamEventCallbacks.splice(idx, 1);
        };
      }
    },
    settings: {
      get: function() {
        return Promise.resolve(JSON.parse(JSON.stringify(_settings)));
      },
      setApiKey: function(apiKey) {
        _settings = Object.assign({}, _settings, { apiKey: apiKey });
        return Promise.resolve(JSON.parse(JSON.stringify(_settings)));
      },
      setModel: function(model) {
        _settings = Object.assign({}, _settings, { model: model });
        return Promise.resolve(JSON.parse(JSON.stringify(_settings)));
      }
    }
  };
})();`;
}
