import { test, expect, type BrowserContext } from "@playwright/test";
import type { PropertyHub, PropertyListing, RentalApplication } from "../src/lib/recruitment";
const propertyId = "f2000000-0000-0000-0000-000000000001",
  publicId = "f9000000-0000-0000-0000-000000000001";
const listingId = "f8000000-0000-0000-0000-000000000001";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1kAAAAASUVORK5CYII=",
  "base64",
);
type Identity = "owner" | "manager" | "viewer" | "candidate";
function fixture() {
  return {
    listing: null as PropertyListing | null,
    applications: [] as RentalApplication[],
    available: true,
    revoked: false,
    stale: false,
    leaseCount: 0,
    profileName: null as string | null,
    profilePhone: null as string | null,
  };
}
type State = ReturnType<typeof fixture>;
async function install(context: BrowserContext, state: State, identity: Identity, signedIn = true) {
  const ids = {
    owner: "f1000000-0000-0000-0000-000000000001",
    manager: "f1000000-0000-0000-0000-000000000002",
    viewer: "f1000000-0000-0000-0000-000000000003",
    candidate: "f1000000-0000-0000-0000-000000000004",
  };
  const id = ids[identity],
    role = identity === "owner" ? "owner" : "tenant",
    now = new Date().toISOString();
  const user = {
    id,
    email: `${identity}@example.invalid`,
    aud: "authenticated",
    role: "authenticated",
    email_confirmed_at: now,
    user_metadata: { name: identity, role },
    app_metadata: { provider: "email" },
    created_at: now,
  };
  const payload = Buffer.from(
    JSON.stringify({ sub: id, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url");
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.fixture`,
    refresh_token: "fixture",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  };
  if (signedIn)
    await context.addInitScript(
      ({ session, key }) => localStorage.setItem(key, JSON.stringify(session)),
      {
        session,
        key: `sb-${new URL(process.env["E2E_SUPABASE_URL"]!).hostname.split(".")[0]}-auth-token`,
      },
    );
  await context.route("**/auth/v1/**", (route) =>
    route.fulfill({ json: route.request().url().includes("/token") ? session : user }),
  );
  await context.route("**/storage/v1/**", (route) => {
    if (route.request().method() === "POST" && route.request().url().includes("/object/sign/"))
      return route.fulfill({ json: { signedURL: "/object/sign/fixture.png?token=fixture" } });
    if (route.request().method() === "POST") return route.fulfill({ json: { Key: "uploaded" } });
    return route.fulfill({ contentType: "image/png", body: png });
  });
  await context.route("**/rest/v1/**", async (route) => {
    const resource = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const body = route.request().method() === "POST" ? route.request().postDataJSON() : {};
    const denied = () =>
      route.fulfill({ status: 403, json: { code: "42501", message: "Доступ к объекту отозван" } });
    if (resource === "public_listing")
      return route.fulfill({
        json:
          state.available && state.listing?.status === "published"
            ? {
                public_id: publicId,
                published_at: now,
                details: state.listing.published_snapshot,
                can_apply: identity === "candidate",
              }
            : null,
      });
    if (resource === "property_hub") {
      if (!state.available)
        return route.fulfill({
          status: 404,
          json: { code: "PGRST202", message: "function not found" },
        });
      if (identity === "candidate" || (state.revoked && identity !== "owner")) return denied();
      const hub: PropertyHub = {
        property: {
          id: propertyId,
          name: "Квартира на Садовой",
          address: "PRIVATE_ADDRESS 17",
          description: "PRIVATE_ACCESS_CODE",
          owner_id: ids.owner,
          status: "active",
          role: identity,
        },
        workspace: null,
        units: [{ id: "unit101", name: "Квартира 101", area: 42, status: "available" }],
        repairs: [
          {
            id: "repair1",
            title: "Ремонт отопления",
            status: "in_progress",
            due_date: "2026-10-30",
          },
        ],
        repair_count: 1,
        open_requests: 1,
        showing_count: state.applications.filter((a) => a.status === "showing").length,
        listings: state.listing ? [state.listing] : [],
        applications: identity === "viewer" ? [] : state.applications,
        application_count: state.applications.filter((a) =>
          ["new", "showing", "shortlisted"].includes(a.status),
        ).length,
        applications_truncated: false,
        events: [],
      };
      return route.fulfill({ json: hub });
    }
    if (resource === "recruitment_overview")
      return route.fulfill({
        json: {
          properties:
            identity === "candidate"
              ? []
              : [
                  {
                    id: propertyId,
                    name: "Квартира на Садовой",
                    address: "PRIVATE_ADDRESS",
                    role: identity,
                  },
                ],
          applications:
            identity === "candidate"
              ? state.applications.map((a) => ({ ...a, operator_note: null, agreement_id: null }))
              : [],
          properties_truncated: false,
          applications_truncated: false,
        },
      });
    if (resource === "save_property_listing") {
      const old = state.listing;
      state.listing = {
        id: listingId,
        public_id: publicId,
        property_id: propertyId,
        unit_id: null,
        status: old?.status ?? "draft",
        draft: body.p_values,
        published_snapshot: old?.published_snapshot ?? null,
        revision: (old?.revision ?? 0) + 1,
        has_changes: true,
        available: old?.available ?? false,
      };
      return route.fulfill({ json: listingId });
    }
    if (resource === "act_on_property_listing") {
      if (body.p_action === "publish") {
        state.listing!.status = "published";
        state.listing!.published_snapshot = structuredClone(state.listing!.draft);
        state.listing!.has_changes = false;
        state.listing!.available = true;
      } else {
        state.listing!.status = "paused";
        state.listing!.available = false;
      }
      state.listing!.revision++;
      return route.fulfill({ json: listingId });
    }
    if (resource === "apply_to_listing") {
      if (!state.applications.length)
        state.applications.push({
          id: "application1",
          public_id: publicId,
          listing_id: listingId,
          property_id: propertyId,
          name: body.p_values.name,
          email: user.email,
          phone: body.p_values.phone,
          message: body.p_values.message,
          offer: structuredClone(state.listing!.published_snapshot!),
          status: "new",
          showing_at: null,
          public_note: "",
          operator_note: "",
          agreement_id: null,
          revision: 1,
          created_at: now,
        });
      return route.fulfill({ json: "application1" });
    }
    if (resource === "act_on_rental_application") {
      if (state.stale) {
        state.stale = false;
        return route.fulfill({
          status: 409,
          json: { code: "40001", message: "Заявка уже изменена. Обновите страницу" },
        });
      }
      const a = state.applications[0]!;
      const v = body.p_values;
      a.status =
        (
          {
            schedule: "showing",
            shortlist: "shortlisted",
            accept: "accepted",
            reject: "rejected",
            withdraw: "withdrawn",
          } as const
        )[body.p_action as "schedule"] ?? a.status;
      a.public_note = v.public_note ?? a.public_note;
      a.operator_note = v.operator_note ?? a.operator_note;
      a.showing_at = v.showing_at ?? a.showing_at;
      a.revision++;
      if (body.p_action === "accept") {
        a.agreement_id = "draft-lease";
        state.leaseCount++;
        state.listing!.status = "filled";
        state.listing!.available = false;
      }
      return route.fulfill({ json: a.agreement_id ?? a.id });
    }
    const tables: Record<string, unknown> = {
      profiles: {
        id,
        name: state.profileName ?? identity,
        email: user.email,
        phone: state.profilePhone,
      },
      user_roles: { role },
      notifications: [],
    };
    return route.fulfill({ json: tables[resource] ?? [] });
  });
}
test("public listing, sign-in return, applicant, manager showing and owner selection", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const state = fixture();
  const ownerContext = await browser.newContext();
  const candidateContext = await browser.newContext();
  const managerContext = await browser.newContext();
  const viewerContext = await browser.newContext();
  const anonymousContext = await browser.newContext();
  await install(ownerContext, state, "owner");
  await install(candidateContext, state, "candidate", false);
  await install(managerContext, state, "manager");
  await install(viewerContext, state, "viewer");
  await install(anonymousContext, state, "candidate", false);
  const owner = await ownerContext.newPage(),
    candidate = await candidateContext.newPage(),
    manager = await managerContext.newPage(),
    viewer = await viewerContext.newPage(),
    anonymous = await anonymousContext.newPage();
  await owner.goto(`/objects/${propertyId}`);
  await expect(
    owner.getByRole("heading", { name: "Квартира на Садовой", exact: true }),
  ).toBeVisible();
  await expect(owner.getByText("Ремонт отопления", { exact: true })).toBeVisible();
  await owner.getByRole("tab", { name: "Публичные карточки" }).click();
  await owner.getByRole("button", { name: "Создать карточку" }).click();
  await owner.getByLabel("Название объявления").fill("Светлая квартира у парка");
  await owner.getByLabel("Расположение для посетителей").fill("Москва, рядом с парком");
  await owner.getByLabel("Описание для посетителей").fill("Уютная квартира с балконом.");
  await owner.getByLabel("Аренда в месяц, ₽").fill("45000");
  await owner.getByLabel("Депозит, ₽").fill("45000");
  await owner.getByLabel("Площадь, м²").fill("42");
  await owner.getByLabel("Доступно с").fill("2026-10-25");
  await owner.getByLabel("Как представить контактное лицо").fill("Анна");
  await owner.getByRole("button", { name: "Сохранить черновик" }).click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  await anonymous.goto(`/listing/${publicId}`);
  await expect(anonymous.getByRole("heading", { name: "Объявление недоступно" })).toBeVisible();
  await owner.getByRole("button", { name: "Изменить карточку" }).click();
  await owner
    .getByLabel("Фотографии для посетителей")
    .setInputFiles({ name: "living.png", mimeType: "image/png", buffer: png });
  await expect(owner.getByRole("button", { name: "Сохранить черновик" })).toBeEnabled();
  await owner.getByRole("button", { name: "Сохранить черновик" }).click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  await owner.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(owner.getByRole("dialog")).toContainText("Москва, рядом с парком");
  await owner.getByRole("button", { name: "Подтвердить публикацию" }).click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  await candidate.goto(`/listing/${publicId}`);
  await expect(
    candidate.getByRole("heading", { name: "Светлая квартира у парка", exact: true }),
  ).toBeVisible();
  await expect(candidate.locator("main")).not.toContainText("PRIVATE_");
  await candidate.getByRole("link", { name: "Войти и оставить заявку" }).click();
  await candidate.getByRole("tab", { name: "Регистрация", exact: true }).click();
  await expect(candidate.getByRole("combobox")).toContainText("Арендатор");
  await expect(candidate.getByLabel("Email", { exact: true })).toBeEditable();
  await candidate.getByRole("tab", { name: "Вход", exact: true }).click();
  await candidate.getByLabel("Email", { exact: true }).fill("candidate@example.invalid");
  await candidate.getByLabel("Пароль").fill("fixture-pass");
  await candidate.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(candidate).toHaveURL(`/listing/${publicId}`);
  await candidate.getByLabel("Ваше имя").fill("Елена Кандидат");
  await candidate.getByLabel("Телефон", { exact: true }).fill("+7 900 000-11-22");
  await candidate.getByLabel("О себе и желаемой дате заселения").fill("Переезжаю в ноябре");
  await candidate.getByRole("checkbox").check();
  await candidate.getByRole("button", { name: "Отправить заявку" }).click();
  await expect(candidate.getByRole("heading", { name: "Ваш отклик", exact: true })).toBeVisible();
  await manager.goto(`/objects/${propertyId}`);
  await manager.getByRole("tab", { name: "Кандидаты и показы" }).click();
  await expect(manager.getByText("+7 900 000-11-22", { exact: false })).toBeVisible();
  await expect(manager.getByRole("button", { name: "Выбрать кандидата", exact: true })).toHaveCount(
    0,
  );
  state.stale = true;
  await manager.getByRole("button", { name: "В короткий список", exact: true }).click();
  await manager.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(manager.getByRole("dialog").getByRole("alert")).toContainText("Заявка уже изменена");
  await manager.getByRole("button", { name: "Отмена", exact: true }).click();
  await manager.getByRole("button", { name: "Назначить показ", exact: true }).click();
  await manager.getByLabel("Дата и время показа", { exact: false }).fill("2026-11-01T15:00");
  await manager.getByLabel("Сообщение кандидату").fill("Встречаемся у входа");
  await manager.getByLabel("Внутренняя заметка").fill("PRIVATE_CANDIDATE_NOTE");
  await manager.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(manager.getByRole("dialog")).toHaveCount(0);
  await expect(candidate.getByText("Назначен показ", { exact: true })).toBeVisible({
    timeout: 12000,
  });
  await expect(candidate.locator("main")).not.toContainText("PRIVATE_CANDIDATE_NOTE");
  await viewer.goto(`/objects/${propertyId}`);
  await viewer.getByRole("tab", { name: "Кандидаты и показы" }).click();
  await expect(
    viewer.getByText("У вас доступ для просмотра общего состояния.", { exact: false }),
  ).toBeVisible();
  await expect(viewer.locator("main")).not.toContainText("+7 900 000-11-22");
  await owner.getByRole("tab", { name: "Кандидаты и показы" }).click();
  await expect(owner.getByRole("button", { name: "Выбрать кандидата", exact: true })).toBeVisible({
    timeout: 12000,
  });
  await owner.getByRole("button", { name: "Выбрать кандидата", exact: true }).click();
  await owner.getByLabel("Начало аренды", { exact: true }).fill("2026-11-05");
  await owner.getByLabel("Окончание аренды", { exact: true }).fill("2027-11-04");
  await owner.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  expect(state.leaseCount).toBe(1);
  await owner.getByRole("button", { name: "Включая завершённые" }).click();
  await expect(owner.getByRole("link", { name: "Открыть договоры" })).toBeVisible();
  await anonymous.reload();
  await expect(anonymous.getByRole("heading", { name: "Объявление недоступно" })).toBeVisible();
  await candidate.getByRole("link", { name: "Мои отклики и кабинет" }).click();
  await expect(candidate).toHaveURL("/recruitment");
  await expect(
    candidate.getByRole("heading", { name: "Мои отклики на аренду", exact: true }),
  ).toBeVisible();
  await expect(candidate.getByText("Выбран собственником", { exact: true })).toBeVisible({
    timeout: 12000,
  });
  await candidate.setViewportSize({ width: 375, height: 850 });
  await expect
    .poll(() => candidate.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await candidate.screenshot({
    path: "test-results/recruitment-candidate-mobile.png",
    fullPage: true,
  });
  await owner.screenshot({ path: "test-results/property-hub-owner.png", fullPage: true });
  state.revoked = true;
  await manager.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(manager.getByRole("alert")).toContainText("Доступ к объекту отозван");
  await expect(manager.getByText("+7 900 000-11-22", { exact: false })).toHaveCount(0);
  await Promise.all([
    ownerContext.close(),
    candidateContext.close(),
    managerContext.close(),
    viewerContext.close(),
    anonymousContext.close(),
  ]);
});
test("hub and public listing handle an unapplied migration and denied access", async ({
  browser,
}) => {
  const state = fixture();
  state.available = false;
  const c = await browser.newContext();
  await install(c, state, "owner");
  const p = await c.newPage();
  await p.goto(`/objects/${propertyId}`);
  await expect(p.getByRole("alert")).toContainText("Требуется обновление базы данных");
  await c.close();
});

test("candidate can clear profile contact defaults and submit only the edited values", async ({
  context,
  page,
}) => {
  const state = fixture();
  state.profileName = "Имя из профиля";
  state.profilePhone = "+7 900 111-22-33";
  const details = {
    title: "Тестовая квартира",
    location: "Москва",
    description: "Проверка редактирования контактов",
    monthly_rent: 45000,
    deposit: 45000,
    area: 42,
    available_from: "2026-10-25",
    contact_name: "Собственник",
    photos: [],
  };
  state.listing = {
    id: listingId,
    public_id: publicId,
    property_id: propertyId,
    unit_id: null,
    status: "published",
    draft: details,
    published_snapshot: details,
    revision: 1,
    has_changes: false,
    available: true,
  };
  await install(context, state, "candidate");
  await page.goto(`/listing/${publicId}`);
  const name = page.getByLabel("Ваше имя", { exact: true });
  const phone = page.getByLabel("Телефон", { exact: true });
  await expect(name).toHaveValue(state.profileName);
  await expect(phone).toHaveValue(state.profilePhone);
  await name.fill("");
  await phone.fill("");
  await expect(name).toHaveValue("");
  await expect(phone).toHaveValue("");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Отправить заявку", exact: true }).click();
  expect(state.applications).toHaveLength(0);
  await name.fill("Анна Кандидат");
  await phone.fill("+7 900 555-66-77");
  await page.getByRole("button", { name: "Отправить заявку", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ваш отклик", exact: true })).toBeVisible();
  expect(state.applications).toHaveLength(1);
  expect(state.applications[0]!.name).toBe("Анна Кандидат");
  expect(state.applications[0]!.phone).toBe("+7 900 555-66-77");
});
