import { app } from "electron";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";
import type {
  RuntimeIssue,
  CaptureStatsResponse,
  FrameData,
  FrameDetails,
  FramesResult,
  InstallHealthStatus,
  LoadResult,
  SharkdRuntimeDiagnostics,
  SharkdStatus,
  StreamResponse,
} from "../../shared/electron-api";

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface SharkdFrame {
  c: string[];
  num: number;
  bg?: string;
  fg?: string;
}

interface StreamPayload {
  n: number;
  d: string;
  s: number;
}

interface RawStreamData {
  shost?: string;
  sport?: string;
  chost?: string;
  cport?: string;
  sbytes?: number;
  cbytes?: number;
  payloads?: StreamPayload[];
}

interface ProtocolNode {
  proto: string;
  frames?: number;
  bytes?: number;
  protos?: ProtocolNode[];
}

interface Conversation {
  saddr?: string;
  daddr?: string;
  sport?: string | null;
  dport?: string | null;
  rxf?: number;
  rxb?: number;
  txf?: number;
  txb?: number;
  filter?: string | null;
}

interface Endpoint {
  host?: string;
  port?: string | null;
  rxf?: number;
  rxb?: number;
  txf?: number;
  txb?: number;
}

function getTargetTriple(): string {
  if (process.platform === "win32" && process.arch === "x64") return "x86_64-pc-windows-msvc";
  if (process.platform === "darwin" && process.arch === "arm64") return "aarch64-apple-darwin";
  if (process.platform === "darwin" && process.arch === "x64") return "x86_64-apple-darwin";
  if (process.platform === "linux" && process.arch === "arm64") return "aarch64-unknown-linux-gnu";
  if (process.platform === "linux" && process.arch === "x64") return "x86_64-unknown-linux-gnu";
  return "unknown";
}

function bundledBinaryCandidates(): string[] {
  const target = getTargetTriple();
  const devRoot = app.getAppPath();
  const packagedRoot = process.resourcesPath;
  const devResourcesRoot = join(devRoot, "resources", "sharkd");

  if (process.platform === "win32") {
    const names = [
      `sharkd-${target}.exe`,
      "sharkd.exe",
    ];

    return (app.isPackaged ? [packagedRoot] : [devResourcesRoot]).flatMap(
      (base) => names.map((name) => join(base, name)),
    );
  }

  const names = [
    `sharkd-wrapper-${target}`,
    `sharkd-${target}`,
    "sharkd",
  ];

  return (app.isPackaged ? [packagedRoot] : [devResourcesRoot]).flatMap(
    (base) => names.map((name) => join(base, name)),
  );
}

function systemBinaryCandidates(): string[] {
  if (process.platform === "win32") {
    return [
      "C:\\Program Files\\Wireshark\\sharkd.exe",
      "C:\\Program Files (x86)\\Wireshark\\sharkd.exe",
    ];
  }

  return ["/usr/bin/sharkd", "/usr/local/bin/sharkd"];
}

function convertFrame(frame: SharkdFrame): FrameData {
  const columns = frame.c ?? [];
  return {
    number: frame.num,
    time: columns[1] ?? "",
    source: columns[2] ?? "",
    destination: columns[3] ?? "",
    protocol: columns[4] ?? "",
    length: columns[5] ?? "",
    info: columns[6] ?? "",
    background: frame.bg,
    foreground: frame.fg,
  };
}

function convertProtocolNode(node: ProtocolNode): CaptureStatsResponse["protocol_hierarchy"][number] {
  return {
    protocol: node.proto,
    frames: node.frames ?? 0,
    bytes: node.bytes ?? 0,
    children: (node.protos ?? []).map(convertProtocolNode),
  };
}

function decodePayload(payload: string, format: string): string {
  const bytes = Buffer.from(payload, "base64");
  if (format === "raw") {
    return payload;
  }

  if (format === "hex") {
    return Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(" ");
  }

  return bytes.toString("utf8");
}

