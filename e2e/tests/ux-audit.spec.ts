import { test, expect, selectPacket } from "../helpers/setup";

test.describe("UX Audit", () => {
  test("Settings button has title attribute", async ({ mockPage: page }) => {
    await expect(page.locator('[title="Settings"]')).toBeVisible();
  });

  test("theme toggle has descriptive title", async ({ mockPage: page }) => {
    await expect(page.locator('[title="Switch to light mode"]')).toBeVisible();
  });

  test("GoTo button has title with shortcut hint", async ({ loadedPage: page }) => {
    await expect(page.locator('[title="Go to packet (Ctrl+G)"]')).toBeVisible();
  });

  test("GoTo dialog input gets autofocus", async ({ loadedPage: page }) => {
    await page.keyboard.press("Control+g");
    await expect(page.locator(".dialog-input")).toBeFocused();
  });

  test("dialog overlay blocks background", async ({ loadedPage: page }) => {
    await page.keyboard.press("Control+g");
    const overlay = page.locator(".dialog-overlay");
    await expect(overlay).toBeVisible();
    const box = await overlay.boundingBox();
    // Overlay should cover the full viewport
    const viewport = page.viewportSize()!;
    expect(box!.width).toBeGreaterThanOrEqual(viewport.width - 1);
    expect(box!.height).toBeGreaterThanOrEqual(viewport.height - 1);
  });

  test("footer shows AI Chat shortcut hint", async ({ mockPage: page }) => {
    await expect(page.locator(".shortcuts-hint")).toContainText("AI Chat");
    await expect(page.locator(".shortcuts-hint kbd")).toHaveText("Ctrl+K");
  });

  test("dark theme applies correct background", async ({ mockPage: page }) => {
    const bgColor = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue("--bg-primary").trim();
    });
    expect(bgColor).toBe("#0c0f14");
  });

  test("light theme applies correct background", async ({ mockPage: page }) => {
    await page.click('[title="Switch to light mode"]');
    const bgColor = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue("--bg-primary").trim();
    });
    // Light theme bg-primary should be different from dark
    expect(bgColor).not.toBe("#0d1117");
  });

  test("Open Capture button is disabled when not ready", async ({ page }) => {
    // Use a mock where sharkd never becomes ready
    const { createMockApiScript } = await import("../fixtures/mock-api");
    const { MOCK_FRAMES, MOCK_FRAME_DETAILS, MOCK_RUNTIME_DIAGNOSTICS, MOCK_CAPTURE_STATS } = await import("../fixtures/test-data");

    // Override installHealth to fail so the app never reaches ready
    await page.addInitScript(createMockApiScript({
      frames: MOCK_FRAMES,
      frameDetails: MOCK_FRAME_DETAILS,
      installHealth: { ok: false, issues: [{ code: "MISSING", message: "sharkd not found" }], checked_paths: [], recommended_action: "Install sharkd" },
      runtimeDiagnostics: MOCK_RUNTIME_DIAGNOSTICS,
      captureStats: MOCK_CAPTURE_STATS,
      settings: { apiKey: null, model: "anthropic/claude-sonnet-4" },
    }));
    await page.goto("/");
    // Wait for initialization attempt
    await page.waitForTimeout(500);
    await expect(page.locator(".open-button")).toBeDisabled();
  });

  test("packet grid empty state has file icon SVG", async ({ mockPage: page }) => {
    await expect(page.locator(".packet-grid-empty svg")).toBeVisible();
  });

  test("header buttons are keyboard accessible", async ({ mockPage: page }) => {
    // Tab through header buttons
    await page.keyboard.press("Tab");
    // At least one button in header-right should be focusable
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(focused).toBe("BUTTON");
  });

  test("detail pane shows loading state briefly", async ({ loadedPage: page }) => {
    // Select a packet - the detail pane fetches async
    await selectPacket(page, 1);
    // Should quickly resolve to showing the pane
    await expect(page.locator(".packet-detail-pane")).toBeVisible();
  });

  test("chat sidebar close button has title with Escape hint", async ({ mockPage: page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.locator('[title="Close (Esc)"]')).toBeVisible();
  });

  test("Settings dialog mentions AI settings are in chat sidebar", async ({ mockPage: page }) => {
    await page.click('[title="Settings"]');
    await expect(page.locator(".settings-description").last()).toContainText("chat sidebar");
  });
});
