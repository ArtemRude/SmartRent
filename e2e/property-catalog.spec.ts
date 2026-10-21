import { test, expect, type BrowserContext } from "@playwright/test";
import type { CatalogItem, CatalogPage } from "../src/lib/property-catalog";
type Identity = "owner" | "manager" | "viewer" | "visitor";
const ownerId = "b1000000-0000-0000-0000-000000000001";
const id = (i: number) => `b2000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
const publicId = (i: number) => `b9000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1kAAAAASUVORK5CYII=",
  "base64",
);
function fixture() {
  const items: CatalogItem[] = Array.from({ length: 29 }, (_, i) => ({
    id: id(i + 1),
    scope: "internal",
    title:
      i === 0
        ? "Квартира на Садовой"
        : i === 1
          ? "Склад на Северной"
          : `Офис ${String(i + 1).padStart(2, "0")}`,
    location:
      i === 0 ? "Москва, Садовая, 12" : i === 1 ? "Казань, Северная, 10" : "Москва, Деловая, 4",
    type: i === 0 ? "apartment" : i === 1 ? "warehouse" : "commercial",
    status: "active",
    occupancy: i === 1 ? "leased" : "free",
    description:
      i === 0
        ? "Светлая квартира с балконом. PRIVATE_ACCESS_CODE"
        : i === 1
          ? "Склад с отдельным въездом"
          : "Помещение для офиса",
    photos: i === 0 ? ["owner/cover.png", "owner/second.png"] : [],
    photo_bucket: "property-photos",
    area: i === 0 ? 42 : i === 1 ? 150 : 50 + i,
    price: i === 0 ? 45000 : i === 1 ? 90000 : 30000 + i * 1000,
    price_source: i === 1 ? "contract" : "offer",
    unit_count: i === 1 ? 2 : 1,
    open_requests: i === 0 ? 1 : 0,
    role: "owner",
    published: i !== 1,
    created_at: new Date(Date.UTC(2026, 9, 21) - i * 1000).toISOString(),
  }));
  return {
    items,
    missing: false,
    failed: false,
    revoked: false,
    stale: false,
    created: 0,
    unitCreated: 0,
    calls: [] as { resource: string; body: Record<string, unknown> }[],
  };
}
type State = ReturnType<typeof fixture>;
async function install(c: BrowserContext, state: State, identity: Identity) {
  const personalRole = identity === "owner" ? "owner" : "tenant";
  const uid =
    identity === "owner"
      ? ownerId
      : identity === "manager"
        ? id(800)
        : identity === "viewer"
          ? id(801)
          : null;
  const user = {
    id: uid,
    email: `${identity}@example.invalid`,
    aud: "authenticated",
    role: "authenticated",
    user_metadata: { name: identity, role: personalRole },
    app_metadata: { provider: "email" },
    created_at: new Date().toISOString(),
  };
  if (uid) {
    const payload = Buffer.from(
      JSON.stringify({
        sub: uid,
        role: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url");
    const session = {
      user,
      access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.fixture`,
      refresh_token: "fixture",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
      token_type: "bearer",
    };
    await c.addInitScript(
      ({ key, session }) => localStorage.setItem(key, JSON.stringify(session)),
      {
        key: `sb-${new URL(process.env["E2E_SUPABASE_URL"]!).hostname.split(".")[0]}-auth-token`,
        session,
      },
    );
  }
  await c.route("**/auth/v1/**", (r) => r.fulfill({ json: user }));
  await c.route("**/storage/v1/**", (r) =>
    r.request().method() === "POST"
      ? r.fulfill({
          json: r.request().url().includes("/object/sign/")
            ? { signedURL: "/object/sign/catalog-fixture.png?token=fixture" }
            : { Key: "uploaded" },
        })
      : r.fulfill({ contentType: "image/png", body: image }),
  );
  await c.route("**/rest/v1/**", async (r) => {
    const resource = new URL(r.request().url()).pathname.split("/").at(-1)!;
    const method = r.request().method();
    const body = method === "POST" || method === "PATCH" ? r.request().postDataJSON() : {};
    state.calls.push({ resource, body });
    if (resource === "property_catalog" || resource === "public_property_catalog") {
      if (state.missing)
        return r.fulfill({ status: 404, json: { code: "PGRST202", message: "missing catalog" } });
      if (state.failed)
        return r.fulfill({
          status: 503,
          json: { code: "unavailable", message: "Каталог временно недоступен" },
        });
      const pub = resource === "public_property_catalog";
      let items = pub
        ? state.items
            .filter((i) => i.published && i.status === "active")
            .map((i): CatalogItem => ({
              id: publicId(Number(i.id.slice(-12))),
              scope: "public",
              title: i.title,
              type: i.type,
              status: "published",
              price: i.price,
              price_source: "offer",
              area: i.area,
              published: true,
              created_at: i.created_at,
              description: "Публичное описание с условиями аренды",
              location: i.id === id(1) ? "Москва, район парка" : i.location,
              occupancy: "offer",
              photos: [`${publicId(Number(i.id.slice(-12)))}/cover.png`],
              photo_bucket: "listing-photos",
              available_from: "2026-11-01",
            }))
        : state.revoked && identity !== "owner"
          ? []
          : identity === "owner"
            ? state.items
            : state.items
                .slice(0, 1)
                .map((i) => ({ ...i, role: identity as "manager" | "viewer" }));
      const all = items.length;
      const f = body.p_filters ?? {};
      if (f.q)
        items = items.filter((i) =>
          `${i.title} ${i.location} ${i.description}`.toLowerCase().includes(f.q.toLowerCase()),
        );
      for (const key of ["type", "status", "occupancy"] as const)
        if (f[key] && f[key] !== "all") items = items.filter((i) => i[key] === f[key]);
      if (f.publication && f.publication !== "all")
        items = items.filter((i) => i.published === (f.publication === "published"));
      for (const [filter, key, kind] of [
        ["price_min", "price", "min"],
        ["price_max", "price", "max"],
        ["area_min", "area", "min"],
        ["area_max", "area", "max"],
      ] as const)
        if (f[filter] !== "" && f[filter] != null)
          items = items.filter(
            (i) =>
              i[key] != null &&
              (kind === "min" ? i[key]! >= Number(f[filter]) : i[key]! <= Number(f[filter])),
          );
      items.sort((a, b) =>
        f.sort === "price_asc"
          ? (a.price ?? Infinity) - (b.price ?? Infinity)
          : f.sort === "price_desc"
            ? (b.price ?? -Infinity) - (a.price ?? -Infinity)
            : f.sort === "area_desc"
              ? (b.area ?? -Infinity) - (a.area ?? -Infinity)
              : f.sort === "name"
                ? a.title.localeCompare(b.title, "ru")
                : b.created_at.localeCompare(a.created_at),
      );
      const start = body.p_cursor ? Number(body.p_cursor.number) : 0;
      const page: CatalogPage = {
        items: items.slice(start, start + 24),
        total: items.length,
        all_total: all,
        next_cursor:
          items.length > start + 24
            ? {
                sort: f.sort,
                rank: 0,
                number: String(start + 24),
                text: "",
                id: items[start + 23]!.id,
              }
            : null,
      };
      return r.fulfill({ json: page });
    }
    if (resource === "set_catalog_property_status") {
      if (state.stale) {
        state.stale = false;
        return r.fulfill({
          status: 409,
          json: { code: "40001", message: "Состояние объекта уже изменено. Обновите каталог" },
        });
      }
      const item = state.items.find((i) => i.id === body.p_id)!;
      item.status = body.p_status;
      if (body.p_status === "archived") item.published = false;
      return r.fulfill({ json: item.id });
    }
    if (resource === "property_hub") {
      const item = state.items.find((i) => i.id === body.p_property_id)!;
      return r.fulfill({
        json: {
          property: {
            id: item.id,
            name: item.title,
            address: item.location,
            description: item.description,
            status: item.status,
            role: identity === "owner" ? "owner" : "manager",
            owner_id: ownerId,
          },
          workspace: null,
          units: [],
          repairs: [],
          repair_count: 0,
          open_requests: 1,
          showing_count: 0,
          listings: [],
          applications: [],
          application_count: 0,
          applications_truncated: false,
          events: [],
        },
      });
    }
    if (resource === "public_listing") {
      const item = state.items.find((i) => publicId(Number(i.id.slice(-12))) === body.p_public_id);
      return r.fulfill({
        json:
          item?.published && item.status === "active"
            ? {
                public_id: body.p_public_id,
                can_apply: true,
                published_at: item.created_at,
                details: {
                  title: item.title,
                  location: "Москва, район парка",
                  description: "Публичное описание с условиями аренды",
                  monthly_rent: item.price,
                  deposit: item.price,
                  area: item.area,
                  available_from: "2026-11-01",
                  contact_name: "Анна",
                  photos: [],
                },
              }
            : null,
      });
    }
    if (resource === "recruitment_overview")
      return r.fulfill({
        json: {
          properties: [],
          applications: [],
          properties_truncated: false,
          applications_truncated: false,
        },
      });
    if (resource === "properties" && method === "POST") {
      state.created++;
      state.items.unshift({
        ...state.items[0]!,
        id: id(100 + state.created),
        title: body.name,
        location: body.address,
        type: body.type,
        description: body.description,
        photos: [],
        price: null,
        published: false,
      });
      return r.fulfill({ json: null });
    }
    if (resource === "units" && method === "POST") {
      state.unitCreated++;
      const item = state.items.find((i) => i.id === body.property_id)!;
      item.unit_count = (item.unit_count ?? 0) + 1;
      item.area = (item.area ?? 0) + Number(body.area);
      return r.fulfill({ json: null });
    }
    const tables: Record<string, unknown> = {
      profiles: { id: uid, name: identity, email: user.email, phone: null },
      user_roles: { role: personalRole },
      notifications: [],
      properties: state.items.map((i) => ({
        id: i.id,
        owner_id: ownerId,
        name: i.title,
        address: i.location,
        type: i.type,
        status: i.status,
        photos: i.photos,
        description: i.description,
        created_at: i.created_at,
      })),
      units: [],
      tenants: [],
      lease_agreements: [],
      requests: [],
      property_activity_events: [],
    };
    return r.fulfill({ json: tables[resource] ?? [] });
  });
}
test("owner filters, sorts, previews, opens object, creates property/unit and archives safely", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const state = fixture(),
    c = await browser.newContext();
  await install(c, state, "owner");
  const p = await c.newPage();
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto("/properties");
  await expect(p.getByTestId("catalog-card")).toHaveCount(24);
  await p.getByRole("button", { name: "Показать ещё", exact: true }).click();
  await expect(p.getByTestId("catalog-card")).toHaveCount(29);
  await p.getByRole("button", { name: "Склад", exact: true }).click();
  await expect(p.getByTestId("catalog-card")).toHaveCount(1);
  await expect(p).toHaveURL(/type=warehouse/);
  await expect(p.getByTestId("catalog-card")).toContainText("Склад на Северной");
  await p.getByRole("button", { name: "Все объекты", exact: true }).click();
  await p.getByLabel("Поиск объектов", { exact: true }).fill("Садовая");
  await p.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(p.getByTestId("catalog-card")).toHaveCount(1);
  await p
    .getByRole("button", { name: "Быстрый просмотр: Квартира на Садовой", exact: true })
    .click();
  await expect(p.getByRole("dialog")).toContainText("PRIVATE_ACCESS_CODE");
  await p.getByRole("button", { name: "Фото 2", exact: true }).click();
  await expect(p.getByRole("button", { name: "Фото 2", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await p.getByRole("link", { name: "Открыть полную страницу" }).click();
  await expect(p).toHaveURL(`/objects/${id(1)}`);
  await expect(p.getByRole("heading", { name: "Квартира на Садовой", exact: true })).toBeVisible();
  await p.goBack();
  await expect(p.getByLabel("Поиск объектов")).toHaveValue("Садовая");
  await expect(p.getByTestId("catalog-card")).toHaveCount(1);
  await p.getByRole("button", { name: "Управление: Квартира на Садовой", exact: true }).click();
  await p.getByRole("menuitem", { name: "Добавить помещение", exact: true }).click();
  await p.getByLabel("Название помещения", { exact: true }).fill("Балкон");
  await p.getByLabel("Площадь, м²", { exact: true }).fill("5");
  await p.getByRole("dialog").getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(p.getByRole("dialog")).toHaveCount(0);
  await expect(p.getByTestId("catalog-card")).toContainText("47 м²");
  expect(state.unitCreated).toBe(1);
  await p.getByRole("button", { name: "Управление: Квартира на Садовой", exact: true }).click();
  await p.getByRole("menuitem", { name: "В архив", exact: true }).click();
  await expect(p.getByRole("dialog")).toContainText("Архив не завершает действующую аренду");
  state.stale = true;
  await p.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(p.getByRole("dialog").getByRole("alert")).toContainText("уже изменено");
  await p.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(p.getByRole("dialog")).toHaveCount(0);
  await expect(p.getByTestId("catalog-card")).toContainText("В архиве");
  expect(state.items[0]!.published).toBe(false);
  await p.getByRole("button", { name: "Управление: Квартира на Садовой", exact: true }).click();
  await p.getByRole("menuitem", { name: "Вернуть в работу", exact: true }).click();
  await p.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(p.getByRole("dialog")).toHaveCount(0);
  expect(state.items[0]!.published).toBe(false);
  await p.getByRole("button", { name: "Сбросить фильтры", exact: true }).first().click();
  await p.getByLabel("Сортировка", { exact: true }).selectOption("price_asc");
  await expect(p.getByTestId("catalog-card").first()).toContainText("Офис 03");
  await p.getByRole("button", { name: "Список", exact: true }).click();
  await expect(p.getByTestId("catalog-results")).toHaveAttribute("data-view", "list");
  await p.reload();
  await expect(p.getByRole("button", { name: "Список", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await p.getByRole("button", { name: "Добавить объект", exact: true }).click();
  await p.getByLabel("Название", { exact: true }).fill("Новый офис");
  await p.getByLabel("Адрес", { exact: true }).fill("Казань, Пушкина, 5");
  await p.getByRole("dialog").getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(p.getByRole("dialog")).toHaveCount(0);
  expect(state.created).toBe(1);
  await p.getByLabel("Поиск объектов").fill("Новый офис");
  await p.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(p.getByTestId("catalog-card")).toHaveCount(1);
  await expect(p.getByTestId("catalog-card")).toContainText("Стоимость не указана");
  expect(errors).toEqual([]);
  await c.close();
});
test("public catalog filters by price/area, keeps URL and opens only marketing card on mobile", async ({
  browser,
}) => {
  const state = fixture(),
    c = await browser.newContext();
  await install(c, state, "visitor");
  const p = await c.newPage();
  await p.goto("/catalog");
  await expect(p.getByTestId("catalog-card")).toHaveCount(24);
  await expect(p.locator("main")).not.toContainText("PRIVATE_");
  await expect(p.getByRole("button", { name: /Управление:/ })).toHaveCount(0);
  await p.getByText("Фильтры", { exact: true }).click();
  await p.getByLabel("Цена от, ₽/мес.").fill("40000");
  await p.getByLabel("Цена до, ₽/мес.").fill("50000");
  await p.getByLabel("Площадь до, м²").fill("45");
  await p.getByRole("button", { name: "Применить фильтры", exact: true }).click();
  await expect(p.getByTestId("catalog-card")).toHaveCount(1);
  await expect(p).toHaveURL(/price_min=/);
  expect(JSON.parse(new URL(p.url()).searchParams.get("price_min")!)).toBe("40000");
  await p.getByRole("button", { name: "Список", exact: true }).click();
  await p.reload();
  await expect(p.getByTestId("catalog-card")).toHaveCount(1);
  await p.setViewportSize({ width: 375, height: 850 });
  await expect
    .poll(() => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await p.screenshot({ path: "test-results/catalog-public-mobile.png", fullPage: true });
  await p
    .getByRole("button", { name: "Быстрый просмотр: Квартира на Садовой", exact: true })
    .click();
  await expect(p.getByRole("dialog")).not.toContainText("PRIVATE_");
  await p.getByRole("link", { name: "Открыть полную страницу", exact: true }).click();
  await expect(p).toHaveURL(`/listing/${publicId(1)}`);
  await expect(p.getByRole("heading", { name: "Квартира на Садовой", exact: true })).toBeVisible();
  await expect(p.getByRole("link", { name: "Все объявления", exact: true })).toBeVisible();
  await p.goBack();
  await expect(p.getByTestId("catalog-card")).toHaveCount(1);
  await p.getByRole("button", { name: "Сбросить фильтры", exact: true }).first().click();
  await p.setViewportSize({ width: 1440, height: 1000 });
  await expect(p.getByTestId("catalog-card")).toHaveCount(24);
  await p.screenshot({ path: "test-results/catalog-public-desktop.png", fullPage: true });
  await c.close();
});
for (const identity of ["manager", "viewer"] as const)
  test(`${identity} sees only selected team properties and loses cached catalog/preview on revoke`, async ({
    browser,
  }) => {
    const state = fixture(),
      c = await browser.newContext();
    await install(c, state, identity);
    const p = await c.newPage();
    await p.goto("/portfolio");
    await expect(p.getByTestId("catalog-card")).toHaveCount(1);
    await expect(p.locator("main")).not.toContainText("Склад на Северной");
    await p.getByRole("button", { name: "Управление: Квартира на Садовой", exact: true }).click();
    await expect(p.getByRole("menuitem", { name: "В архив", exact: true })).toHaveCount(0);
    await expect(p.getByRole("menuitem", { name: "Параметры объекта", exact: true })).toHaveCount(
      0,
    );
    await p.keyboard.press("Escape");
    await p
      .getByRole("button", { name: "Быстрый просмотр: Квартира на Садовой", exact: true })
      .click();
    state.revoked = true;
    await expect(p.getByRole("dialog")).toHaveCount(0, { timeout: 12000 });
    await expect(p.getByTestId("catalog-card")).toHaveCount(0);
    await expect(
      p.getByRole("heading", { name: "Пока нет доступных объектов", exact: true }),
    ).toBeVisible();
    await c.close();
  });
test("catalog handles missing migration, failed refresh and empty filtered result without stale cards", async ({
  browser,
}) => {
  const state = fixture(),
    c = await browser.newContext();
  await install(c, state, "owner");
  const p = await c.newPage();
  state.missing = true;
  await p.goto("/properties");
  await expect(p.getByRole("alert")).toContainText("Требуется обновление базы данных");
  state.missing = false;
  await p.getByRole("button", { name: "Повторить загрузку", exact: true }).click();
  await expect(p.getByTestId("catalog-card")).toHaveCount(24);
  await p.getByLabel("Поиск объектов").fill("Нет такого объекта");
  await p.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(
    p.getByRole("heading", { name: "По этим условиям ничего не найдено", exact: true }),
  ).toBeVisible();
  await p.getByRole("button", { name: "Сбросить фильтры", exact: true }).first().click();
  await expect(p.getByTestId("catalog-card")).toHaveCount(24);
  state.failed = true;
  await p.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(p.getByRole("alert")).toContainText("Не удалось обновить каталог");
  await expect(p.getByTestId("catalog-card")).toHaveCount(0);
  await c.close();
});
