import type { AiModelOption } from "./electron-api.js";

const SUPPORTED_OPENROUTER_CHAT_MODELS: AiModelOption[] = [
  {
    id: "anthropic/claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
    description: "Default reasoning model",
  },
  {
    id: "anthropic/claude-opus-4.6",
    name: "Claude Opus 4.6",
    description: "Highest-depth Anthropic option",
  },
  {
    id: "google/gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro",
    description: "Shown only when its ZDR route is active",
  },
  {
    id: "google/gemini-3.1-flash-lite-preview",
    name: "Gemini 3.1 Flash Lite",
    description: "Fast Gemini 3.1 option",
  },
  {
    id: "google/gemini-3-flash-preview",
    name: "Gemini 3 Flash",
    description: "Mapped from the requested Gemini 3.0 Flash",
  },
  {
    id: "openai/gpt-5.4",
    name: "GPT-5.4",
    description: "OpenAI flagship model",
  },
];

const SUPPORTED_OPENROUTER_CHAT_MODEL_MAP = new Map(
  SUPPORTED_OPENROUTER_CHAT_MODELS.map((entry) => [entry.id, entry] as const),
);
const FALLBACK_VISIBLE_MODEL_IDS = [
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-opus-4.6",
  "google/gemini-3.1-flash-lite-preview",
  "google/gemini-3-flash-preview",
  "openai/gpt-5.4",
] as const;

export const DEFAULT_OPENROUTER_MODEL = SUPPORTED_OPENROUTER_CHAT_MODELS[0]?.id ?? "anthropic/claude-sonnet-4.6";

const OPENROUTER_MODEL_ID_PATTERN = /^[a-z0-9][\w.-]*\/[a-z0-9][\w.:-]*$/i;

export function getSupportedOpenRouterModels(): AiModelOption[] {
  return SUPPORTED_OPENROUTER_CHAT_MODELS.map((entry) => ({ ...entry }));
}

export function getFallbackOpenRouterModels(): AiModelOption[] {
  return FALLBACK_VISIBLE_MODEL_IDS
    .map((modelId) => SUPPORTED_OPENROUTER_CHAT_MODEL_MAP.get(modelId))
    .filter((entry): entry is AiModelOption => Boolean(entry))
    .map((entry) => ({ ...entry }));
}

export function isPlausibleOpenRouterModelId(model: string | null | undefined): model is string {
  const trimmed = model?.trim() || "";
  return OPENROUTER_MODEL_ID_PATTERN.test(trimmed);
}

export function isSupportedOpenRouterModelId(model: string | null | undefined): model is string {
  const trimmed = model?.trim() || "";
  return SUPPORTED_OPENROUTER_CHAT_MODEL_MAP.has(trimmed);
}

export function normalizeOpenRouterModelId(model: string | null | undefined): string {
  const trimmed = model?.trim() || "";
  return isSupportedOpenRouterModelId(trimmed) ? trimmed : DEFAULT_OPENROUTER_MODEL;
}

export function mergeAvailableModels(models: AiModelOption[]): AiModelOption[] {
  const deduped = new Map<string, AiModelOption>();

  for (const model of models) {
    if (isSupportedOpenRouterModelId(model.id) && !deduped.has(model.id)) {
      deduped.set(model.id, { ...model });
    }
  }

  return SUPPORTED_OPENROUTER_CHAT_MODELS
    .map((entry) => deduped.get(entry.id))
    .filter((entry): entry is AiModelOption => Boolean(entry));
}

export function buildSupportedOpenRouterModel(
  modelId: string,
  overrides: Partial<AiModelOption> = {},
): AiModelOption | null {
  const base = SUPPORTED_OPENROUTER_CHAT_MODEL_MAP.get(modelId);
  if (!base) {
    return null;
  }

  return {
    ...base,
    ...overrides,
  };
}

export function getOpenRouterModelDisplayName(model: string | null | undefined): string {
  const trimmed = model?.trim() || "";
  return SUPPORTED_OPENROUTER_CHAT_MODEL_MAP.get(trimmed)?.name ?? trimmed;
}
