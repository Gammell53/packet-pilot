const test = require("node:test");
const assert = require("node:assert/strict");

const { getSystemBinaryCandidates } = require(
  "../../.electron/electron/services/sharkd-service.cjs",
);

test("macOS sharkd discovery includes app bundles, Homebrew, and PATH", () => {
  assert.equal(typeof getSystemBinaryCandidates, "function");

  const candidates = getSystemBinaryCandidates({
    platform: "darwin",
    homeDir: "/Users/tester",
    pathValue: "/custom/bin:/opt/homebrew/bin:/custom/bin",
    overridePath: " /chosen/sharkd ",
  });

  assert.deepEqual(candidates, [
    "/chosen/sharkd",
    "/custom/bin/sharkd",
    "/opt/homebrew/bin/sharkd",
    "/Users/tester/Applications/Wireshark.app/Contents/MacOS/sharkd",
    "/Applications/Wireshark.app/Contents/MacOS/sharkd",
    "/usr/local/bin/sharkd",
    "/usr/bin/sharkd",
  ]);
});

test("Windows sharkd discovery preserves installed Wireshark paths", () => {
  const candidates = getSystemBinaryCandidates({
    platform: "win32",
    homeDir: "C:\\Users\\tester",
    pathValue: "C:\\Tools;C:\\Other",
    overridePath: "",
  });

  assert.deepEqual(candidates, [
    "C:\\Tools\\sharkd.exe",
    "C:\\Other\\sharkd.exe",
    "C:\\Program Files\\Wireshark\\sharkd.exe",
    "C:\\Program Files (x86)\\Wireshark\\sharkd.exe",
  ]);
});
