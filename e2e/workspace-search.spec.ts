import { expect, test, type BrowserContext } from "@playwright/test";
import type { WorkspaceSearchItem } from "../src/lib/workspace-search";

const uuid = (n: number) => `b2000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (values: Partial<WorkspaceSearchItem> = {}): WorkspaceSearchItem => ({
  kind: "property",
  id: uuid(2),
  title: "Квартира у парка",
  subtitle: "Садовая, 12",
  status: "active",
  property_id: uuid(2),
  agreement_id: null,
  access: "owner",
  ...values,
});
function state() {
  return {
    calls: [] as string[],
    mode: "normal",
    hasMore: false,
    items: [
      item(),
      item({
        kind: "tenant",
        id: uuid(3),
        title: "Анна Миронова",
        subtitle: "anna@example.invalid",
        property_id: null,
      }),
      item({
        kind: "agreement",
        id: uuid(4),
        title: "Договор — Квартира у парка",
        subtitle: "Анна Миронова",
        agreement_id: uuid(4),
      }),
      item({ kind: "request", id: uuid(5), title: "Починить кран", subtitle: "Квартира у парка" }),
    ],
    releaseOld: null as (() => void) | null,
    oldDelivered: false,
  };
}
async function install(
  context: BrowserContext,
  fixture: ReturnType<typeof state>,
  role: "owner" | "tenant" = "owner",
) {
  const api = process.env["E2E_SUPABASE_URL"]!;
  test.skip(!api, "Use loopback intercepted API.");
  const id = uuid(role === "owner" ? 1 : 11),
    now = new Date().toISOString();
  const user = {
    id,
    email: `${role}@example.invalid`,
    aud: "authenticated",
    role: "authenticated",
    user_metadata: { role, name: "Анна" },
    app_metadata: { provider: "email" },
    created_at: now,
  };
  const token = Buffer.from(
    JSON.stringify({ sub: id, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url");
  const session = {
    user,
    access_token: `eyJhbGciOiJIUzI1NiJ9.${token}.fixture`,
    refresh_token: "fixture",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };
  await context.addInitScript(
    ({ session, key }) => localStorage.setItem(key, JSON.stringify(session)),
    { session, key: `sb-${new URL(api).hostname.split(".")[0]}-auth-token` },
  );
  await context.route("**/auth/v1/**", (route) =>
    route.fulfill({ json: route.request().url().includes("/token") ? session : user }),
  );
  await context.route("**/rest/v1/**", async (route) => {
    const resource = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if (resource === "workspace_search") {
      const query = route.request().postDataJSON().p_query;
      fixture.calls.push(query);
      if (fixture.mode === "error")
        return route.fulfill({ status: 404, json: { code: "PGRST202", message: "Missing RPC" } });
      if (fixture.mode === "malformed")
        return route.fulfill({ json: { items: [{ ...item(), id: "../admin" }], has_more: false } });
      if (query === "старый") {
        await new Promise<void>((resolve) => {
          fixture.releaseOld = resolve;
        });
        try {
          await route.fulfill({
            json: { items: [item({ title: "Старое совпадение" })], has_more: false },
          });
        } finally {
          fixture.oldDelivered = true;
        }
        return;
      }
      return route.fulfill({
        json: {
          items:
            fixture.mode === "empty"
              ? []
              : query === "новый"
                ? [item({ title: "Новое совпадение" })]
                : fixture.items,
          has_more: fixture.hasMore,
        },
      });
    }
    if (resource === "user_roles")
      return route.fulfill({
        json: route.request().headers()["accept"]?.includes("object")
          ? { user_id: id, role }
          : [{ user_id: id, role }],
      });
    if (resource === "profiles")
      return route.fulfill({ json: { id, name: "Анна", email: user.email, phone: null } });
    return route.fulfill({ json: [] });
  });
}

test("search opens by keyboard, debounces requests, groups results and restores trigger focus", async ({
  page,
  context,
}) => {
  const fixture = state();
  await install(context, fixture);
  await page.goto("/requests");
  const trigger = page
    .getByRole("button", { name: "Поиск по кабинету", exact: true })
    .filter({ visible: true });
  await trigger.focus();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Поиск по кабинету" });
  const input = dialog.getByRole("combobox", { name: "Поиск по кабинету" });
  await expect(input).toBeFocused();
  await expect(dialog.getByText("Введите хотя бы два символа.")).toBeVisible();
  await input.pressSequentially("Квартира", { delay: 15 });
  await expect(dialog.getByRole("option")).toHaveCount(4);
  expect(fixture.calls).toEqual(["Квартира"]);
  for (const label of ["Объекты", "Арендаторы", "Договоры", "Заявки"])
    await expect(dialog.getByText(label, { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/workspace-search-desktop.png", fullPage: true });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(input).toHaveValue("");
  await input.fill("Договор");
  await expect(dialog.getByRole("option")).toHaveCount(4);
  await input.press("ArrowDown");
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/agreements\\?agreementId=${uuid(4)}`));
  await expect(dialog).toHaveCount(0);
});

