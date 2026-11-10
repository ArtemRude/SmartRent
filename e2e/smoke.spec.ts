import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("landing page opens registration", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /Недвижимость\.\s+Арендаторы\.\s+Всё связано\./ }),
  ).toBeVisible();
  await expect(page.getByText("SmartRent", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Поддержка" }).first().click();
  await expect(page.getByRole("heading", { name: "Остался вопрос? Напишите нам" })).toBeVisible();

  await page.getByRole("link", { name: "Попробовать" }).click();

  await expect(page).toHaveURL(/\/auth(?:\?|$)/);
  const submitButton = page.getByRole("button", { name: "Создать аккаунт" });
  await expect(submitButton).toBeVisible();
  await expect(submitButton).toBeEnabled();
});

test("protected pages redirect an anonymous user to sign in", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const path of [
    "/dashboard",
    "/properties",
    "/portfolio",
    "/objects/b2000000-0000-0000-0000-000000000001",
    "/tenants",
    "/agreements",
    "/support",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/auth(?:\?|$)/);
    await expect(page.getByRole("button", { name: "Войти" })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("landing links to the public catalog without horizontal overflow on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.getByRole("link", { name: "Каталог аренды", exact: true }).click();
  await expect(page).toHaveURL(/\/catalog/);
  await expect(
    page.getByRole("heading", { name: "Найдите место для жизни и работы", exact: true }),
  ).toBeVisible();
});

test("landing screenshots and the public guide work on a narrow screen", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/#workflow");

  const workflow = page.locator("#workflow");
  const screenshots = workflow.getByRole("img");
  await expect(screenshots).toHaveCount(3);
  for (const screenshot of await screenshots.all()) {
    await screenshot.scrollIntoViewIfNeeded();
    await expect
      .poll(() => screenshot.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
  }

  const [imageTab] = await Promise.all([
    context.waitForEvent("page"),
    workflow.getByRole("link", { name: /раздел «объекты».*открыть снимок/i }).click(),
  ]);
  await expect(imageTab).toHaveURL(/\/guide\/object\.webp$/);
  await imageTab.close();

  await page.getByRole("link", { name: "Открыть руководство" }).click();
  await expect(page).toHaveURL(/\/guide$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Руководство");
  await expect(page.getByRole("heading", { name: "Собственнику" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Арендатору" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Управляющему" })).toBeVisible();
  await page.getByRole("link", { name: "Управляющему" }).click();
  await expect(page).toHaveURL(/\/guide#manager$/);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});
