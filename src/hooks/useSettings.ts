import { useState, useEffect, useCallback } from "react";
import { LazyStore } from "@tauri-apps/plugin-store";

export interface AppSettings {
  apiKey: string | null;
  model: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  apiKey: null,
  model: "xiaomi/mimo-v2-flash:free",
};

// Use LazyStore for settings persistence
const store = new LazyStore("settings.json", {
  autoSave: true,
  defaults: {
    apiKey: null,
    model: "xiaomi/mimo-v2-flash:free",
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
        const model = await store.get<string>("model") ?? await store.get<string>("aiModel");

        setSettings({
          apiKey: apiKey ?? null,
          model: model ?? DEFAULT_SETTINGS.model,
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
      await store.set("model", model);
      setSettings((prev) => ({ ...prev, model }));
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
