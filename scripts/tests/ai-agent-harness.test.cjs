const assert = require("node:assert/strict");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "electron") {
    return {
      app: {
        getPath: () => path.join(os.tmpdir(), "packet-pilot-ai-harness-tests"),
        getAppPath: () => process.cwd(),
        isPackaged: false,
      },
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: (value) => Buffer.from(String(value), "utf8"),
        decryptString: (buffer) => Buffer.from(buffer).toString("utf8"),
      },
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const { AiAgentService } = require(path.resolve(__dirname, "../../.electron/electron/services/ai-agent-service.cjs"));
Module._load = originalLoad;

const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";

function createRequest(overrides = {}) {
  return {
    query: "What happened in this capture?",
    context: {
      selectedPacketId: null,
      selectedStreamId: null,
      visibleRange: { start: 0, end: 1 },
      currentFilter: "",
      fileName: "http-basic.pcapng",
      totalFrames: 1,
    },
    conversation_history: [],
    ...overrides,
  };
}

function createSharkdRuntime(overrides = {}) {
  return {
    getFrameDetails: async () => ({
      tree: [{ l: "Hypertext Transfer Protocol" }],
      bytes: "47 45 54",
    }),
    getCaptureStats: async () => ({
      summary: {
        total_frames: 1,
        duration: 0,
        protocol_count: 1,
        tcp_conversation_count: 1,
        udp_conversation_count: 0,
        endpoint_count: 2,
      },
      protocol_hierarchy: [],
      tcp_conversations: [],
      udp_conversations: [],
      endpoints: [],
    }),
    searchPackets: async (filter, limit = 50) => ({
      frames: [
        {
          number: 1,
          time: "0.0",
          source: "10.1.1.10",
          destination: "10.1.1.20",
          protocol: "HTTP",
          length: "147",
          info: "GET /status HTTP/1.1",
        },
      ].slice(0, limit),
      totalMatching: 1,
      filterApplied: filter,
    }),
    getStream: async () => ({
      server: { host: "10.1.1.20", port: "80" },
      client: { host: "10.1.1.10", port: "12345" },
      server_bytes: 0,
      client_bytes: 99,
      segments: [],
      combined_text: "GET /status HTTP/1.1\r\nHost: packetpilot.test\r\n\r\n",
    }),
    ...overrides,
  };
}

function createService({
  apiKey = "sk-or-v1-test",
  model = DEFAULT_MODEL,
  sharkd,
  createClient,
} = {}) {
  return new AiAgentService({
    settings: {
      getSettings: () => ({
        apiKey,
        model,
      }),
    },
    sharkd: sharkd || createSharkdRuntime(),
    createClient: createClient || (() => {
      throw new Error("Unexpected OpenRouter client creation");
    }),
  });
}

function streamFromChunks(chunks) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

function contentChunk(content) {
  return {
    choices: [
      {
        delta: {
          content,
        },
      },
    ],
  };
}

function toolCallChunk({ index = 0, id = "call_1", name, argumentsText }) {
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index,
              id,
              function: {
                name,
                arguments: argumentsText,
              },
            },
          ],
        },
      },
    ],
  };
}

function createClientFromStreams(sequence, options = {}) {
  let createCallCount = 0;

  return {
    chat: {
      completions: {
        create: async (...args) => {
          options.onCreate?.(...args);
          const next = sequence[createCallCount];
          createCallCount += 1;
          if (!next) {
            throw new Error(`Unexpected OpenRouter stream request #${createCallCount}`);
          }

          if (typeof next === "function") {
            return next(...args);
          }

          return next;
        },
      },
    },
  };
}

async function waitForTerminalStreamEvent(service, request, afterBegin) {
  const events = [];
  let expectedStreamId = null;

  const terminalEvent = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      service.off("stream-event", handleEvent);
      reject(new Error("Timed out waiting for AI stream"));
    }, 3000);

    const handleEvent = (event) => {
      if (expectedStreamId && event.streamId !== expectedStreamId) {
        return;
      }

      events.push(event);

      if (event.type === "done" || event.type === "error" || event.type === "aborted") {
        clearTimeout(timeout);
        service.off("stream-event", handleEvent);
        resolve({ events, terminal: event });
      }
    };

    service.on("stream-event", handleEvent);
  });

  const { streamId } = await service.beginAnalyze(request);
  expectedStreamId = streamId;
  if (afterBegin) {
    await afterBegin(streamId);
  }

  return terminalEvent;
}

