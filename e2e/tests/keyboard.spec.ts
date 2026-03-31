import { test, expect, selectPacket, expectSelectedPacket } from "../helpers/setup";

test.describe("Keyboard Shortcuts", () => {
  test("Ctrl+K opens chat sidebar", async ({ mockPage: page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.locator(".chat-sidebar")).toBeVisible();
  });

  test("Ctrl+G opens GoTo dialog (requires loaded file)", async ({ loadedPage: page }) => {
    await page.keyboard.press("Control+g");
    await expect(page.locator(".dialog-overlay")).toBeVisible();
    await expect(page.locator(".dialog h3")).toHaveText("Go to Packet");
  });

  test("Escape closes chat sidebar", async ({ mockPage: page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.locator(".chat-sidebar")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator(".chat-sidebar")).not.toBeVisible();
  });

  test("Escape closes GoTo dialog", async ({ loadedPage: page }) => {
    await page.keyboard.press("Control+g");
    await expect(page.locator(".dialog-overlay")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator(".dialog-overlay")).not.toBeVisible();
  });

  test("ArrowDown selects next packet", async ({ loadedPage: page }) => {
    await selectPacket(page, 1);
    await expectSelectedPacket(page, 1, 10);

    await page.keyboard.press("ArrowDown");
    await expectSelectedPacket(page, 2, 10);
  });

  test("ArrowUp selects previous packet", async ({ loadedPage: page }) => {
    await selectPacket(page, 3);
    await page.keyboard.press("ArrowUp");
    await expectSelectedPacket(page, 2, 10);
  });

  test("j key moves selection down", async ({ loadedPage: page }) => {
    await selectPacket(page, 1);
    await page.keyboard.press("j");
    await expectSelectedPacket(page, 2, 10);
  });

  test("k key moves selection up", async ({ loadedPage: page }) => {
    await selectPacket(page, 3);
    await page.keyboard.press("k");
    await expectSelectedPacket(page, 2, 10);
  });

  test("Home goes to first packet", async ({ loadedPage: page }) => {
    await selectPacket(page, 5);
    await page.keyboard.press("Home");
    await expectSelectedPacket(page, 1, 10);
  });

  test("End goes to last packet", async ({ loadedPage: page }) => {
    await selectPacket(page, 1);
    await page.keyboard.press("End");
    await expectSelectedPacket(page, 10, 10);
  });

  test("shortcuts are ignored when typing in filter input", async ({ loadedPage: page }) => {
    await selectPacket(page, 1);
    const filterInput = page.locator(".filter-input");
    await filterInput.focus();
    await filterInput.pressSequentially("j");

    // The filter input should have 'j', not navigated
    await expect(filterInput).toHaveValue("j");
    // Still on packet 1
    await expectSelectedPacket(page, 1, 10);
  });
});
