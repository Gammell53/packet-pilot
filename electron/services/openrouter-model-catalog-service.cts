import type { AiModelOption } from "../../shared/electron-api";
import {
  buildSupportedOpenRouterModel,
  getFallbackOpenRouterModels,
  isSupportedOpenRouterModelId,
  mergeAvailableModels,
} from "../../shared/openrouter-models";

const MODELS_API_URL = "https://openrouter.ai/api/v1/models";
const ZDR_ENDPOINTS_API_URL = "https://openrouter.ai/api/v1/endpoints/zdr";
const CACHE_TTL_MS = 15 * 60 * 1000;

interface OpenRouterModelRecord {
  id: string;
  name: string;
  created?: number;
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  supported_parameters?: string[];
}

interface OpenRouterModelsResponse {
  data?: OpenRouterModelRecord[];
}

interface OpenRouterZdrEndpoint {
  model_id: string;
  status?: number;
  supported_parameters?: string[];
}

interface OpenRouterZdrResponse {
  data?: OpenRouterZdrEndpoint[];
}

function supportsToolUse(parameters: string[] | undefined): boolean {
  return Boolean(parameters?.includes("tools") && parameters.includes("tool_choice"));
}

function supportsTextInputAndOutput(model: OpenRouterModelRecord): boolean {
  const inputModalities = model.architecture?.input_modalities ?? [];
  const outputModalities = model.architecture?.output_modalities ?? [];
  return inputModalities.includes("text") && outputModalities.includes("text");
}

function formatContextLength(contextLength: number | undefined): string | null {
  if (!contextLength || !Number.isFinite(contextLength)) {
    return null;
  }

  if (contextLength >= 1_000_000) {
    return `${(contextLength / 1_000_000).toFixed(1).replace(/\.0$/, "")}M context`;
  }

  if (contextLength >= 1_000) {
    return `${Math.round(contextLength / 1_000)}K context`;
  }

  return `${contextLength} context`;
}

function toModelOption(model: OpenRouterModelRecord): AiModelOption {
  const contextLabel = formatContextLength(model.context_length);
  return buildSupportedOpenRouterModel(model.id, {
    description: [contextLabel, "ZDR-compatible"].filter(Boolean).join(" · "),
  }) ?? {
    id: model.id,
    name: model.name,
    description: [contextLabel, "ZDR-compatible"].filter(Boolean).join(" · "),
  };
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`OpenRouter catalog request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

export class OpenRouterModelCatalogService {
  private cache = getFallbackOpenRouterModels();
  private cacheExpiresAt = 0;
  private inflight: Promise<AiModelOption[]> | null = null;

  async getAvailableModels(forceRefresh = false): Promise<AiModelOption[]> {
    if (!forceRefresh && this.cache.length > 0 && this.cacheExpiresAt > Date.now()) {
      return this.cache.map((entry) => ({ ...entry }));
    }

    if (this.inflight) {
      const cached = await this.inflight;
      return cached.map((entry) => ({ ...entry }));
    }

    this.inflight = this.fetchAvailableModels()
      .then((models) => {
        if (models.length > 0) {
          this.cache = models;
          this.cacheExpiresAt = Date.now() + CACHE_TTL_MS;
          return models;
        }

        return this.cache;
      })
      .catch(() => this.cache)
      .finally(() => {
        this.inflight = null;
      });

    const models = await this.inflight;
    return models.map((entry) => ({ ...entry }));
  }

  private async fetchAvailableModels(): Promise<AiModelOption[]> {
    const [modelsResponse, zdrResponse] = await Promise.all([
      readJson<OpenRouterModelsResponse>(MODELS_API_URL),
      readJson<OpenRouterZdrResponse>(ZDR_ENDPOINTS_API_URL),
    ]);

    const zdrModelIds = new Set(
      (zdrResponse.data ?? [])
        .filter((endpoint) => endpoint.status === 0 && supportsToolUse(endpoint.supported_parameters))
        .map((endpoint) => endpoint.model_id),
    );

    const models = (modelsResponse.data ?? [])
      .filter((model) => isSupportedOpenRouterModelId(model.id))
      .filter((model) => zdrModelIds.has(model.id))
      .filter((model) => supportsTextInputAndOutput(model))
      .filter((model) => supportsToolUse(model.supported_parameters))
      .map(toModelOption);

    return models.length > 0 ? mergeAvailableModels(models) : getFallbackOpenRouterModels();
  }
}

export const openRouterModelCatalogService = new OpenRouterModelCatalogService();
