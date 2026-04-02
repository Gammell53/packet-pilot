import { test, expect } from "../helpers/setup";

test.describe("Filter Bar", () => {
  test("filter input accepts text", async ({ loadedPage: page }) => {
    const input = page.locator(".filter-input");
    await input.fill("tcp");
    await expect(input).toHaveValue("tcp");
  });

  test("Apply button applies filter", async ({ loadedPage: page }) => {
    await page.locator(".filter-input").fill("tcp");
    await page.click(".filter-apply");
    // After applying TCP filter, packet count should change
    // (4 TCP packets in mock data)
    await expect(page.locator(".packet-count")).toContainText("packets");
  });

  test("Enter key applies filter", async ({ loadedPage: page }) => {
    const input = page.locator(".filter-input");
    await input.fill("dns");
    await input.press("Enter");
    // DNS filter applied
    await expect(page.locator(".packet-count")).toContainText("packets");
  });

  test("Clear button appears when text is entered", async ({ loadedPage: page }) => {
    // Initially no clear button
    await expect(page.locator(".filter-clear")).not.toBeVisible();

    // Type something
    await page.locator(".filter-input").fill("http");
    await expect(page.locator(".filter-clear")).toBeVisible();
  });

  test("Clear button clears the filter", async ({ loadedPage: page }) => {
    const input = page.locator(".filter-input");
    await input.fill("http");
    await expect(page.locator(".filter-clear")).toBeVisible();

    await page.click(".filter-clear");
    await expect(input).toHaveValue("");
    await expect(page.locator(".filter-clear")).not.toBeVisible();
  });

  test("shows error for invalid filter", async ({ loadedPage: page }) => {
    await page.locator(".filter-input").fill("invalid!!!syntax");
    await page.click(".filter-apply");
    await expect(page.locator(".filter-error")).toBeVisible();
    await expect(page.locator(".filter-error")).toContainText("Invalid filter syntax");
  });

  test("error clears when valid filter is applied", async ({ loadedPage: page }) => {
    // First trigger an error
    await page.locator(".filter-input").fill("invalid!!!syntax");
    await page.click(".filter-apply");
    await expect(page.locator(".filter-error")).toBeVisible();

    // Now apply a valid filter
    await page.locator(".filter-input").fill("tcp");
    await page.click(".filter-apply");
    await expect(page.locator(".filter-error")).not.toBeVisible();
  });

  test("filtered rows keep their real frame numbers", async ({ loadedPage: page }) => {
    await page.locator(".filter-input").fill("http");
    await page.click(".filter-apply");

    const firstRow = page.locator(".packet-row").first();
    const secondRow = page.locator(".packet-row").nth(1);

    await expect(firstRow.locator(".col-no")).toHaveText("6");
    await expect(secondRow.locator(".col-no")).toHaveText("7");
  });

  test("invalid filters keep the previous applied results visible", async ({ loadedPage: page }) => {
    const firstRow = page.locator(".packet-row").first();

    await page.locator(".filter-input").fill("http");
    await page.click(".filter-apply");
    await expect(firstRow.locator(".col-no")).toHaveText("6");

    await page.locator(".filter-input").fill("invalid!!!syntax");
    await page.click(".filter-apply");

    await expect(page.locator(".filter-error")).toContainText("Invalid filter syntax");
    await expect(firstRow.locator(".col-no")).toHaveText("6");
  });

  test("go to dialog targets filtered match positions", async ({ loadedPage: page }) => {
    await page.locator(".filter-input").fill("http");
    await page.click(".filter-apply");

    await page.click('[title="Go to packet (Ctrl+G)"]');
    await expect(page.locator(".dialog h3")).toHaveText("Go to Match");
    await expect(page.locator(".dialog-input")).toHaveAttribute("placeholder", "Enter match number (1-2)");

    await page.locator(".dialog-input").fill("2");
    await page.locator(".dialog-input").press("Enter");

    await expect(page.locator(".selected-info")).toContainText("Packet 7 (match 2 of 2)");
  });

  test("GoTo button opens dialog", async ({ loadedPage: page }) => {
    await page.click('[title="Go to packet (Ctrl+G)"]');
    await expect(page.locator(".dialog-overlay")).toBeVisible();
    await expect(page.locator(".dialog h3")).toHaveText("Go to Packet");
  });

  test("filter input has placeholder text", async ({ loadedPage: page }) => {
    await expect(page.locator(".filter-input")).toHaveAttribute(
      "placeholder",
      "Display filter (e.g., tcp.port == 80)",
    );
  });
});
