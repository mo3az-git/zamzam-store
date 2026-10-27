import { expect, test } from "@playwright/test"

test("Arabic guest checkout reports localized required-field errors", async ({ page }) => {
  await page.goto("/checkout")
  await expect(page.locator("html")).toHaveAttribute("lang", "ar")
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
  await expect(page.locator(".lux-checkout-items li")).toHaveCount(1)
  await page.getByRole("button", { name: /التحقق من بيانات التوصيل/ }).click()

  for (const field of ["firstName", "lastName", "email", "phone", "governorate", "city", "address"]) {
    await expect(page.locator(`#${field}`)).toHaveAttribute("aria-invalid", "true")
    await expect(page.locator(`#${field}-error`)).toHaveAttribute("role", "alert")
  }
  await expect(page.locator("#governorate option")).toHaveCount(28) // Prompt plus all 27 governorates.
  await expect(page.getByRole("radio")).toHaveCount(0)
})

test("English guest details validate synthetically while unpriced shipping blocks purchase", async ({ page }) => {
  await page.goto("/en/checkout")
  await expect(page.locator("html")).toHaveAttribute("lang", "en")
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr")

  await page.locator("#firstName").fill("QA Guest")
  await page.locator("#lastName").fill("Synthetic")
  await page.locator("#email").fill("qa@example.test")
  await page.locator("#phone").fill("01012345678")
  await page.locator("#governorate").selectOption("cairo")
  await page.locator("#city").fill("Cairo")
  await page.locator("#address").fill("Synthetic test address")
  await page.getByRole("button", { name: /Validate Delivery Details/ }).click()

  await expect(page.getByRole("status").filter({ hasText: "Delivery Details Validated" })).toBeVisible()
  await expect(page.locator(".lux-shipping-amount")).toHaveCount(0)
  await expect(page.locator(".lux-pending-badge")).toHaveText("Rate unconfigured for governorate")
  await expect(page.locator(".lux-readiness-card")).toContainText("Official shipping quote is unavailable")
  await expect(page.locator(".lux-checkout-submit")).toHaveText(/Validate Delivery Details/)
  await expect(page.getByRole("radio")).toHaveCount(0)
})
