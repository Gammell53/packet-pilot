const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const workflowPath = path.resolve(__dirname, "../../.github/workflows/build.yml");
const packagePath = path.resolve(__dirname, "../../package.json");

function workflowText() {
  return fs.readFileSync(workflowPath, "utf8");
}

test("DMG update metadata is disabled because stapling mutates the final image", () => {
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  assert.equal(packageJson.build?.dmg?.writeUpdateInfo, false);
});

test("Apple notarization credentials are not persisted across workflow steps", () => {
  const workflow = workflowText();
  assert.doesNotMatch(workflow, /GITHUB_ENV/);

  const cleanupTraps = workflow.match(/trap 'rm -f "\$APPLE_API_KEY"' EXIT/g) ?? [];
  assert.equal(cleanupTraps.length, 2);

  const buildIndex = workflow.indexOf("Build Electron app (macOS)");
  const corpusIndex = workflow.indexOf("Download packaged smoke capture");
  const trustIndex = workflow.indexOf("Verify macOS signature and notarization");
  assert.ok(buildIndex >= 0 && corpusIndex > buildIndex && trustIndex > corpusIndex);
});
