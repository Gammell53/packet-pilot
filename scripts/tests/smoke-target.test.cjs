const test = require("node:test");
const assert = require("node:assert/strict");

const { defaultPackagedTarget, validateSmokeOutcome } = require("../run-electron-smoke.cjs");

test("packaged smoke target follows electron-builder's Apple Silicon directory", () => {
  assert.equal(
    defaultPackagedTarget({ platform: "darwin", arch: "arm64" }),
    "dist/mac-arm64/PacketPilot.app/Contents/MacOS/PacketPilot",
  );
});

test("packaged smoke target keeps the Intel macOS directory", () => {
  assert.equal(
    defaultPackagedTarget({ platform: "darwin", arch: "x64" }),
    "dist/mac/PacketPilot.app/Contents/MacOS/PacketPilot",
  );
});

test("smoke outcome requires a zero child exit code", () => {
  assert.throws(
    () => validateSmokeOutcome({ result: { ok: true }, exitCode: 1, timedOut: false }),
    /exited with code 1/i,
  );
});

test("smoke outcome rejects a timed-out process even if it wrote success", () => {
  assert.throws(
    () => validateSmokeOutcome({ result: { ok: true }, exitCode: 0, timedOut: true }),
    /timed out/i,
  );
});

test("smoke outcome accepts a successful payload and zero exit", () => {
  assert.doesNotThrow(() =>
    validateSmokeOutcome({ result: { ok: true }, exitCode: 0, timedOut: false }),
  );
});
