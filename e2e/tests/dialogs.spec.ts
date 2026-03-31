import { test, expect, expectSelectedPacket } from "../helpers/setup";

test.describe("GoToPacketDialog", () => {
  test("opens with Ctrl+G", async ({ loadedPage: page }) => {
    await page.keyboard.press("Control+g");
    await expect(page.locator(".dialog-overlay")).toBeVisible();
    await expect(page.locator(".dialog h3")).toHaveText("Go to Packet");
  });

  test("closes with Escape", async ({ loadedPage: page }) => {
    await page.keyboard.press("Control+g");
    await expect(page.locator(".dialog-overlay")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator(".dialog-overlay")).not.toBeVisible();
  });

  test("closes with Cancel button", async ({ loadedPage: page }) => {
    await page.keyboard.press("Control+g");
    await page.click(".dialog-button.secondary");
    await expect(page.locator(".dialog-overlay")).not.toBeVisible();
  });

  test("closes on overlay click", async ({ loadedPage: page }) => {
    await page.keyboard.press("Control+g");
    // Click the overlay (outside the dialog box)
    await page.locator(".dialog-overlay").click({ position: { x: 10, y: 10 } });
    await expect(page.locator(".dialog-overlay")).not.toBeVisible();
  });

  test("accepts input and navigates to packet", async ({ loadedPage: page }) => {
    await page.keyboard.press("Control+g");
    await page.locator(".dialog-input").fill("5");
    await page.click(".dialog-button.primary");

    // Dialog should close
    await expect(page.locator(".dialog-overlay")).not.toBeVisible();
    // Packet 5 should be selected
    await expectSelectedPacket(page, 5, 10);
  });

  test("Enter key navigates to packet", async ({ loadedPage: page }) => {
    await page.keyboard.press("Control+g");
    await page.locator(".dialog-input").fill("3");
    await page.keyboard.press("Enter");

    await expect(page.locator(".dialog-overlay")).not.toBeVisible();
    await expectSelectedPacket(page, 3, 10);
  });

  test("input has placeholder with total frames", async ({ loadedPage: page }) => {
    await page.keyboard.press("Control+g");
    const placeholder = await page.locator(".dialog-input").getAttribute("placeholder");
    expect(placeholder).toContain("10");
  });

  test("input gets autofocus", async ({ loadedPage: page }) => {
    await page.keyboard.press("Control+g");
    await expect(page.locator(".dialog-input")).toBeFocused();
  });
});

test.describe("SettingsDialog", () => {
  test("opens via header Settings button", async ({ mockPage: page }) => {
    await page.click('[title="Settings"]');
    await expect(page.locator(".settings-overlay")).toBeVisible();
    await expect(page.locator(".settings-dialog")).toBeVisible();
    await expect(page.locator(".settings-header h2")).toHaveText("Settings");
  });

  test("has diagnostics section", async ({ mockPage: page }) => {
    await page.click('[title="Settings"]');
    await expect(page.locator(".settings-section h3")).toContainText("Diagnostics");
  });

  test("has Copy Diagnostics button", async ({ mockPage: page }) => {
    await page.click('[title="Settings"]');
    await expect(page.locator(".btn-secondary:text('Copy Diagnostics')")).toBeVisible();
  });

  test("closes via close button", async ({ mockPage: page }) => {
    await page.click('[title="Settings"]');
    await page.click(".close-btn");
    await expect(page.locator(".settings-overlay")).not.toBeVisible();
  });

  test("closes via overlay click", async ({ mockPage: page }) => {
    await page.click('[title="Settings"]');
    await page.locator(".settings-overlay").click({ position: { x: 10, y: 10 } });
    await expect(page.locator(".settings-overlay")).not.toBeVisible();
  });

  test("closes via Close button in footer", async ({ mockPage: page }) => {
    await page.click('[title="Settings"]');
    await page.click(".settings-footer .btn-secondary");
    await expect(page.locator(".settings-overlay")).not.toBeVisible();
  });
});
