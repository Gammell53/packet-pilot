const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const originalLoad = Module._load;
const originalOverride = process.env.PACKET_PILOT_SHARKD_PATH;
const candidate = path.join(process.cwd(), "test-results", "mock-sharkd");
let candidateAvailable = false;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "electron") {
    return {
      app: {
        isPackaged: false,
        getPath: () => process.cwd(),
        getAppPath: () => process.cwd(),
      },
    };
  }
  if (request === "node:fs") {
    const realFs = originalLoad.call(this, request, parent, isMain);
    return {
      ...realFs,
      existsSync: (value) => candidateAvailable && path.resolve(value) === candidate,
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

process.env.PACKET_PILOT_SHARKD_PATH = candidate;
const { sharkdService } = require(path.resolve(
  __dirname,
  "../../.electron/electron/services/sharkd-service.cjs",
));
Module._load = originalLoad;

test.after(() => {
  if (originalOverride === undefined) {
    delete process.env.PACKET_PILOT_SHARKD_PATH;
  } else {
    process.env.PACKET_PILOT_SHARKD_PATH = originalOverride;
  }
});

test("install health recovers when sharkd becomes discoverable after startup failure", async () => {
  candidateAvailable = false;
  await assert.rejects(sharkdService.init(), /not found/i);

  candidateAvailable = true;
  const health = await sharkdService.getInstallHealth();

  assert.equal(health.ok, true);
  assert.deepEqual(health.issues, []);
  const diagnostics = await sharkdService.getDiagnostics();
  assert.match(diagnostics.lastIssue?.message ?? "", /not found/i);
});
