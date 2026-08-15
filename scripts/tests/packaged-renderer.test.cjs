const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const builtIndex = path.resolve(__dirname, "../../dist/renderer/index.html");
const compiledMain = path.resolve(__dirname, "../../.electron/electron/main.cjs");

test("packaged renderer uses relative asset URLs for Electron file loading", () => {
  assert.equal(fs.existsSync(builtIndex), true, `Missing built renderer entry at ${builtIndex}`);

  const html = fs.readFileSync(builtIndex, "utf8");
  assert.match(html, /(?:src|href)="\.\/assets\//);
  assert.doesNotMatch(html, /(?:src|href)="\/assets\//);
});

test("renderer process sandbox is enabled", () => {
  assert.equal(fs.existsSync(compiledMain), true, `Missing compiled Electron main at ${compiledMain}`);
  const source = fs.readFileSync(compiledMain, "utf8");
  assert.match(source, /sandbox:\s*true/);
  assert.doesNotMatch(source, /sandbox:\s*false/);
});

test("packaged renderer CSP blocks remote image loads", () => {
  assert.equal(fs.existsSync(builtIndex), true, `Missing built renderer entry at ${builtIndex}`);

  const html = fs.readFileSync(builtIndex, "utf8");
  assert.match(html, /Content-Security-Policy/i);
  assert.match(html, /img-src\s+'self'\s+data:/i);
  assert.doesNotMatch(html, /img-src[^;]*https:/i);
});
