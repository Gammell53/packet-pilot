import { test as base, expect, type Page } from "@playwright/test";
import { createMockApiScript, type MockApiOptions } from "../fixtures/mock-api";
import {
  MOCK_FRAMES,
  MOCK_FRAME_DETAILS,
  MOCK_SETTINGS,
  MOCK_SETTINGS_WITH_KEY,
  MOCK_INSTALL_HEALTH,
  MOCK_RUNTIME_DIAGNOSTICS,
  MOCK_CAPTURE_STATS,
} from "../fixtures/test-data";

/** Default mock options with no file loaded and no API key */
const DEFAULT_MOCK_OPTIONS: MockApiOptions = {
  frames: MOCK_FRAMES,
  frameDetails: MOCK_FRAME_DETAILS,
  settings: MOCK_SETTINGS,
  installHealth: MOCK_INSTALL_HEALTH,
  runtimeDiagnostics: MOCK_RUNTIME_DIAGNOSTICS,
  captureStats: MOCK_CAPTURE_STATS,
  aiRunning: false,
};

/** Mock options with an API key configured */
const AUTH_MOCK_OPTIONS: MockApiOptions = {
  ...DEFAULT_MOCK_OPTIONS,
  settings: MOCK_SETTINGS_WITH_KEY,
};

/**
 * Extended test fixtures for Packet Pilot e2e tests.
 *
 * - `mockPage`: Injects mock API, navigates to /, waits for app to be ready (sharkd init complete)
 * - `loadedPage`: Same as mockPage + simulates a file open so the grid is populated
 * - `authedPage`: mockPage with an API key pre-configured
 */
export const test = base.extend<{
  mockPage: Page;
  loadedPage: Page;
  authedPage: Page;
}>({
  mockPage: async ({ page }, use) => {
    await page.addInitScript(createMockApiScript(DEFAULT_MOCK_OPTIONS));
    await page.goto("/");
    // Wait for sharkd initialization (200ms delay + getInstallHealth + getStatus)
    await page.waitForSelector(".loading-overlay", { state: "detached", timeout: 5000 }).catch(() => {});
    await use(page);
  },

  loadedPage: async ({ page }, use) => {
    await page.addInitScript(createMockApiScript(DEFAULT_MOCK_OPTIONS));
    await page.goto("/");
    await page.waitForSelector(".loading-overlay", { state: "detached", timeout: 5000 }).catch(() => {});
    // Open a file
    await page.click(".open-button");
    // Wait for the packet grid to render rows
    await page.waitForSelector(".packet-row", { timeout: 5000 });
    await use(page);
  },

  authedPage: async ({ page }, use) => {
    await page.addInitScript(createMockApiScript(AUTH_MOCK_OPTIONS));
    await page.goto("/");
    await page.waitForSelector(".loading-overlay", { state: "detached", timeout: 5000 }).catch(() => {});
    await use(page);
  },
});

/** Helper: open a file on a mockPage that doesn't have one loaded yet */
export async function simulateFileOpen(page: Page): Promise<void> {
  await page.click(".open-button");
  await page.waitForSelector(".packet-row", { timeout: 5000 });
}

/** Helper: click a packet row by its frame number text */
export async function selectPacket(page: Page, frameNumber: number): Promise<void> {
  const row = page.locator(`.packet-row:has(.col-no:text-is("${frameNumber.toLocaleString()}"))`);
  await row.click();
}

/** Helper: wait for the app footer to show a specific selected packet */
export async function expectSelectedPacket(page: Page, frameNumber: number, total: number): Promise<void> {
  await expect(page.locator(".selected-info")).toContainText(
    `Packet ${frameNumber.toLocaleString()} of ${total.toLocaleString()}`,
  );
}

export { expect };
