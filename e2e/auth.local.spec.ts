import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

function uniqueEmail(role: "owner" | "tenant"): string {
  return `e2e-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

async function fillCredentials(page: Page, email: string) {
  await page.getByLabel("Пароль").fill("E2e-password-123!");
  if (!(await page.getByLabel("Email").isReadOnly())) {
    await page.getByLabel("Email").fill(email);
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
  await page.getByLabel("Имя").fill("E2E Собственник");
  await page.getByLabel("Телефон").fill("+7 900 000-00-01");
  await fillCredentials(page, email);
  await page.getByRole("button", { name: "Создать аккаунт" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Мой кабинет" })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Мой кабинет" })).toBeVisible();

  await page.getByRole("link", { name: "Объекты" }).click();
  await expect(page).toHaveURL(/\/properties$/);
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
  await expect(page.getByLabel("Email")).toHaveValue(email);
  await expect(page.getByLabel("Email")).not.toBeEditable();
  await fillCredentials(page, email);
  await page.getByRole("button", { name: "Создать аккаунт" }).click();

  await expect(page).toHaveURL(/\/cabinet$/);
  await expect(page.getByRole("heading", { name: "Мой кабинет" })).toBeVisible();

  await page.goto("/properties");
  await expect(page).toHaveURL(/\/cabinet$/);
});
