import { useState, useEffect, useCallback } from "react";
import { LazyStore } from "@tauri-apps/plugin-store";

export interface AppSettings {
  apiKey: string | null;
  model: string;
}

const DEFAULT_MODEL = "google/gemini-3-flash-preview";

// Models that are valid for the sidecar
const VALID_MODELS = [
  "google/gemini-3-flash-preview",
];

function getValidModel(model: string | null | undefined): string {
  if (!model) return DEFAULT_MODEL;
  return VALID_MODELS.includes(model) ? model : DEFAULT_MODEL;
}

const DEFAULT_SETTINGS: AppSettings = {
  apiKey: null,
  model: DEFAULT_MODEL,
};

// Use LazyStore for settings persistence
const store = new LazyStore("settings.json", {
  autoSave: true,
  defaults: {
    apiKey: null,
    model: "google/gemini-3-flash-preview",
  },
});

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);

  // Load settings on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        // Try new key first, fall back to old key for migration
        let apiKey = await store.get<string>("apiKey");
        if (!apiKey) {
          apiKey = await store.get<string>("openrouterApiKey");
        }
        const storedModel = await store.get<string>("model") ?? await store.get<string>("aiModel");
        const validatedModel = getValidModel(storedModel);

        // If stored model was invalid, save the corrected one
        if (storedModel && storedModel !== validatedModel) {
          console.log(`Migrating invalid model "${storedModel}" to "${validatedModel}"`);
          await store.set("model", validatedModel);
        }

        setSettings({
          apiKey: apiKey ?? null,
          model: validatedModel,
        });
      } catch (error) {
        console.error("Failed to load settings:", error);
      } finally {
        setIsLoading(false);
      }
    }

    loadSettings();
  }, []);

  const updateApiKey = useCallback(async (apiKey: string | null) => {
    try {
      if (apiKey) {
        await store.set("apiKey", apiKey);
      } else {
        await store.delete("apiKey");
      }
      setSettings((prev) => ({ ...prev, apiKey }));
    } catch (error) {
      console.error("Failed to save API key:", error);
      throw error;
    }
  }, []);

  const updateModel = useCallback(async (model: string) => {
    try {
      const validatedModel = getValidModel(model);
      await store.set("model", validatedModel);
      setSettings((prev) => ({ ...prev, model: validatedModel }));
    } catch (error) {
      console.error("Failed to save model:", error);
      throw error;
    }
  }, []);

  return {
    settings,
    isLoading,
    hasApiKey: Boolean(settings.apiKey),
    updateApiKey,
    updateModel,
  };
}
