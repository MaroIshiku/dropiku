import { expect, test } from "@playwright/test";
import * as OTPAuth from "otpauth";

test("mobile setup, upload, share, theming, and desktop keyboard navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Set up Dropiku" })).toBeVisible();
  await page.getByLabel("Setup secret").fill("e2e-setup-secret-with-more-than-32-characters");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Connect your authenticator" })).toBeVisible();
  await page.getByText("Enter the secret manually").click();
  const secret = await page.locator("code.secret-value").textContent();
  expect(secret).toBeTruthy();
  const totp = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 10, period: 30, secret: OTPAuth.Secret.fromBase32(secret!) });
  const now = Date.now();
  await page.getByLabel("10-digit code").fill(totp.generate({ timestamp: now }));
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByRole("heading", { name: "Verify the next code" })).toBeVisible();
  await page.getByLabel("10-digit code").fill(totp.generate({ timestamp: now + 30_000 }));
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByRole("heading", { name: "Save recovery codes" })).toBeVisible();
  await page.getByLabel("I have saved the recovery codes in a safe place.").check();
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByRole("heading", { name: "Files", exact: true })).toBeVisible();

  await page.locator('input[type="file"]').first().setInputFiles({ name: "hello.txt", mimeType: "text/plain", buffer: Buffer.from("hello from Playwright") });
  await expect(page.getByText("hello.txt", { exact: true }).first()).toBeVisible();
  await page.locator(".file-card").getByRole("button", { name: "Share" }).click();
  await expect(page.getByRole("heading", { name: "Create download link" })).toBeVisible();
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByRole("heading", { name: "Share ready" })).toBeVisible();
  await expect(page.getByLabel("Capability link")).toHaveValue(/\/s\//u);
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Mint" }).click();
  await page.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "mint");
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  await page.getByRole("button", { name: "Close settings" }).click();

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole("navigation", { name: "Primary navigation" }).first()).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus-visible")).toBeVisible();
});
