import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("landing page opens registration", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Аренда без таблиц, чатов и потерянных договоров" }),
  ).toBeVisible();
  await expect(page.getByText("Умная Аренда", { exact: true }).first()).toBeVisible();

  await page.getByRole("link", { name: "Начать бесплатно" }).click();

  await expect(page).toHaveURL(/\/auth(?:\?|$)/);
  await expect(page.getByRole("button", { name: "Создать аккаунт" })).toBeVisible();
});

test("protected pages redirect an anonymous user to sign in", async ({ page }) => {
  for (const path of ["/dashboard", "/properties", "/tenants", "/agreements"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/auth(?:\?|$)/);
    await expect(page.getByRole("button", { name: "Войти" })).toBeVisible();
  }
});
