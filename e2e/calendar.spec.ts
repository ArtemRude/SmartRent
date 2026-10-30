import { expect, test, type BrowserContext } from "@playwright/test";
import { calendarToday, type RentalCalendarEvent } from "../src/lib/rental-calendar";

test.use({ timezoneId: "Europe/Moscow" });
const uuid = (n: number) => `b1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const propertyId = uuid(2),
  otherProperty = uuid(3),
  ownerId = uuid(1),
  managerId = uuid(4);
function fixture() {
  const today = calendarToday("Europe/Moscow");
  const base = {
    date: today,
    starts_at: null,
    property_id: propertyId,
    status: "pending",
    responsible_id: ownerId,
    responsible_name: "Анна Собственник",
    amount: null,
    paid_amount: null,
    source_id: uuid(10),
    agreement_id: uuid(20),
    request_id: null,
    access: "owner" as const,
    estimated: false,
  };
  const events: RentalCalendarEvent[] = [
    {
      ...base,
      id: "payment:1",
      kind: "payment",
      title: "Расчёт аренды",
      status: "partial",
      amount: 1000,
      paid_amount: 100,
    },
    {
      ...base,
      id: "showing:1",
      kind: "showing",
      title: "Показ квартиры",
      status: "showing",
      source_id: uuid(11),
      starts_at: `${today}T07:30:00Z`,
    },
    {
      ...base,
      id: "move_in:1",
      kind: "move_in",
      title: "Заселение по договору",
      status: "planned",
      estimated: true,
      source_id: uuid(12),
    },
    {
      ...base,
      id: "move_out:1",
      kind: "move_out",
      title: "Передача ключей",
      status: "confirmed",
      source_id: uuid(13),
    },
    {
      ...base,
      id: "repair:1",
      kind: "repair",
      title: "Починить кран",
      status: "in_progress",
      source_id: uuid(14),
    },
    {
      ...base,
      id: "repair:2",
      kind: "repair",
      title: "Проверить отопление",
      status: "approved",
      source_id: uuid(15),
      property_id: otherProperty,
      responsible_id: managerId,
      responsible_name: "Мария Управляющая",
    },
  ];
  return {
    today,
    events,
    mode: "normal",
    truncated: false,
    calls: [] as Record<string, unknown>[],
  };
}
type State = ReturnType<typeof fixture>;
async function install(
  context: BrowserContext,
  state: State,
  identity: "owner" | "manager" = "owner",
) {
  const apiUrl = process.env["E2E_SUPABASE_URL"];
  test.skip(!apiUrl, "Use loopback configuration for intercepted calendar UI tests.");
  const id = identity === "owner" ? ownerId : managerId,
    role = identity === "owner" ? "owner" : "tenant";
  const user = {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: `${identity}@example.invalid`,
    user_metadata: { role, name: identity === "owner" ? "Анна Собственник" : "Мария Управляющая" },
    app_metadata: { provider: "email" },
    created_at: new Date().toISOString(),
  };
  const token = Buffer.from(
    JSON.stringify({ sub: id, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url");
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${token}.fixture`,
    refresh_token: "fixture",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  };
  await context.addInitScript(
    ({ session, key }) => localStorage.setItem(key, JSON.stringify(session)),
    {
      session,
      key: `sb-${new URL(apiUrl!).hostname.split(".")[0]}-auth-token`,
    },
  );
  await context.route("**/auth/v1/**", (route) =>
    route.fulfill({ json: route.request().url().includes("/token") ? session : user }),
  );
  await context.route("**/rest/v1/**", (route) => {
    const resource = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if (resource === "rental_calendar") {
      const body = route.request().postDataJSON();
      state.calls.push(body);
      if (state.mode === "error")
        return route.fulfill({ status: 403, json: { code: "42501", message: "Доступ изменён" } });
      if (state.mode === "missing")
        return route.fulfill({ status: 404, json: { code: "PGRST202", message: "Missing RPC" } });
      if (state.mode === "malformed") return route.fulfill({ json: { events: [] } });
      const events =
        state.mode === "empty"
          ? []
          : state.events.filter(
              (event) =>
                event.date >= body.p_from &&
                event.date < body.p_to &&
                (!body.p_property_id || event.property_id === body.p_property_id) &&
                (!body.p_responsible_id ||
                  (body.p_responsible_id === "00000000-0000-0000-0000-000000000000"
                    ? event.responsible_id === null
                    : event.responsible_id === body.p_responsible_id)),
            );
      return route.fulfill({
        json: {
          from: body.p_from,
          to: body.p_to,
          timezone: body.p_timezone,
          properties: [
            {
              id: propertyId,
              name: "Квартира на Садовой",
              responsible_id: ownerId,
              responsible_name: "Анна Собственник",
            },
            {
              id: otherProperty,
              name: "Дом у парка",
              responsible_id: managerId,
              responsible_name: "Мария Управляющая",
            },
          ],
          events,
          truncated: state.truncated,
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
      return route.fulfill({
        json: { id, name: user.user_metadata.name, email: user.email, phone: null },
      });
    return route.fulfill({ json: [] });
  });
}

test("calendar joins five event types, displays timezone and links to exact actions", async ({
  page,
  context,
}) => {
  const state = fixture();
  await install(context, state);
  await page.goto("/calendar");
  await expect(page.getByRole("heading", { name: "Календарь", exact: true })).toBeVisible();
  const agenda = page.getByRole("region", { name: "Список событий" });
  await expect(agenda.getByTestId("calendar-event")).toHaveCount(6);
  await expect(page.getByText("Время показов: Europe/Moscow.", { exact: false })).toBeVisible();
  await expect(agenda.getByText(/10:30/)).toBeVisible();
  await expect(agenda.getByText("По договору", { exact: true })).toBeVisible();
  await expect(agenda.getByRole("link", { name: "Открыть платёж" })).toHaveAttribute(
    "href",
    `/payments?charge=${uuid(10)}`,
  );
  await expect(agenda.getByRole("link", { name: "Открыть отклик" })).toHaveAttribute(
    "href",
    `/recruitment?application=${uuid(11)}`,
  );
  await expect(agenda.getByRole("link", { name: "Открыть оформление" }).first()).toHaveAttribute(
    "href",
    /agreement=.*kind=move_in/,
  );
  await expect(agenda.getByRole("link", { name: "Открыть ремонт" }).first()).toHaveAttribute(
    "href",
    /property=.*job=/,
  );
  await page.screenshot({ path: "/tmp/nestlink-calendar-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Следующий месяц" }).click();
  await expect(agenda.getByTestId("calendar-event")).toHaveCount(0);
  await page.getByRole("button", { name: "Сегодня", exact: true }).click();
  await expect(agenda.getByTestId("calendar-event")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "Показать весь месяц" })).toBeVisible();
});

test("object and responsible filters are sent to server before truncation; kind and day narrow agenda", async ({
  page,
  context,
}) => {
  const state = fixture();
  await install(context, state);
  await page.goto("/calendar");
  const agenda = page.getByRole("region", { name: "Список событий" });
  await expect(agenda.getByTestId("calendar-event")).toHaveCount(6);
  await page.getByLabel("Объект", { exact: true }).selectOption(otherProperty);
  await expect(agenda.getByTestId("calendar-event")).toHaveCount(1);
  expect(state.calls.at(-1)?.["p_property_id"]).toBe(otherProperty);
  await page.getByLabel("Ответственный по объекту", { exact: true }).selectOption(ownerId);
  await expect(page.getByText("Событий по выбранным условиям нет", { exact: true })).toBeVisible();
  expect(state.calls.at(-1)?.["p_responsible_id"]).toBe(ownerId);
  await page.getByLabel("Объект", { exact: true }).selectOption("");
  await page.getByLabel("Ответственный по объекту", { exact: true }).selectOption("");
  await page.getByLabel("События", { exact: true }).selectOption("showing");
  await expect(agenda.getByTestId("calendar-event")).toHaveCount(1);
  await expect(agenda.getByRole("heading", { name: "Показ квартиры" })).toBeVisible();
});

test("manager lease plans open team workspace; calendar and agenda fit a 320px viewport", async ({
  page,
  context,
}) => {
  const state = fixture();
  state.events = state.events
    .filter((e) => e.kind === "move_in" || e.kind === "repair")
    .map((e) => ({ ...e, access: "team" }));
  await install(context, state, "manager");
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/calendar");
  const agenda = page.getByRole("region", { name: "Список событий" });
  await expect(agenda.getByRole("link", { name: "Открыть объект команды" })).toHaveAttribute(
    "href",
    `/team?property=${propertyId}`,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "/tmp/nestlink-calendar-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Сегодня", exact: true }).click();
  await expect(agenda.getByTestId("calendar-event")).toHaveCount(3);
});

test("error or incomplete calendar hides old events and does not masquerade as an empty month", async ({
  page,
  context,
}) => {
  const state = fixture();
  await install(context, state);
  await page.goto("/calendar");
  await expect(page.getByTestId("calendar-event")).toHaveCount(6);
  state.mode = "error";
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Не удалось загрузить календарь");
  await expect(page.getByTestId("calendar-event")).toHaveCount(0);
  await expect(page.getByText("Событий по выбранным условиям нет", { exact: true })).toHaveCount(0);
  state.mode = "malformed";
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("неполный календарь");
  state.mode = "empty";
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(page.getByText("Событий по выбранным условиям нет", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("missing deployment and capped data have explicit notices", async ({ page, context }) => {
  const state = fixture();
  state.mode = "missing";
  await install(context, state);
  await page.goto("/calendar");
  await expect(page.getByText("Календарь пока недоступен.", { exact: false })).toBeVisible();
  await expect(page.getByRole("table", { name: "Календарь событий" })).toHaveCount(0);
  state.mode = "normal";
  state.truncated = true;
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(page.getByText("Событий слишком много:", { exact: false })).toBeVisible();
  await expect(page.getByTestId("calendar-event")).toHaveCount(6);
});