class SharkdService extends EventEmitter {
  private process: ReturnType<typeof spawn> | null = null;
  private stdoutReader: readline.Interface | null = null;
  private requestId = 1;
  private requestChain = Promise.resolve<unknown>(undefined);
  private activeFilter = "";
  private filterTotals = new Map<string, number>();
  private resolvedBinaryPath: string | null = null;
  private lastKnownStatus: SharkdStatus | null = null;
  private lastIssue: RuntimeIssue | null = null;
  private stopping = false;

  async init(): Promise<string> {
    if (this.isRunning()) {
      return "Sharkd already initialized";
    }

    try {
      const binaryPath = this.findSharkd();
      this.stopping = false;
      this.process = spawn(binaryPath, ["-"], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.process.once("error", (error) => {
        this.recordIssue(
          "startup",
          `Failed to start sharkd: ${error.message}`,
          this.buildIssueDetail(binaryPath, error),
        );
      });

      this.process.stderr?.on("data", (chunk: Buffer) => {
        const message = chunk.toString("utf8").trim();
        if (message && !this.isInfoMessage(message)) {
          this.recordIssue("runtime", `sharkd reported an error: ${message}`, this.buildIssueDetail(binaryPath));
          this.emit("error", message);
        }
      });

      this.process.once("exit", (code, signal) => {
        this.process = null;
        this.stdoutReader?.close();
        this.stdoutReader = null;
        if (this.stopping) {
          this.stopping = false;
          return;
        }
        this.recordIssue(
          "runtime",
          `sharkd exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"})`,
          this.buildIssueDetail(binaryPath),
        );
        this.emit("error", `sharkd exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"})`);
      });

      if (!this.process.stdout) {
        throw new Error("Failed to capture sharkd stdout");
      }

      this.stdoutReader = readline.createInterface({ input: this.process.stdout });
      await this.getStatus();
      this.lastIssue = null;
      return "Sharkd initialized successfully";
    } catch (error) {
      this.recordIssue(
        "startup",
        error instanceof Error ? error.message : String(error),
        this.buildIssueDetail(this.resolvedBinaryPath, error),
      );
      this.stop();
      throw error;
    }
  }

  async loadPcap(path: string): Promise<LoadResult> {
    const t0 = performance.now();
    await this.init();
    const tInit = performance.now();

    try {
      const result = await this.sendRequest("load", { file: path });
      const tLoad = performance.now();
      const object = this.asObject(result);
      if (object.status === "OK" || object.err === undefined) {
        this.activeFilter = "";
        this.filterTotals.clear();
        const status = await this.getStatus();
        const tStatus = performance.now();
        console.log(
          `[perf] loadPcap: init=${(tInit - t0).toFixed(0)}ms, sharkd_load=${(tLoad - tInit).toFixed(0)}ms, status=${(tStatus - tLoad).toFixed(0)}ms, total=${(tStatus - t0).toFixed(0)}ms, frames=${status.frames ?? 0}`,
        );
        return {
          success: true,
          frame_count: status.frames ?? 0,
          duration: status.duration ?? null,
          error: null,
        };
      }

      return {
        success: false,
        frame_count: 0,
        duration: null,
        error: `Failed to load capture (error code ${String(object.err)})`,
      };
    } catch (error) {
      return {
        success: false,
        frame_count: 0,
        duration: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getStatus(): Promise<SharkdStatus> {
    await this.initIfNeeded();
    const result = await this.sendRequest("status");
    const status = this.asObject(result) as SharkdStatus;
    this.lastKnownStatus = status;
    return status;
  }

  async getFrames(skip: number, limit: number, filter = ""): Promise<FramesResult> {
    const t0 = performance.now();
    const normalizedFilter = filter.trim();
    const params: Record<string, unknown> = { limit };
    if (skip > 0) params.skip = skip;
    if (normalizedFilter) params.filter = normalizedFilter;

    const result = await this.sendRequest("frames", params);
    const tFrames = performance.now();
    const frames = this.asArray(result).map((frame) => convertFrame(frame as SharkdFrame));
    const total = normalizedFilter
      ? await this.getFilterTotal(normalizedFilter)
      : (await this.getStatus()).frames ?? frames.length;
    const tTotal = performance.now();

    console.log(
      `[perf] getFrames: skip=${skip} limit=${limit} sharkd=${(tFrames - t0).toFixed(0)}ms total_query=${(tTotal - tFrames).toFixed(0)}ms count=${frames.length}`,
    );

    return { frames, total };
  }

  async checkFilter(filter: string): Promise<boolean> {
    await this.initIfNeeded();
    try {
      const result = await this.sendRequest("check", { filter });
      return this.asObject(result).err === undefined;
    } catch (error) {
      if (this.isInvalidFilterError(error)) {
        return false;
      }

      throw error;
    }
  }

  async applyFilter(filter: string): Promise<number> {
    const normalizedFilter = filter.trim();
    if (!normalizedFilter) {
      this.activeFilter = "";
      return (await this.getStatus()).frames ?? 0;
    }

    const isValid = await this.checkFilter(normalizedFilter);
    if (!isValid) {
      throw new Error("Invalid filter expression");
    }

    this.activeFilter = normalizedFilter;
    return this.getFilterTotal(normalizedFilter);
  }

  getActiveFilter(): string {
    return this.activeFilter;
  }

  async getFrameDetails(frameNum: number): Promise<FrameDetails> {
    await this.initIfNeeded();
    const result = await this.sendRequest("frame", {
      frame: frameNum,
      proto: true,
      bytes: true,
    });

    return this.asObject(result) as FrameDetails;
  }

  async searchPackets(filter: string, limit = 100, skip = 0): Promise<{ frames: FrameData[]; totalMatching: number; filterApplied: string }> {
    const normalizedFilter = filter.trim();
    if (!normalizedFilter) {
      throw new Error("Filter is required");
    }

    const isValid = await this.checkFilter(normalizedFilter);
    if (!isValid) {
      return { frames: [], totalMatching: 0, filterApplied: normalizedFilter };
    }

    const result = await this.getFrames(skip, limit, normalizedFilter);
    return {
      frames: result.frames,
      totalMatching: result.total,
      filterApplied: normalizedFilter,
    };
  }

  async getStream(streamId: number, protocol = "TCP", format = "ascii"): Promise<StreamResponse> {
    await this.initIfNeeded();
    const normalizedProtocol = protocol.toUpperCase();
    const result = await this.sendRequest("follow", {
      follow: normalizedProtocol,
      filter: `${normalizedProtocol.toLowerCase()}.stream==${streamId}`,
    });

    const stream = this.asObject(result) as RawStreamData;
    const segments = (stream.payloads ?? []).map((payload) => ({
      direction: payload.s === 1 ? "server_to_client" : "client_to_server",
      size: payload.n,
      data: decodePayload(payload.d, format),
    }));

    return {
      server: { host: stream.shost ?? "", port: stream.sport ?? "" },
      client: { host: stream.chost ?? "", port: stream.cport ?? "" },
      server_bytes: stream.sbytes ?? 0,
      client_bytes: stream.cbytes ?? 0,
      segments,
      combined_text:
        format === "ascii"
          ? segments.map((segment) => `[${segment.direction}]\n${segment.data}`).join("\n\n")
          : null,
    };
  }

  async getCaptureStats(): Promise<CaptureStatsResponse> {
    await this.initIfNeeded();
    const status = await this.getStatus();
    const result = await this.sendRequest("tap", {
      tap0: "phs",
      tap1: "conv:TCP",
      tap2: "conv:UDP",
      tap3: "endpt:IPv4",
    });

    const taps = this.asArray(this.asObject(result).taps);
    const findTap = (name: string) =>
      taps.find((tap) => this.asObject(tap).tap === name);

    const protocolHierarchy = this.asArray(this.asObject(findTap("phs")).protos).map(
      (node) => convertProtocolNode(node as ProtocolNode),
    );
    const tcpConversations = this.asArray(this.asObject(findTap("conv:TCP")).convs).map((conversation) => {
      const item = conversation as Conversation;
      return {
        src_addr: item.saddr ?? "",
        dst_addr: item.daddr ?? "",
        src_port: item.sport,
        dst_port: item.dport,
        rx_frames: item.rxf ?? 0,
        rx_bytes: item.rxb ?? 0,
        tx_frames: item.txf ?? 0,
        tx_bytes: item.txb ?? 0,
        filter: item.filter,
      };
    });
    const udpConversations = this.asArray(this.asObject(findTap("conv:UDP")).convs).map((conversation) => {
      const item = conversation as Conversation;
      return {
        src_addr: item.saddr ?? "",
        dst_addr: item.daddr ?? "",
        src_port: item.sport,
        dst_port: item.dport,
        rx_frames: item.rxf ?? 0,
        rx_bytes: item.rxb ?? 0,
        tx_frames: item.txf ?? 0,
        tx_bytes: item.txb ?? 0,
        filter: item.filter,
      };
    });
    const endpoints = this.asArray(this.asObject(findTap("endpt:IPv4")).hosts).map((endpoint) => {
      const item = endpoint as Endpoint;
      return {
        host: item.host ?? "",
        port: item.port,
        rx_frames: item.rxf ?? 0,
        rx_bytes: item.rxb ?? 0,
        tx_frames: item.txf ?? 0,
        tx_bytes: item.txb ?? 0,
      };
    });

    return {
      summary: {
        total_frames: status.frames ?? 0,
        duration: status.duration ?? null,
        protocol_count: this.countProtocols(protocolHierarchy),
        tcp_conversation_count: tcpConversations.length,
        udp_conversation_count: udpConversations.length,
        endpoint_count: endpoints.length,
      },
      protocol_hierarchy: protocolHierarchy,
      tcp_conversations: tcpConversations,
      udp_conversations: udpConversations,
      endpoints,
    };
  }

  async getInstallHealth(): Promise<InstallHealthStatus> {
    const checked_paths = [...bundledBinaryCandidates(), ...systemBinaryCandidates()];
    const issues: InstallHealthStatus["issues"] = [];

    let resolvedPath: string | null = null;
    try {
      resolvedPath = this.findSharkd();
    } catch (error) {
      issues.push({
        code: "missing_sharkd",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (process.platform === "win32" && app.isPackaged) {
      const required = [
        "libwireshark.dll",
        "libwiretap.dll",
        "libwsutil.dll",
        "libglib-2.0-0.dll",
      ];

      for (const file of required) {
        const candidate = join(process.resourcesPath, file);
        if (!existsSync(candidate)) {
          issues.push({
            code: "missing_dependency",
            message: `Required runtime library is missing: ${file}`,
            path: candidate,
          });
        }
      }
    }

    if (
      this.lastIssue &&
      this.lastIssue.source === "sharkd" &&
      issues.every((issue) => issue.message !== this.lastIssue?.message)
    ) {
      issues.push({
        code: this.lastIssue.stage === "startup" ? "spawn_failed" : "runtime_error",
        message: this.lastIssue.message,
        path: this.resolvedBinaryPath ?? undefined,
      });
    }

    return {
      ok: issues.length === 0,
      issues,
      checked_paths,
      recommended_action: issues.length > 0 ? "repair" : "none",
    };
  }

  async getDiagnostics(): Promise<SharkdRuntimeDiagnostics> {
    return {
      isRunning: this.isRunning(),
      activeFilter: this.activeFilter,
      resolvedPath: this.resolvedBinaryPath,
      bundledCandidates: bundledBinaryCandidates(),
      systemCandidates: systemBinaryCandidates(),
      lastKnownStatus: this.lastKnownStatus,
      installHealth: await this.getInstallHealth(),
      lastIssue: this.lastIssue,
    };
  }

  stop(): void {
    this.stopping = true;
    this.process?.kill();
    this.process = null;
    this.stdoutReader?.close();
    this.stdoutReader = null;
  }

  private async initIfNeeded(): Promise<void> {
    if (!this.isRunning()) {
      await this.init();
    }
  }

  private isRunning(): boolean {
    return Boolean(this.process && !this.process.killed);
  }

  private findSharkd(): string {
    for (const candidate of [...bundledBinaryCandidates(), ...systemBinaryCandidates()]) {
      if (existsSync(candidate)) {
        this.resolvedBinaryPath = candidate;
        return candidate;
      }
    }

    throw new Error("sharkd binary not found in bundled or system locations");
  }

  private async getFilterTotal(filter: string): Promise<number> {
    const cached = this.filterTotals.get(filter);
    if (cached !== undefined) {
      return cached;
    }

    let total = 0;
    const pageSize = 5000;

    while (true) {
      const params: Record<string, unknown> = {
        filter,
        limit: pageSize,
      };
      if (total > 0) {
        params.skip = total;
      }
      const result = await this.sendRequest("frames", params);
      const frames = this.asArray(result);
      total += frames.length;

      if (frames.length < pageSize) {
        break;
      }
    }

    this.filterTotals.set(filter, total);
    return total;
  }

  private async sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return this.enqueue(async () => {
      if (!this.process?.stdin || !this.stdoutReader) {
        throw new Error("sharkd is not running");
      }

      const requestId = this.requestId++;
      const payload = `${JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        method,
        ...(params ? { params } : {}),
      })}\n`;

      await new Promise<void>((resolve, reject) => {
        this.process?.stdin?.write(payload, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      const line = await new Promise<string>((resolve, reject) => {
        const cleanup = () => {
          this.stdoutReader?.off("line", handleLine);
          this.process?.off("exit", handleExit);
        };

        const handleLine = (value: string) => {
          cleanup();
          resolve(value);
        };

        const handleExit = () => {
          cleanup();
          reject(new Error("sharkd exited before responding"));
        };

        this.stdoutReader?.once("line", handleLine);
        this.process?.once("exit", handleExit);
      });

      const response = JSON.parse(line) as JsonRpcResponse;
      if (response.error) {
        throw new Error(`Sharkd error ${response.error.code}: ${response.error.message}`);
      }

      return response.result;
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.requestChain.then(operation, operation);
    this.requestChain = run.then(() => undefined, () => undefined);
    return run;
  }

  private asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  }

  private asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  private countProtocols(nodes: CaptureStatsResponse["protocol_hierarchy"]): number {
    return nodes.reduce((count, node) => count + 1 + this.countProtocols(node.children), 0);
  }

  private isInfoMessage(message: string): boolean {
    // sharkd 4.x writes informational diagnostics to stderr that are not errors
    return /^(Hello in child\.|load: filename=|Running as user|sharkd_session_process_tap\(\))/.test(message);
  }

  private isInvalidFilterError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return /Sharkd error -5001: Filter invalid/i.test(error.message);
  }

  private buildIssueDetail(binaryPath: string | null, error?: unknown): string {
    const lines = [
      binaryPath ? `Resolved binary: ${binaryPath}` : "Resolved binary: <not found>",
      "Bundled candidates:",
      ...bundledBinaryCandidates().map((candidate) => `- ${candidate}`),
      "System candidates:",
      ...systemBinaryCandidates().map((candidate) => `- ${candidate}`),
    ];

    if (error instanceof Error && error.stack) {
      lines.push("Stack trace:", error.stack);
    }

    return lines.join("\n");
  }

  private recordIssue(stage: RuntimeIssue["stage"], message: string, detail?: string): void {
    this.lastIssue = {
      source: "sharkd",
      stage,
      message,
      detail,
      timestamp: new Date().toISOString(),
    };
  }
}

export const sharkdService = new SharkdService();
