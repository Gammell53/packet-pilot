import { test, expect, selectPacket, expectSelectedPacket } from "../helpers/setup";

test.describe("Packet Grid", () => {
  test("renders column headers", async ({ loadedPage: page }) => {
    const header = page.locator(".packet-grid-header");
    await expect(header).toBeVisible();
    await expect(header.locator(".col-no")).toContainText("No.");
    await expect(header.locator(".col-time")).toContainText("Time");
    await expect(header.locator(".col-source")).toContainText("Source");
    await expect(header.locator(".col-dest")).toContainText("Destination");
    await expect(header.locator(".col-proto")).toContainText("Protocol");
    await expect(header.locator(".col-len")).toContainText("Length");
    await expect(header.locator(".col-info")).toContainText("Info");
  });

  test("displays packet rows after file load", async ({ loadedPage: page }) => {
    const rows = page.locator(".packet-row");
    await expect(rows.first()).toBeVisible();
    // Should have multiple rows visible
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test("first row shows frame number 1", async ({ loadedPage: page }) => {
    const firstRow = page.locator(".packet-row").first();
    await expect(firstRow.locator(".col-no")).toContainText("1");
  });

  test("rows show protocol badges", async ({ loadedPage: page }) => {
    const badge = page.locator(".protocol-badge").first();
    await expect(badge).toBeVisible();
  });

  test("clicking a row selects it", async ({ loadedPage: page }) => {
    await selectPacket(page, 1);
    const row = page.locator(".packet-row.selected");
    await expect(row).toBeVisible();
    await expectSelectedPacket(page, 1, 10);
  });

  test("clicking a different row changes selection", async ({ loadedPage: page }) => {
    await selectPacket(page, 1);
    await expect(page.locator(".packet-row.selected")).toHaveCount(1);

    await selectPacket(page, 3);
    // Only one row should be selected
    await expect(page.locator(".packet-row.selected")).toHaveCount(1);
    await expectSelectedPacket(page, 3, 10);
  });

  test("footer shows packet count", async ({ loadedPage: page }) => {
    await expect(page.locator(".packet-count")).toContainText("10 packets");
  });

  test("column resize changes width", async ({ loadedPage: page }) => {
    const resizer = page.locator(".packet-grid-header .col-time .resizer");
    const timeCol = page.locator(".packet-grid-header .col-time");
    const initialBox = await timeCol.boundingBox();

    // Drag resizer 50px to the right
    const resizerBox = await resizer.boundingBox();
    if (resizerBox && initialBox) {
      await page.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + resizerBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(resizerBox.x + 50, resizerBox.y + resizerBox.height / 2, { steps: 5 });
      await page.mouse.up();

      const newBox = await timeCol.boundingBox();
      expect(newBox!.width).toBeGreaterThan(initialBox.width);
    }
  });
});
