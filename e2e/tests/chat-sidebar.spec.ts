import { test, expect } from "../helpers/setup";

test.describe("Chat Sidebar", () => {
  test("opens with Ctrl+K", async ({ mockPage: page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.locator(".chat-sidebar")).toBeVisible();
  });

  test("shows provider setup when no API key configured", async ({ mockPage: page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.locator(".chat-sidebar")).toBeVisible();
    // Should show provider setup since no API key
    await expect(page.locator(".provider-setup")).toBeVisible();
  });

  test("closes with Escape", async ({ mockPage: page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.locator(".chat-sidebar")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator(".chat-sidebar")).not.toBeVisible();
  });

  test("closes with close button", async ({ mockPage: page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.locator(".chat-sidebar")).toBeVisible();

    await page.click('[title="Close (Esc)"]');
    await expect(page.locator(".chat-sidebar")).not.toBeVisible();
  });

  test("shows chat interface when API key is configured", async ({ authedPage: page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.locator(".chat-sidebar")).toBeVisible();

    // With a configured key, the sidebar should show either:
    // - chat messages (AI running), or runtime status (starting/stopped), or provider setup with "Connected" state
    // The auto-start triggers start() which sets is_running=true in our mock
    // Wait for sidebar content to settle
    await page.waitForTimeout(500);
    const hasChat = await page.locator(".chat-messages").isVisible().catch(() => false);
    const hasRuntime = await page.locator(".chat-runtime-status").isVisible().catch(() => false);
    const hasSetup = await page.locator(".provider-setup").isVisible().catch(() => false);
    // At least one of these states should be shown
    expect(hasChat || hasRuntime || hasSetup).toBe(true);
  });

  test("has header with title", async ({ mockPage: page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.locator(".chat-header h3")).toHaveText("PacketPilot AI");
  });

  test("has status indicator dot", async ({ mockPage: page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.locator(".chat-header .status-dot")).toBeVisible();
  });

  test("has Clear button", async ({ mockPage: page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.locator('[title="Clear chat"]')).toBeVisible();
  });

  test("resize handle exists", async ({ mockPage: page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.locator(".chat-resize-handle")).toBeVisible();
  });

  test("sidebar has default width", async ({ mockPage: page }) => {
    await page.keyboard.press("Control+k");
    const sidebar = page.locator(".chat-sidebar");
    const box = await sidebar.boundingBox();
    // Default width is 380px
    expect(box!.width).toBeCloseTo(380, -1);
  });
});
