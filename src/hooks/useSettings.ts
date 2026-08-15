import { useState, useEffect, useCallback, useRef } from "react";
import type { AiModelOption, AppSettings } from "../types";
import { getDefaultModel, getModels, mergeModels, normalizeModel } from "../constants/models";
import { desktop } from "../lib/desktop";

const DEFAULT_SETTINGS: AppSettings = {
  hasApiKey: false,
  apiKeyUnavailable: false,
  aiDisclosureAccepted: false,
  model: getDefaultModel(),
};

function normalizeSettings(stored: Partial<AppSettings>): AppSettings {
  return {
    hasApiKey: stored.hasApiKey === true,
    apiKeyUnavailable: stored.apiKeyUnavailable === true,
    aiDisclosureAccepted: stored.aiDisclosureAccepted === true,
    model: normalizeModel(stored.model),
  };
}

export function useSettings(
  { loadModelCatalog = false }: { loadModelCatalog?: boolean } = {},
) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [availableModels, setAvailableModels] = useState<AiModelOption[]>(getModels());
  const [isLoading, setIsLoading] = useState(true);
  const catalogLoadedRef = useRef(false);

  const refreshSettings = useCallback(async () => {
    try {
      const stored = await desktop.settings.get();
      setSettings(normalizeSettings(stored));

      if (loadModelCatalog && !catalogLoadedRef.current) {
        catalogLoadedRef.current = true;
        const models = await desktop.settings.getAvailableModels().catch((error) => {
          console.error("Failed to load OpenRouter model catalog:", error);
          return getModels();
        });
        setAvailableModels(mergeModels(models));
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
  }, [loadModelCatalog]);

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

  const acceptAiDisclosure = useCallback(async () => {
    const next = await desktop.settings.acceptAiDisclosure();
    setSettings(normalizeSettings(next));
  }, []);

  const updateModel = useCallback(async (model: string) => {
    const next = await desktop.settings.setModel(model);
    const normalizedSettings = normalizeSettings(next);
    setSettings(normalizedSettings);
    setAvailableModels((currentModels) => mergeModels(currentModels));
  }, []);

  const hasConfiguredAuth = settings.hasApiKey && settings.aiDisclosureAccepted;

  return {
    settings,
    availableModels,
    isLoading,
    hasConfiguredAuth,
    updateApiKey,
    acceptAiDisclosure,
    updateModel,
  };
}
