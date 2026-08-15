import { app, safeStorage } from "electron";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AiModelOption, AppSettings } from "../../shared/electron-api";
import { DEFAULT_OPENROUTER_MODEL, normalizeOpenRouterModelId } from "../../shared/openrouter-models";
import { openRouterModelCatalogService } from "./openrouter-model-catalog-service.cjs";

export const CURRENT_AI_DISCLOSURE_VERSION = 2;

export interface InternalAppSettings {
  model: string;
  apiKey: string | null;
  apiKeyUnavailable: boolean;
  aiDisclosureAccepted: boolean;
}

const DEFAULT_SETTINGS: InternalAppSettings = {
  model: DEFAULT_OPENROUTER_MODEL,
  apiKey: null,
  apiKeyUnavailable: false,
  aiDisclosureAccepted: false,
};

interface PersistedSettings {
  model?: string;
  encryptedApiKey?: string | null;
  plainApiKey?: string | null;
  aiDisclosureVersion?: number | null;

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
  private cache: InternalAppSettings | null = null;
  private persistedCache: PersistedSettings | null = null;

  getSettings(): AppSettings {
    return this.toPublicSettings(this.getInternalSettings());
  }

  getInternalSettings(): InternalAppSettings {
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
    const next: InternalAppSettings = {
      ...this.getInternalSettings(),
      model: this.normalizeModel(model),
    };

    this.writeSettings(next);
    return this.toPublicSettings(next);
  }

  setApiKey(apiKey: string | null): AppSettings {
    const normalizedApiKey = apiKey?.trim() || null;
    const next: InternalAppSettings = {
      ...this.getInternalSettings(),
      apiKey: normalizedApiKey,
      // A new, removed, or replaced credential must never inherit locked state or earlier consent.
      apiKeyUnavailable: false,
      aiDisclosureAccepted: false,
    };

    this.writeSettings(next);
    return this.toPublicSettings(next);
  }

  acceptAiDisclosure(): AppSettings {
    const current = this.getInternalSettings();
    if (!current.apiKey) {
      if (current.apiKeyUnavailable) {
        throw new Error(
          "The saved OpenRouter key is locked because secure credential storage is unavailable. Reopen PacketPilot after unlocking OS credential storage, replace the key, or disconnect it.",
        );
      }
      throw new Error("Add an OpenRouter API key before accepting the AI privacy disclosure.");
    }

    const next: InternalAppSettings = {
      ...current,
      aiDisclosureAccepted: true,
    };
    this.writeSettings(next);
    return this.toPublicSettings(next);
  }

  async getAvailableModels(): Promise<AiModelOption[]> {
    return openRouterModelCatalogService.getAvailableModels();
  }

  private toPublicSettings(settings: InternalAppSettings): AppSettings {
    return {
      model: settings.model,
      hasApiKey: Boolean(settings.apiKey) || settings.apiKeyUnavailable,
      apiKeyUnavailable: settings.apiKeyUnavailable,
      aiDisclosureAccepted: settings.aiDisclosureAccepted,
    };
  }

  private readPersistedSettings(): PersistedSettings {
    if (this.persistedCache) {
      return { ...this.persistedCache };
    }

    if (!existsSync(this.settingsPath)) {
      return {};
    }

    this.restrictSettingsFilePermissions();

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
  ): { settings: InternalAppSettings; sanitized: PersistedSettings; changed: boolean } {
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

    const currentCredential = this.readApiKey(persisted);
    const currentApiKey = currentCredential.value;
    const apiKeyUnavailable = canReuseLegacyApiKey && currentCredential.unavailable;
    const currentModel = persisted.model?.trim() || "";
    const acceptedCurrentDisclosure =
      Boolean(currentApiKey) && persisted.aiDisclosureVersion === CURRENT_AI_DISCLOSURE_VERSION;
    const settings: InternalAppSettings = {
      model: this.normalizeModel(persisted.model),
      apiKey: canReuseLegacyApiKey ? currentApiKey : null,
      apiKeyUnavailable,
      aiDisclosureAccepted: canReuseLegacyApiKey && acceptedCurrentDisclosure,    };

    if (settings.apiKeyUnavailable) {
      return { settings, sanitized: { ...persisted }, changed: false };
    }

    const sanitized = this.buildPersistedSettings(settings);
    const changed =
      hasLegacyMetadata ||
      settings.model !== currentModel ||
      settings.apiKey !== currentApiKey ||
      persisted.aiDisclosureVersion !== sanitized.aiDisclosureVersion ||
      Boolean(persisted.plainApiKey);

    return { settings, sanitized, changed };
  }

  private normalizeModel(model: string | null | undefined): string {
    return normalizeOpenRouterModelId(model);
  }

  private isCredentialStorageSecure(): boolean {
    if (!safeStorage.isEncryptionAvailable()) {
      return false;
    }
    return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text";
  }

  private readApiKey(persisted: PersistedSettings): { value: string | null; unavailable: boolean } {
    if (persisted.encryptedApiKey) {
      if (!this.isCredentialStorageSecure()) {
        return { value: null, unavailable: true };
      }
      try {
        const encrypted = Buffer.from(persisted.encryptedApiKey, "base64");
        return { value: safeStorage.decryptString(encrypted), unavailable: false };
      } catch {
        return { value: null, unavailable: true };
      }
    }

    const plaintextValue = persisted.plainApiKey?.trim() || null;
    if (plaintextValue && !this.isCredentialStorageSecure()) {
      return { value: null, unavailable: true };
    }

    return { value: plaintextValue, unavailable: false };
  }

  private buildPersistedSettings(settings: InternalAppSettings): PersistedSettings {
    if (settings.apiKeyUnavailable) {
      throw new Error(
        "The saved OpenRouter key is locked because secure credential storage is unavailable. No settings were changed.",
      );
    }

    const persisted: PersistedSettings = {
      model: settings.model,
      encryptedApiKey: null,
      plainApiKey: null,
      aiDisclosureVersion:
        settings.apiKey && settings.aiDisclosureAccepted ? CURRENT_AI_DISCLOSURE_VERSION : null,
    };

    if (settings.apiKey) {
      if (!this.isCredentialStorageSecure()) {
        throw new Error(
          "Secure credential storage is unavailable. PacketPilot will not save an OpenRouter key in plaintext.",
        );
      }
      persisted.encryptedApiKey = safeStorage.encryptString(settings.apiKey).toString("base64");
    }

    return persisted;
  }

  private writeSettings(settings: InternalAppSettings): void {
    const persisted = this.buildPersistedSettings(settings);
    this.writePersisted(persisted);
    this.cache = { ...settings };
  }

  private writePersisted(persisted: PersistedSettings): void {
    mkdirSync(dirname(this.settingsPath), { recursive: true });
    writeFileSync(this.settingsPath, JSON.stringify(persisted, null, 2), { mode: 0o600 });
    this.restrictSettingsFilePermissions();
    this.persistedCache = { ...persisted };
  }

  private restrictSettingsFilePermissions(): void {
    try {
      chmodSync(this.settingsPath, 0o600);
    } catch {
      // Best effort on platforms that do not expose POSIX file modes.
    }
  }
}

export const settingsService = new SettingsService();
