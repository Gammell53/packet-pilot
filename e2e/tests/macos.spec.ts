import { test, expect } from "@playwright/test";
import { createMockApiScript } from "../fixtures/mock-api";
import { MOCK_RUNTIME_DIAGNOSTICS } from "../fixtures/test-data";

test.describe("macOS guidance", () => {
  test.skip(process.platform !== "darwin", "macOS-specific copy");

  test("missing sharkd directs the user to install Wireshark", async ({ page }) => {
    await page.addInitScript(
      createMockApiScript({
        runtimeDiagnostics: MOCK_RUNTIME_DIAGNOSTICS,
        installHealth: {
          ok: false,
          issues: [{ code: "missing_binary", message: "sharkd binary not found" }],
          checked_paths: [],
          recommended_action: "repair",
        },
      }),
    );

    await page.goto("/");

    await expect(page.locator("body")).toContainText("Install the latest Wireshark app, then retry");
    await expect(page.locator("body")).not.toContainText("Windows installer");
  });

  test("Retry Check starts sharkd after Wireshark becomes available", async ({ page }) => {
    await page.addInitScript(
      createMockApiScript({
        runtimeDiagnostics: MOCK_RUNTIME_DIAGNOSTICS,
        installHealth: {
          ok: false,
          issues: [{ code: "missing_binary", message: "sharkd binary not found" }],
          checked_paths: [],
          recommended_action: "repair",
        },
      }),
    );

    await page.goto("/");
    await expect(page.getByRole("button", { name: "Retry Check" })).toBeVisible();

    await page.evaluate(() => {
      (window as unknown as { __mockSetInstallHealth: (health: object) => void })
        .__mockSetInstallHealth({
          ok: true,
          issues: [],
          checked_paths: ["/Applications/Wireshark.app/Contents/MacOS/sharkd"],
          recommended_action: "none",
        });
    });
    await page.getByRole("button", { name: "Retry Check" }).click();

    await expect(page.locator(".loading-overlay")).toBeHidden();
    await expect(page.locator(".open-button")).toBeEnabled();
    await expect(page.locator("footer")).toContainText("Ready");
  });
});
