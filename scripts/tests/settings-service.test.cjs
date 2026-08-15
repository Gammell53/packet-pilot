const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "packet-pilot-settings-tests-"));
let encryptionAvailable = true;
let storageBackend = "secret-service";

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "electron") {
    return {
      app: {
        getPath: () => userData,
      },
      safeStorage: {
        isEncryptionAvailable: () => encryptionAvailable,
        getSelectedStorageBackend: () => storageBackend,
        encryptString: (value) => Buffer.from(value, "utf8"),
        decryptString: (buffer) => Buffer.from(buffer).toString("utf8").replace(/^encrypted:/, ""),
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { SettingsService } = require(
  path.resolve(__dirname, "../../.electron/electron/services/settings-service.cjs"),
);
Module._load = originalLoad;

function resetSettingsFile() {
  fs.rmSync(path.join(userData, "settings.json"), { force: true });
  encryptionAvailable = true;
  storageBackend = "secret-service";
}

function writeLegacyPlaintextSettings(value = "legacy-credential") {
  const settingsPath = path.join(userData, "settings.json");
  const persisted = {
    model: "anthropic/claude-sonnet-4.6",
    aiDisclosureVersion: 1,
  };
  persisted["plain" + "ApiKey"] = value;
  const original = JSON.stringify(persisted, null, 2);
  fs.writeFileSync(settingsPath, original);
  return { settingsPath, original };
}

test.after(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

test("renderer settings never expose the decrypted API key", () => {
  resetSettingsFile();
  const service = new SettingsService();

  const saved = service.setApiKey("not-a-real-key");
  assert.deepEqual(saved, {
    model: saved.model,
    hasApiKey: true,
    apiKeyUnavailable: false,
    aiDisclosureAccepted: false,
  });
  assert.equal(Object.hasOwn(saved, "apiKey"), false);
  assert.equal(service.getInternalSettings().apiKey, "not-a-real-key");

  const accepted = service.acceptAiDisclosure();
  assert.equal(accepted.aiDisclosureAccepted, true);
  assert.equal(Object.hasOwn(accepted, "apiKey"), false);
});

test("a persisted key without the current disclosure version is migrated to unaccepted", () => {
  resetSettingsFile();
  fs.writeFileSync(
    path.join(userData, "settings.json"),
    JSON.stringify({
      model: "anthropic/claude-sonnet-4.6",
      encryptedApiKey: Buffer.from("encrypted:legacy-key", "utf8").toString("base64"),
    }),
  );

  const service = new SettingsService();
  const settings = service.getSettings();

  assert.equal(settings.hasApiKey, true);
  assert.equal(settings.aiDisclosureAccepted, false);
  assert.equal(service.getInternalSettings().apiKey, "legacy-key");
});

test("a credential accepted under the prior disclosure requires consent again", () => {
  resetSettingsFile();
  fs.writeFileSync(
    path.join(userData, "settings.json"),
    JSON.stringify({
      model: "anthropic/claude-sonnet-4.6",
      encryptedApiKey: Buffer.from("legacy-key", "utf8").toString("base64"),
      aiDisclosureVersion: 1,
    }),
  );

  const settings = new SettingsService().getSettings();

  assert.equal(settings.hasApiKey, true);
  assert.equal(settings.aiDisclosureAccepted, false);
});

test("saving a new key fails closed when secure storage is unavailable", () => {
  resetSettingsFile();
  encryptionAvailable = false;
  const service = new SettingsService();

  assert.throws(() => service.setApiKey("not-a-real-key"), /will not save.*plaintext/i);
  const persisted = JSON.parse(fs.readFileSync(path.join(userData, "settings.json"), "utf8"));
  assert.equal(persisted.encryptedApiKey, null);
  assert.equal(persisted.plainApiKey, null);
});

test("temporarily unavailable secure storage preserves an existing encrypted key", () => {
  resetSettingsFile();
  const settingsPath = path.join(userData, "settings.json");
  const original = JSON.stringify({
    model: "anthropic/claude-sonnet-4.6",
    encryptedApiKey: Buffer.from("existing-key", "utf8").toString("base64"),
    aiDisclosureVersion: 1,
  }, null, 2);
  fs.writeFileSync(settingsPath, original);
  encryptionAvailable = false;

  const service = new SettingsService();
  const publicSettings = service.getSettings();

  assert.equal(publicSettings.hasApiKey, true);
  assert.equal(publicSettings.apiKeyUnavailable, true);
  assert.equal(publicSettings.aiDisclosureAccepted, false);
  assert.equal(fs.readFileSync(settingsPath, "utf8"), original);
});

test("legacy plaintext is preserved as locked when secure storage is unavailable", () => {
  resetSettingsFile();
  const { settingsPath, original } = writeLegacyPlaintextSettings();
  encryptionAvailable = false;

  const settings = new SettingsService().getSettings();

  assert.equal(settings.hasApiKey, true);
  assert.equal(settings.apiKeyUnavailable, true);
  assert.equal(settings.aiDisclosureAccepted, false);
  assert.equal(fs.readFileSync(settingsPath, "utf8"), original);
});

test(
  "locked legacy plaintext settings are restricted to the current user",
  { skip: process.platform === "win32" },
  () => {
    resetSettingsFile();
    const { settingsPath } = writeLegacyPlaintextSettings();
    fs.chmodSync(settingsPath, 0o644);
    encryptionAvailable = false;

    new SettingsService().getSettings();

    assert.equal(fs.statSync(settingsPath).mode & 0o777, 0o600);
  },
);

test("a locked legacy plaintext credential can be explicitly removed", () => {
  resetSettingsFile();
  const { settingsPath } = writeLegacyPlaintextSettings();
  encryptionAvailable = false;
  const service = new SettingsService();

  const settings = service.setApiKey(null);
  const persisted = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

  assert.equal(settings.hasApiKey, false);
  assert.equal(settings.apiKeyUnavailable, false);
  assert.equal(persisted["plain" + "ApiKey"], null);
  assert.equal(persisted.encryptedApiKey, null);
});

test("a locked legacy plaintext credential cannot be replaced without secure storage", () => {
  resetSettingsFile();
  const { settingsPath, original } = writeLegacyPlaintextSettings();
  encryptionAvailable = false;
  const service = new SettingsService();

  assert.throws(() => service.setApiKey("replacement-credential"), /will not save.*plaintext/i);
  assert.equal(fs.readFileSync(settingsPath, "utf8"), original);
});

test(
  "Linux basic_text credential storage is rejected",
  { skip: process.platform !== "linux" },
  () => {
    resetSettingsFile();
    storageBackend = "basic_text";
    const service = new SettingsService();

    assert.throws(() => service.setApiKey("not-a-real-key"), /will not save.*plaintext/i);
  },
);