test("an older response cannot replace results for the current query", async ({
  page,
  context,
}) => {
  const fixture = state();
  await install(context, fixture);
  await page.goto("/requests");
  await page.getByRole("button", { name: "Поиск по кабинету" }).filter({ visible: true }).click();
  const dialog = page.getByRole("dialog", { name: "Поиск по кабинету" }),
    input = dialog.getByRole("combobox");
  await input.fill("старый");
  await expect.poll(() => fixture.releaseOld !== null).toBe(true);
  await input.fill("новый");
  await expect(dialog.getByRole("option", { name: /Новое совпадение/ })).toBeVisible();
  fixture.releaseOld!();
  await expect.poll(() => fixture.oldDelivered).toBe(true);
  await expect(dialog.getByRole("option", { name: /Новое совпадение/ })).toBeVisible();
  await expect(dialog.getByText("Старое совпадение")).toHaveCount(0);
});

test("unavailable and malformed search do not appear as an empty result and retry recovers", async ({
  page,
  context,
}) => {
  const fixture = state();
  fixture.mode = "error";
  await install(context, fixture);
  await page.goto("/requests");
  await page.getByRole("button", { name: "Поиск по кабинету" }).filter({ visible: true }).click();
  const dialog = page.getByRole("dialog", { name: "Поиск по кабинету" });
  await dialog.getByRole("combobox").fill("Квартира");
  await expect(dialog.getByRole("alert")).toHaveText("Поиск пока недоступен. Попробуйте позже.");
  await expect(dialog.getByText("Ничего не найдено")).toHaveCount(0);
  fixture.mode = "empty";
  await dialog.getByRole("button", { name: "Повторить поиск" }).click();
  await expect(dialog.getByText("Ничего не найдено")).toBeVisible();
  fixture.mode = "malformed";
  await dialog.getByRole("combobox").fill("Другая квартира");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("option")).toHaveCount(0);
});

test("mobile search remains within 320px and opens a tenant agreement in the cabinet", async ({
  page,
  context,
}) => {
  const fixture = state();
  fixture.hasMore = true;
  fixture.items = [
    item({
      kind: "agreement",
      access: "tenant",
      id: uuid(4),
      agreement_id: uuid(4),
      title: "Договор — Очень длинное название квартиры без сокращений",
      subtitle: "Адрес и условия собственной аренды",
    }),
  ];
  await install(context, fixture, "tenant");
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/requests");
  await page.getByRole("button", { name: "Поиск по кабинету" }).filter({ visible: true }).click();
  const dialog = page.getByRole("dialog", { name: "Поиск по кабинету" });
  await dialog.getByRole("combobox").fill("Договор");
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await expect(dialog.getByText("Показаны первые совпадения. Уточните запрос.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  await page.screenshot({ path: "test-results/workspace-search-mobile.png", fullPage: true });
  await dialog.getByRole("option").click();
  await expect(page).toHaveURL(new RegExp(`/cabinet\\?agreementId=${uuid(4)}`));
  await expect(dialog).toHaveCount(0);
});
