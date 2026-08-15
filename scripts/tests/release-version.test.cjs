const assert = require("node:assert/strict");
const test = require("node:test");

const { validateReleaseVersion } = require("../verify-release-version.cjs");

test("accepts a tag that matches the package version", () => {
  assert.doesNotThrow(() => validateReleaseVersion("v0.3.0", "0.3.0"));
});

test("rejects a mismatched release tag", () => {
  assert.throws(
    () => validateReleaseVersion("v0.3.0", "0.2.0"),
    /does not match package version/i,
  );
});

test("rejects a malformed release tag", () => {
  assert.throws(() => validateReleaseVersion("0.3.0", "0.3.0"), /must be v0.3.0/i);
});
