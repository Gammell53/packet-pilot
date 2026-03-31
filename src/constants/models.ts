import type { AiModelOption } from "../types";
import {
  DEFAULT_OPENROUTER_MODEL,
  getOpenRouterModelDisplayName,
  getFallbackOpenRouterModels,
  mergeAvailableModels,
  normalizeOpenRouterModelId,
} from "../../shared/openrouter-models";

export function getModels(): AiModelOption[] {
  return getFallbackOpenRouterModels();
}

export function getDefaultModel(): string {
  return DEFAULT_OPENROUTER_MODEL;
}

export function normalizeModel(model: string | null | undefined): string {
  return normalizeOpenRouterModelId(model);
}

export function mergeModels(models: AiModelOption[]): AiModelOption[] {
  return mergeAvailableModels(models);
}

export function getModelDisplayName(model: string | null | undefined): string {
  return getOpenRouterModelDisplayName(model);
}
