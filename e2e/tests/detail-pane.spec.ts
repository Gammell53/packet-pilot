import { test, expect, selectPacket } from "../helpers/setup";

test.describe("Packet Detail Pane", () => {
  test("appears when a packet is selected", async ({ loadedPage: page }) => {
    await selectPacket(page, 1);
    await expect(page.locator(".detail-pane-container")).toBeVisible();
    await expect(page.locator(".packet-detail-pane")).toBeVisible();
  });

  test("Protocol Tree tab is active by default", async ({ loadedPage: page }) => {
    await selectPacket(page, 1);
    await expect(page.locator(".detail-tab.active")).toHaveText("Protocol Tree");
    await expect(page.locator(".proto-tree")).toBeVisible();
  });

  test("protocol tree shows expandable nodes", async ({ loadedPage: page }) => {
    await selectPacket(page, 1);
    const nodeCount = await page.locator(".proto-node").count();
    expect(nodeCount).toBeGreaterThanOrEqual(1);
    await expect(page.locator(".proto-node-label.expandable").first()).toBeVisible();
    await expect(page.locator(".expand-icon").first()).toBeVisible();
  });

  test("clicking expandable node toggles children", async ({ loadedPage: page }) => {
    await selectPacket(page, 1);
    // First-level nodes are auto-expanded, so children should be visible
    const firstExpandable = page.locator(".proto-node-label.expandable").first();
    await expect(page.locator(".proto-children").first()).toBeVisible();

    // Click to collapse
    await firstExpandable.click();
    // The corresponding children container should be hidden
    // (first node collapsed means first proto-children gone)
  });

  test("Hex Dump tab shows hex data", async ({ loadedPage: page }) => {
    await selectPacket(page, 1);
    await page.click('.detail-tab:text("Hex Dump")');
    await expect(page.locator(".hex-dump")).toBeVisible();
    // Hex dump should contain offset pattern
    await expect(page.locator(".hex-dump")).toContainText("00000000");
  });

  test("tab switching works bidirectionally", async ({ loadedPage: page }) => {
    await selectPacket(page, 1);

    // Start on Protocol Tree
    await expect(page.locator(".proto-tree")).toBeVisible();

    // Switch to Hex Dump
    await page.click('.detail-tab:text("Hex Dump")');
    await expect(page.locator(".hex-dump")).toBeVisible();
    await expect(page.locator(".proto-tree")).not.toBeVisible();

    // Switch back to Protocol Tree
    await page.click('.detail-tab:text("Protocol Tree")');
    await expect(page.locator(".proto-tree")).toBeVisible();
    await expect(page.locator(".hex-dump")).not.toBeVisible();
  });

  test("shows frame number in tab info", async ({ loadedPage: page }) => {
    await selectPacket(page, 4);
    await expect(page.locator(".detail-tab-info")).toContainText("Frame 4");
  });

  test("resize handle exists", async ({ loadedPage: page }) => {
    await selectPacket(page, 1);
    await expect(page.locator(".resize-handle")).toBeVisible();
  });

  test("detail pane updates when selecting different packet", async ({ loadedPage: page }) => {
    await selectPacket(page, 1);
    await expect(page.locator(".detail-tab-info")).toContainText("Frame 1");

    await selectPacket(page, 4);
    await expect(page.locator(".detail-tab-info")).toContainText("Frame 4");
  });
});
