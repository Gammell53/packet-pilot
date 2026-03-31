import { test, expect } from "../helpers/setup";

test.describe("App Layout", () => {
  test("renders the app shell with header, main area, and footer", async ({ mockPage: page }) => {
    await expect(page.locator(".app")).toBeVisible();
    await expect(page.locator(".app-header")).toBeVisible();
    await expect(page.locator(".app-main")).toBeVisible();
    await expect(page.locator(".app-footer")).toBeVisible();
  });

  test("header displays app title", async ({ mockPage: page }) => {
    await expect(page.locator(".app-title")).toContainText("PacketPilot");
  });

  test("shows empty state when no file is loaded", async ({ mockPage: page }) => {
    await expect(page.locator(".packet-grid-empty")).toBeVisible();
    await expect(page.locator(".empty-state h3")).toHaveText("No capture loaded");
    await expect(page.locator(".empty-state p").first()).toContainText("Open a PCAP file");
  });

  test("shows keyboard shortcut hint in empty state", async ({ mockPage: page }) => {
    await expect(page.locator(".shortcut-hint kbd").first()).toHaveText("Ctrl");
    await expect(page.locator(".shortcut-hint kbd").last()).toHaveText("O");
  });

  test("FilterBar is hidden when no file is loaded", async ({ mockPage: page }) => {
    await expect(page.locator(".filter-bar")).not.toBeVisible();
  });

  test("FilterBar appears after loading a file", async ({ loadedPage: page }) => {
    await expect(page.locator(".filter-bar")).toBeVisible();
  });

  test("dark theme is the default", async ({ mockPage: page }) => {
    const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    expect(theme).toBe("dark");
  });

  test("theme toggle switches to light mode", async ({ mockPage: page }) => {
    await page.click('[title="Switch to light mode"]');
    const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    expect(theme).toBe("light");
    await expect(page.locator('[title="Switch to dark mode"]')).toBeVisible();
  });

  test("header shows filename and duration after file load", async ({ loadedPage: page }) => {
    await expect(page.locator(".file-name")).toBeVisible();
    await expect(page.locator(".file-duration")).toBeVisible();
  });

  test("Open Capture button exists and is enabled when ready", async ({ mockPage: page }) => {
    await expect(page.locator(".open-button")).toBeEnabled();
    await expect(page.locator(".open-button")).toContainText("Open Capture");
  });

  test("footer shows Ready status", async ({ mockPage: page }) => {
    await expect(page.locator(".status-indicator")).toContainText("Ready");
    await expect(page.locator(".status-dot.ready")).toBeVisible();
  });

  test("footer shows AI Chat shortcut hint", async ({ mockPage: page }) => {
    await expect(page.locator(".shortcuts-hint")).toContainText("AI Chat");
    await expect(page.locator(".shortcuts-hint kbd")).toHaveText("Ctrl+K");
  });
});
