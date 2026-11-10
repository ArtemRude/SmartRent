import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

function uniqueEmail(role: "owner" | "tenant"): string {
  return `e2e-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

async function fillCredentials(page: Page, email: string) {
  await page.getByLabel("Пароль").fill("E2e-password-123!");
  const emailInput = page.getByLabel("Email");
  if (await emailInput.isEditable()) {
    await emailInput.fill(email);
  }
}

test.beforeEach(async ({ page }) => {
  const supabaseUrl = process.env["E2E_SUPABASE_URL"] ?? "";
  test.skip(
    !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/.test(supabaseUrl),
    "The full auth flow requires a local Supabase stack.",
  );
  await page.context().clearCookies();
});

test("owner registration persists the session and opens protected pages", async ({ page }) => {
  const email = uniqueEmail("owner");

  await page.goto("/auth?mode=signup");
  const submitButton = page.getByRole("button", { name: "Создать аккаунт" });
  await expect(submitButton).toBeEnabled();
  await page.getByLabel("Имя").fill("E2E Собственник");
  await page.getByLabel("Телефон").fill("+7 900 000-00-01");
  await fillCredentials(page, email);
  await submitButton.click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Мой кабинет" })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Мой кабинет" })).toBeVisible();

  await page.getByRole("link", { name: "Объекты", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/properties");
  await expect(page.getByRole("heading", { name: "Объекты" })).toBeVisible();

  await page.goto("/auth");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/properties");
  await expect(page).toHaveURL(/\/auth(?:\?|$)/);
});

test("tenant registration opens the tenant cabinet and blocks owner pages", async ({ page }) => {
  const email = uniqueEmail("tenant");
  const search = new URLSearchParams({
    mode: "signup",
    role: "tenant",
    email,
    name: "E2E Арендатор",
  });

  await page.goto(`/auth?${search.toString()}`);
  await expect(page.getByText("Вас пригласили как арендатора")).toBeVisible();
  const submitButton = page.getByRole("button", { name: "Создать аккаунт" });
  await expect(submitButton).toBeEnabled();
  await expect(page.getByLabel("Email")).toHaveValue(email);
  await expect(page.getByLabel("Email")).not.toBeEditable();
  await fillCredentials(page, email);
  await submitButton.click();

  await expect(page).toHaveURL(/\/cabinet$/);
  await expect(page.getByRole("heading", { name: "Мой кабинет" })).toBeVisible();

  await page.goto("/properties");
  await expect(page).toHaveURL(/\/cabinet$/);
});

test("other-account tabs keep their own sign-in and sign-out", async ({ page, context }) => {
  const tenantEmail = uniqueEmail("tenant");
  const ownerEmail = uniqueEmail("owner");

  await page.goto(`/auth?mode=signup&role=tenant&email=${tenantEmail}&name=E2E+Арендатор`);
  await expect(page.getByRole("button", { name: "Создать аккаунт" })).toBeEnabled();
  await page.getByLabel("Телефон").fill("+7 900 000-00-02");
  await fillCredentials(page, tenantEmail);
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(page).toHaveURL(/\/cabinet$/);
  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/auth?mode=signup");
  await expect(page.getByRole("button", { name: "Создать аккаунт" })).toBeEnabled();
  await page.getByLabel("Имя").fill("E2E Собственник");
  await page.getByLabel("Телефон").fill("+7 900 000-00-01");
  await fillCredentials(page, ownerEmail);
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const regularTab = await context.newPage();
  await regularTab.goto("/dashboard");
  await expect(regularTab.getByText("E2E Собственник", { exact: true })).toBeVisible();

  async function signInInOtherTab(email: string) {
    const [tab] = await Promise.all([
      context.waitForEvent("page"),
      page.getByRole("link", { name: "Другой аккаунт в новой вкладке" }).click(),
    ]);
    await expect(tab.getByRole("heading", { name: "Вход в другой аккаунт" })).toBeVisible();
    await expect(tab.getByRole("button", { name: "Войти", exact: true })).toBeEnabled();
    await fillCredentials(tab, email);
    await tab.getByRole("button", { name: "Войти", exact: true }).click();
    return tab;
  }

  const tenantTab = await signInInOtherTab(tenantEmail);
  await expect(tenantTab).toHaveURL(/\/cabinet$/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Меню" }).click();
  const ownerTab = await signInInOtherTab(ownerEmail);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(ownerTab).toHaveURL(/\/dashboard$/);
  await ownerTab.getByRole("button", { name: "Выйти" }).click();
  await expect(ownerTab).toHaveURL(/\/$/);

  await expect(page.getByText("E2E Собственник", { exact: true })).toBeVisible();
  await expect(tenantTab.getByText("E2E Арендатор", { exact: true })).toBeVisible();
  await Promise.all([page.reload(), tenantTab.reload()]);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(tenantTab).toHaveURL(/\/cabinet$/);
  await expect(tenantTab.getByText("E2E Арендатор", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page).toHaveURL(/\/$/);
  await regularTab.goto("/dashboard");
  await expect(regularTab).toHaveURL(/\/auth(?:\?|$)/);
  await tenantTab.reload();
  await expect(tenantTab).toHaveURL(/\/cabinet$/);
  await tenantTab.getByRole("button", { name: "Выйти" }).click();
  await expect(tenantTab).toHaveURL(/\/$/);
  await tenantTab.goto("/cabinet");
  await expect(tenantTab).toHaveURL(/\/auth(?:\?|$)/);
  await expect(tenantTab.getByRole("heading", { name: "Вход в другой аккаунт" })).toBeVisible();
});
