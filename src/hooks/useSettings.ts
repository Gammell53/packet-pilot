import { useState, useEffect, useCallback } from "react";
import type { AiModelOption, AppSettings } from "../types";
import { getDefaultModel, getModels, mergeModels, normalizeModel } from "../constants/models";
import { desktop } from "../lib/desktop";

const DEFAULT_SETTINGS: AppSettings = {
  apiKey: null,
  model: getDefaultModel(),
};

function normalizeSettings(stored: Partial<AppSettings>): AppSettings {
  return {
    apiKey: stored.apiKey ?? null,
    model: normalizeModel(stored.model),
  };
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [availableModels, setAvailableModels] = useState<AiModelOption[]>(getModels());
  const [isLoading, setIsLoading] = useState(true);

  const refreshSettings = useCallback(async () => {
    try {
      const [stored, models] = await Promise.all([
        desktop.settings.get(),
        desktop.settings.getAvailableModels().catch((error) => {
          console.error("Failed to load OpenRouter model catalog:", error);
          return getModels();
        }),
      ]);
      const normalizedSettings = normalizeSettings(stored);
      setSettings(normalizedSettings);
      setAvailableModels(mergeModels(models));
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      try {
        await refreshSettings();
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, [refreshSettings]);

  const updateApiKey = useCallback(async (apiKey: string | null) => {
    const next = await desktop.settings.setApiKey(apiKey);
    setSettings(normalizeSettings(next));
  }, []);

  const updateModel = useCallback(async (model: string) => {
    const next = await desktop.settings.setModel(model);
    const normalizedSettings = normalizeSettings(next);
    setSettings(normalizedSettings);
    setAvailableModels((currentModels) => mergeModels(currentModels));
  }, []);

  const hasConfiguredAuth = Boolean(settings.apiKey);

  return {
    settings,
    availableModels,
    isLoading,
    hasConfiguredAuth,
    updateApiKey,
    updateModel,
  };
}
