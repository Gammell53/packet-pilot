import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AiModelOption, AppSettings } from "../../shared/electron-api";
import { DEFAULT_OPENROUTER_MODEL, normalizeOpenRouterModelId } from "../../shared/openrouter-models";
import { openRouterModelCatalogService } from "./openrouter-model-catalog-service.cjs";

const DEFAULT_SETTINGS: AppSettings = {
  model: DEFAULT_OPENROUTER_MODEL,
  apiKey: null,
};

interface PersistedSettings {
  model?: string;
  encryptedApiKey?: string | null;
  plainApiKey?: string | null;

  // Legacy multi-provider fields retained only so old settings files can be sanitized.
  provider?: string;
  authMethod?: string;
  encryptedOAuthAccessToken?: string | null;
  plainOAuthAccessToken?: string | null;
  encryptedOAuthRefreshToken?: string | null;
  plainOAuthRefreshToken?: string | null;
  oauthExpiresAt?: number | null;
  oauthAccountId?: string | null;
}

export class SettingsService {
  private readonly settingsPath = join(app.getPath("userData"), "settings.json");
  private cache: AppSettings | null = null;
  private persistedCache: PersistedSettings | null = null;

  getSettings(): AppSettings {
    if (this.cache) {
      return { ...this.cache };
    }

    const persisted = this.readPersistedSettings();
    const { settings, sanitized, changed } = this.normalizePersistedSettings(persisted);

    if (changed) {
      this.writePersisted(sanitized);
    } else {
      this.persistedCache = { ...sanitized };
    }

    this.cache = settings;
    return { ...settings };
  }

  setModel(model: string): AppSettings {
    const next: AppSettings = {
      ...this.getSettings(),
      model: this.normalizeModel(model),
    };

    this.writeSettings(next);
    return { ...next };
  }

  setApiKey(apiKey: string | null): AppSettings {
    const next: AppSettings = {
      ...this.getSettings(),
      apiKey: apiKey?.trim() || null,
    };

    this.writeSettings(next);
    return { ...next };
  }

  async getAvailableModels(): Promise<AiModelOption[]> {
    return openRouterModelCatalogService.getAvailableModels();
  }

  private readPersistedSettings(): PersistedSettings {
    if (this.persistedCache) {
      return { ...this.persistedCache };
    }

    if (!existsSync(this.settingsPath)) {
      return {};
    }

    try {
      const raw = readFileSync(this.settingsPath, "utf8");
      const parsed = JSON.parse(raw) as PersistedSettings;
      this.persistedCache = parsed;
      return { ...parsed };
    } catch {
      return {};
    }
  }

  private normalizePersistedSettings(
    persisted: PersistedSettings,
  ): { settings: AppSettings; sanitized: PersistedSettings; changed: boolean } {
    const hasLegacyMetadata =
      persisted.provider !== undefined ||
      persisted.authMethod !== undefined ||
      persisted.encryptedOAuthAccessToken !== undefined ||
      persisted.plainOAuthAccessToken !== undefined ||
      persisted.encryptedOAuthRefreshToken !== undefined ||
      persisted.plainOAuthRefreshToken !== undefined ||
      persisted.oauthExpiresAt !== undefined ||
      persisted.oauthAccountId !== undefined;

    const canReuseLegacyApiKey =
      !hasLegacyMetadata || (persisted.provider === "openrouter" && persisted.authMethod !== "oauth");

    const currentApiKey = this.readApiKey(persisted);
    const currentModel = persisted.model?.trim() || "";
    const settings: AppSettings = {
      model: this.normalizeModel(persisted.model),
      apiKey: canReuseLegacyApiKey ? currentApiKey : null,
    };

    const sanitized = this.buildPersistedSettings(settings);
    const changed = hasLegacyMetadata || settings.model !== currentModel || settings.apiKey !== currentApiKey;

    return { settings, sanitized, changed };
  }

  private normalizeModel(model: string | null | undefined): string {
    return normalizeOpenRouterModelId(model);
  }

  private readApiKey(persisted: PersistedSettings): string | null {
    if (persisted.encryptedApiKey) {
      try {
        const encrypted = Buffer.from(persisted.encryptedApiKey, "base64");
        if (safeStorage.isEncryptionAvailable()) {
          return safeStorage.decryptString(encrypted);
        }
      } catch {
        return null;
      }
    }

    return persisted.plainApiKey?.trim() || null;
  }

  private buildPersistedSettings(settings: AppSettings): PersistedSettings {
    const persisted: PersistedSettings = {
      model: settings.model,
      encryptedApiKey: null,
      plainApiKey: null,
    };

    if (settings.apiKey) {
      if (safeStorage.isEncryptionAvailable()) {
        persisted.encryptedApiKey = safeStorage.encryptString(settings.apiKey).toString("base64");
      } else {
        persisted.plainApiKey = settings.apiKey;
      }
    }

    return persisted;
  }

  private writeSettings(settings: AppSettings): void {
    const persisted = this.buildPersistedSettings(settings);
    this.writePersisted(persisted);
    this.cache = { ...settings };
  }

  private writePersisted(persisted: PersistedSettings): void {
    mkdirSync(dirname(this.settingsPath), { recursive: true });
    writeFileSync(this.settingsPath, JSON.stringify(persisted, null, 2));
    this.persistedCache = { ...persisted };
  }
}

export const settingsService = new SettingsService();