test("start fails with a friendly message when no OpenRouter key is configured", async () => {
  const service = createService({ apiKey: null });

  const result = await service.start();

  assert.equal(result.is_running, false);
  assert.match(result.error, /OpenRouter API key is required/i);

  const diagnostics = service.getDiagnostics();
  assert.equal(diagnostics.hasApiKey, false);
  assert.match(diagnostics.lastIssue?.message ?? "", /OpenRouter API key is required/i);
});

test("analyzeOnce executes a tool call loop and extracts a suggested filter", async () => {
  const searchCalls = [];
  const createCalls = [];
  const sharkd = createSharkdRuntime({
    searchPackets: async (filter, limit = 50) => {
      searchCalls.push({ filter, limit });
      return {
        frames: [
          {
            number: 1,
            time: "0.0",
            source: "10.1.1.10",
            destination: "10.1.1.20",
            protocol: "HTTP",
            length: "147",
            info: "GET /status HTTP/1.1",
          },
        ],
        totalMatching: 1,
        filterApplied: filter,
      };
    },
  });

  const service = createService({
    sharkd,
    createClient: () =>
      createClientFromStreams([
        streamFromChunks([
          toolCallChunk({
            name: "search_packets",
            argumentsText: "{\"filter\":\"http\",\"limit\":1}",
          }),
        ]),
        streamFromChunks([
          contentChunk("I found one HTTP request to packetpilot.test. Use `http.request` to focus on it."),
        ]),
      ], {
        onCreate: (params) => createCalls.push(params),
      }),
  });

  const streamed = [];
  const result = await service.analyzeOnce(createRequest(), {
    onTextDelta: (delta) => streamed.push(delta),
  });

  assert.deepEqual(searchCalls, [{ filter: "http", limit: 1 }]);
  assert.equal(createCalls[0]?.provider?.zdr, true);
  assert.equal(createCalls[0]?.provider?.data_collection, "deny");
  assert.match(result.message, /packetpilot\.test/i);
  assert.equal(result.model, DEFAULT_MODEL);
  assert.equal(result.tool_count, 1);
  assert.equal(result.tool_calls?.[0]?.name, "search_packets");
  assert.deepEqual(result.tool_calls?.[0]?.arguments, {
    filter: "http",
    limit: 1,
  });
  assert.equal(typeof result.latency_ms, "number");
  assert.equal(result.suggested_filter, "http.request");
  assert.equal(streamed.join(""), result.message);
});

test("beginAnalyze emits streaming text and a done event", async () => {
  const service = createService({
    createClient: () =>
      createClientFromStreams([
        streamFromChunks([
          contentChunk("Hello "),
          contentChunk("world"),
        ]),
      ]),
  });

  const { events, terminal } = await waitForTerminalStreamEvent(service, createRequest());

  assert.equal(terminal.type, "done");
  assert.equal(terminal.result.message, "Hello world");
  assert.deepEqual(
    events.filter((event) => event.type === "text").map((event) => event.text),
    ["Hello ", "world"],
  );
});

test("cancelAnalyze aborts an in-flight request", async () => {
  const service = createService({
    createClient: () =>
      createClientFromStreams([
        (_params, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener(
              "abort",
              () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
              { once: true },
            );
          }),
      ]),
  });

  const { terminal } = await waitForTerminalStreamEvent(service, createRequest(), async (streamId) => {
    await service.cancelAnalyze(streamId);
  });

  assert.equal(terminal.type, "aborted");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.getDiagnostics().activeRequestCount, 0);
});

test("beginAnalyze emits a friendly quota error message", async () => {
  const service = createService({
    createClient: () =>
      createClientFromStreams([
        async () => {
          throw Object.assign(new Error("insufficient_quota"), { status: 429 });
        },
      ]),
  });

  const { terminal } = await waitForTerminalStreamEvent(service, createRequest());

  assert.equal(terminal.type, "error");
  assert.match(terminal.error, /quota or rate-limit error/i);
});

test("analyzeOnce rejects after exceeding the maximum tool-call depth", async () => {
  const toolLoop = streamFromChunks([
    toolCallChunk({
      name: "search_packets",
      argumentsText: "{\"filter\":\"http\"}",
    }),
  ]);

  const service = createService({
    createClient: () =>
      createClientFromStreams([
        toolLoop,
        toolLoop,
        toolLoop,
        toolLoop,
        toolLoop,
        toolLoop,
        toolLoop,
        toolLoop,
        toolLoop,
      ]),
  });

  await assert.rejects(
    () => service.analyzeOnce(createRequest()),
    /maximum tool-call depth/i,
  );
});
