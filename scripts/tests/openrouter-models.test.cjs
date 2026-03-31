const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

async function loadModelsModule() {
  return import(pathToFileURL(path.resolve(__dirname, "../../.electron/shared/openrouter-models.js")).href);
}

test("fallback model list stays pinned to the curated supported ZDR set", async () => {
  const { getFallbackOpenRouterModels } = await loadModelsModule();

  const fallbackIds = getFallbackOpenRouterModels().map((model) => model.id);

  assert.deepEqual(fallbackIds, [
    "anthropic/claude-sonnet-4.6",
    "anthropic/claude-opus-4.6",
    "google/gemini-3.1-flash-lite-preview",
    "google/gemini-3-flash-preview",
    "openai/gpt-5.4",
  ]);
});

test("supported model normalization keeps requested ids and rejects unsupported ones", async () => {
  const { DEFAULT_OPENROUTER_MODEL, normalizeOpenRouterModelId } = await loadModelsModule();

  assert.equal(normalizeOpenRouterModelId("google/gemini-3.1-pro-preview"), "google/gemini-3.1-pro-preview");
  assert.equal(normalizeOpenRouterModelId("openai/gpt-5.4-pro"), DEFAULT_OPENROUTER_MODEL);
  assert.equal(normalizeOpenRouterModelId(""), DEFAULT_OPENROUTER_MODEL);
});

test("available model merging preserves curated order and display names", async () => {
  const { getOpenRouterModelDisplayName, mergeAvailableModels } = await loadModelsModule();

  const merged = mergeAvailableModels([
    { id: "openai/gpt-5.4", name: "GPT-5.4", description: "flagship" },
    { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6", description: "default" },
    { id: "unsupported/model", name: "Unsupported", description: "ignored" },
  ]);

  assert.deepEqual(merged.map((model) => model.id), [
    "anthropic/claude-sonnet-4.6",
    "openai/gpt-5.4",
  ]);
  assert.equal(getOpenRouterModelDisplayName("google/gemini-3-flash-preview"), "Gemini 3 Flash");
});
