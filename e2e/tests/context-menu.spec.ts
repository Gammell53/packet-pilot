import { test, expect } from "../helpers/setup";

test.describe("Context Menu", () => {
  test("right-click on packet shows context menu", async ({ loadedPage: page }) => {
    const firstRow = page.locator(".packet-row").first();
    await firstRow.click({ button: "right" });
    await expect(page.locator(".context-menu")).toBeVisible();
  });

  test("context menu shows correct items for TCP packet", async ({ loadedPage: page }) => {
    // Frame 1 is TCP, source 192.168.1.100, dest 10.0.0.1
    const firstRow = page.locator(".packet-row").first();
    await firstRow.click({ button: "right" });

    const menu = page.locator(".context-menu");
    await expect(menu.locator(".context-menu-label")).toHaveCount(5);
    await expect(menu.locator(".context-menu-label").nth(0)).toContainText("Apply as Filter: TCP");
    await expect(menu.locator(".context-menu-label").nth(1)).toContainText("Filter by Source: 192.168.1.100");
    await expect(menu.locator(".context-menu-label").nth(2)).toContainText("Filter by Destination: 10.0.0.1");
    await expect(menu.locator(".context-menu-label").nth(4)).toContainText("Copy Summary");
  });

  test("has a divider", async ({ loadedPage: page }) => {
    const firstRow = page.locator(".packet-row").first();
    await firstRow.click({ button: "right" });
    await expect(page.locator(".context-menu-divider")).toBeVisible();
  });

  test("clicking menu item closes menu", async ({ loadedPage: page }) => {
    const firstRow = page.locator(".packet-row").first();
    await firstRow.click({ button: "right" });
    await expect(page.locator(".context-menu")).toBeVisible();

    await page.locator('.context-menu-label:text("Copy Summary")').click();
    await expect(page.locator(".context-menu")).not.toBeVisible();
  });

  test("Escape closes context menu", async ({ loadedPage: page }) => {
    const firstRow = page.locator(".packet-row").first();
    await firstRow.click({ button: "right" });
    await expect(page.locator(".context-menu")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator(".context-menu")).not.toBeVisible();
  });

  test("clicking outside closes context menu", async ({ loadedPage: page }) => {
    const firstRow = page.locator(".packet-row").first();
    await firstRow.click({ button: "right" });
    await expect(page.locator(".context-menu")).toBeVisible();

    // Click on the header area
    await page.locator(".app-header").click();
    await expect(page.locator(".context-menu")).not.toBeVisible();
  });

  test("Apply as Filter sets filter input", async ({ loadedPage: page }) => {
    const firstRow = page.locator(".packet-row").first();
    await firstRow.click({ button: "right" });

    await page.locator('.context-menu-label:text("Apply as Filter: TCP")').click();
    // The filter input should be set to the lowercase protocol
    await expect(page.locator(".filter-input")).toHaveValue("tcp");
  });

  test("Filter by Source sets correct filter", async ({ loadedPage: page }) => {
    const firstRow = page.locator(".packet-row").first();
    await firstRow.click({ button: "right" });

    await page.locator('.context-menu-label:text("Filter by Source")').click();
    await expect(page.locator(".filter-input")).toHaveValue("ip.src == 192.168.1.100");
  });

  test("Filter by Destination sets correct filter", async ({ loadedPage: page }) => {
    const firstRow = page.locator(".packet-row").first();
    await firstRow.click({ button: "right" });

    await page.locator('.context-menu-label:text("Filter by Destination")').click();
    await expect(page.locator(".filter-input")).toHaveValue("ip.dst == 10.0.0.1");
  });
});
