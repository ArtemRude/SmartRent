import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { RequestStatus } from "../src/lib/domain";
import type { TeamEvent, TeamMember, TeamOverview, TeamWorkspace } from "../src/lib/team";

type Identity = "owner" | "staff" | "tenant" | "wrong";
const ownerId = "a1000000-0000-0000-0000-000000000001";
const staffId = "a1000000-0000-0000-0000-000000000002";
const tenantId = "a1000000-0000-0000-0000-000000000003";
const propertyId = "a2000000-0000-0000-0000-000000000001";
const otherPropertyId = "a2000000-0000-0000-0000-000000000002";
const invitationToken = "a1".repeat(32);
const noteText = "Проверить отопление перед зимним сезоном";
const commentText = "Мастер приедет завтра с 10 до 12";

function fixture() {
  const now = new Date().toISOString();
  return {
    now,
    available: true,
    staleAction: false,
    workspaceDenied: false,
    members: [] as TeamMember[],
    assignments: [] as TeamOverview["assignments"],
    events: [] as TeamEvent[],
    notes: [] as TeamWorkspace["notes"],
    comments: [] as {
      id: string;
      request_id: string;
      user_id: string;
      text: string;
      created_at: string;
    }[],
    statusEvents: [] as {
      id: string;
      request_id: string;
      from_status: RequestStatus;
      to_status: RequestStatus;
      changed_by: string;
      created_at: string;
    }[],
    properties: [
      {
        id: propertyId,
        owner_id: ownerId,
        name: "Квартира на Садовой",
        address: "Москва, Садовая улица, 12",
        type: "apartment",
        description: "Ключи от технического помещения хранятся у консьержа.",
        status: "active",
        photos: [],
        created_at: now,
      },
      {
        id: otherPropertyId,
        owner_id: ownerId,
        name: "Закрытый склад на Лесной",
        address: "Москва, Лесная улица, 7",
        type: "warehouse",
        description: "Объект не передан команде",
        status: "active",
        photos: [],
        created_at: now,
      },
    ],
    agreement: {
      id: "a4000000-0000-0000-0000-000000000001",
      owner_id: ownerId,
      property_id: propertyId,
      unit_id: "unit-101",
      tenant_id: "tenant-record",
      start_date: `${new Date().getFullYear()}-01-01`,
      end_date: `${new Date().getFullYear() + 1}-12-31`,
      monthly_payment: 60000,
      status: "active",
      document_file: null,
      signed_document_file: null,
      contract_details: {},
      payment_due_day: 15,
      created_at: now,
    },
    request: {
      id: "request-heating",
      owner_id: ownerId,
      property_id: propertyId,
      unit_id: "unit-101",
      tenant_id: "tenant-record",
      title: "Не работает отопление",
      description: "Батарея в спальне остаётся холодной второй день.",
      category: "repair" as const,
      status: "new" as RequestStatus,
      photo: null,
      created_at: now,
    },
  };
}
type State = ReturnType<typeof fixture>;

function invitedMember(state: State): TeamMember {
  return {
    id: "membership-1",
    owner_id: ownerId,
    owner_name: "Анна Собственник",
    email: "staff@example.invalid",
    name: null,
    user_id: null,
    role: "manager",
    status: "invited",
    expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    revision: 1,
    property_ids: [propertyId],
    created_at: state.now,
    joined_at: null,
  };
}
function addEvent(
  state: State,
  action: string,
  actor: Identity,
  detail: TeamEvent["detail"],
  scopedProperty: string | null = null,
) {
  state.events.unshift({
    id: `event-${state.events.length}`,
    owner_id: ownerId,
    property_id: scopedProperty,
    membership_id: state.members[0]?.id ?? null,
    actor_name: actor === "owner" ? "Анна Собственник" : "Мария Управляющая",
    action,
    detail,
    created_at: state.now,
  });
}

async function installApi(
  context: BrowserContext,
  identity: Identity,
  state: State,
  signedIn = true,
) {
  const id =
    identity === "owner"
      ? ownerId
      : identity === "staff"
        ? staffId
        : identity === "tenant"
          ? tenantId
          : "a1000000-0000-0000-0000-000000000004";
  const role = identity === "owner" ? "owner" : "tenant";
  const name =
    identity === "owner"
      ? "Анна Собственник"
      : identity === "staff"
        ? "Мария Управляющая"
        : "Иван Арендатор";
  const user = {
    id,
    email: `${identity}@example.invalid`,
    email_confirmed_at: state.now,
    aud: "authenticated",
    role: "authenticated",
    user_metadata: { role, name },
    app_metadata: { provider: "email" },
    created_at: state.now,
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
  await context.route("**/rest/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const resource = url.pathname.split("/").at(-1)!;
    const body = route.request().method() === "POST" ? route.request().postDataJSON() : {};
    const member = state.members.find((m) => m.user_id === id && m.status === "active");
    const allowed = (target: string) =>
      identity === "owner" || Boolean(member?.property_ids.includes(target));
    const fail = (code: string, message: string, status = 400) =>
      route.fulfill({ status, json: { code, message } });
    if (resource === "team_overview") {
      if (!state.available) return fail("PGRST202", "Function not found", 404);
      const properties = identity === "owner" ? state.properties : [];
      const workspaces = state.properties
        .filter((p) => allowed(p.id))
        .map((p) => ({
          id: p.id,
          name: p.name,
          address: p.address,
          status: p.status,
          owner_id: ownerId,
          owner_name: "Анна Собственник",
          membership_id: identity === "owner" ? null : member!.id,
          role: identity === "owner" ? "owner" : member!.role,
          responsible_name: state.assignments.some((a) => a.property_id === p.id)
            ? "Мария Управляющая"
            : null,
          unit_count: p.id === propertyId ? 1 : 0,
          active_agreements: p.id === propertyId ? 1 : 0,
          open_requests: p.id === propertyId && state.request.status !== "closed" ? 1 : 0,
        }));
      return route.fulfill({
        json: {
          properties,
          members:
            identity === "owner" ? state.members : state.members.filter((m) => m.user_id === id),
          assignments: state.assignments.filter((a) => allowed(a.property_id)),
          workspaces,
          events: identity === "owner" ? state.events : [],
          events_truncated: false,
        },
      });
    }
    if (resource === "team_workspace") {
      if (state.workspaceDenied || !allowed(body.p_property_id))
        return fail("42501", "Доступ к объекту отозван", 403);
      const property = state.properties.find((p) => p.id === body.p_property_id)!;
      return route.fulfill({
        json: {
          property: {
            id: property.id,
            name: property.name,
            address: property.address,
            status: property.status,
            description: property.description,
            owner_id: ownerId,
            owner_name: "Анна Собственник",
            role: identity === "owner" ? "owner" : member!.role,
            responsible_name: state.assignments.some((a) => a.property_id === property.id)
              ? "Мария Управляющая"
              : null,
          },
          units: [{ id: "unit-101", name: "Квартира 101", area: 52, status: "occupied" }],
          agreements: [
            { ...state.agreement, tenant_name: "Иван Арендатор", unit_name: "Квартира 101" },
          ],
          requests: [
            { ...state.request, tenant_name: "Иван Арендатор", unit_name: "Квартира 101" },
          ],
          comments: state.comments.map((c) => ({ ...c, user_name: "Мария Управляющая" })),
          notes: state.notes,
          notes_truncated: false,
          requests_truncated: false,
          comments_truncated: false,
        },
      });
    }
    if (resource === "invite_team_member") {
      const invited = invitedMember(state);
      invited.email = body.p_email;
      invited.role = body.p_role;
      invited.property_ids = body.p_property_ids;
      state.members.push(invited);
      addEvent(state, "invitation_created", identity, {
        email: invited.email,
        role: invited.role,
        property_names: [state.properties[0]!.name],
      });
      return route.fulfill({
        json: {
          membership_id: invited.id,
          token: invitationToken,
          expires_at: invited.expires_at,
        },
      });
    }
    if (resource === "accept_team_invitation") {
      const invited = state.members[0];
      if (!invited || invited.email !== user.email || body.p_token !== invitationToken)
        return fail("42501", "Войдите с email, на который создано приглашение", 403);
      Object.assign(invited, {
        status: "active",
        user_id: id,
        name,
        revision: invited.revision + 1,
        joined_at: state.now,
      });
      addEvent(state, "invitation_accepted", identity, { email: user.email });
      return route.fulfill({ json: invited.id });
    }
    if (resource === "manage_team_member") {
      const target = state.members.find((m) => m.id === body.p_membership_id)!;
      if (body.p_revision !== target.revision)
        return fail("40001", "Доступ изменился. Обновите данные и повторите действие");
      target.role = body.p_role;
      target.property_ids = body.p_property_ids;
      target.revision++;
      if (body.p_revoke) target.status = "revoked";
      if (body.p_revoke || target.role === "viewer") state.assignments = [];
      addEvent(state, body.p_revoke ? "member_revoked" : "member_updated", identity, {
        email: target.email,
        role: target.role,
      });
      return route.fulfill({ json: target.id });
    }
    if (resource === "set_team_responsible") {
      state.assignments = body.p_membership_id
        ? [{ property_id: body.p_property_id, membership_id: body.p_membership_id }]
        : [];
      addEvent(
        state,
        "responsible_changed",
        identity,
        { name: "Мария Управляющая" },
        body.p_property_id,
      );
      return route.fulfill({ json: body.p_property_id });
    }
    if (resource === "act_on_team_property") {
      if (!allowed(body.p_property_id) || (identity !== "owner" && member?.role !== "manager"))
        return fail("42501", "Недостаточно прав для изменения объекта", 403);
      if (state.staleAction)
        return fail("40001", "Заявка уже изменилась. Обновите данные и повторите действие");
      const values = body.p_values;
      if (body.p_action === "note")
        state.notes.unshift({
          id: "note-1",
          text: values.text,
          actor_name: name,
          created_at: state.now,
        });
      if (body.p_action === "request_status") {
        state.statusEvents.push({
          id: "status-1",
          request_id: state.request.id,
          from_status: state.request.status,
          to_status: values.status,
          changed_by: id,
          created_at: state.now,
        });
        state.request.status = values.status;
      }
      if (body.p_action === "request_comment")
        state.comments.push({
          id: "comment-1",
          request_id: state.request.id,
          user_id: id,
          text: values.text,
          created_at: state.now,
        });
      addEvent(
        state,
        body.p_action === "note" ? "property_note" : body.p_action,
        identity,
        body.p_action === "request_status"
          ? { title: state.request.title, from: values.expected_status, to: values.status }
          : { text: values.text },
        body.p_property_id,
      );
      return route.fulfill({ json: "ok" });
    }
    const tables: Record<string, unknown> = {
      profiles: { id, name, email: user.email, phone: null },
      user_roles: { role },
      properties: identity === "owner" ? state.properties : [state.properties[0]],
      units: [
        {
          id: "unit-101",
          property_id: propertyId,
          name: "Квартира 101",
          area: 52,
          status: "occupied",
          created_at: state.now,
        },
      ],
      tenants: [
        {
          id: "tenant-record",
          owner_id: ownerId,
          user_id: tenantId,
          name: "Иван Арендатор",
          email: "tenant@example.invalid",
          phone: null,
          created_at: state.now,
        },
      ],
      lease_agreements: [state.agreement],
      requests: [state.request],
      comments: state.comments,
      request_status_events: state.statusEvents,
      notifications: [],
      lease_amendments: [],
    };
    return route.fulfill({ json: tables[resource] ?? [] });
  });
}

async function noOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
}

test("owner invites a scoped manager, tenant account joins, works on requests and loses access live", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  test.skip(!process.env["E2E_SUPABASE_URL"], "Use loopback intercepted API.");
  const state = fixture();
  const ownerContext = await browser.newContext();
  const staffContext = await browser.newContext();
  const tenantContext = await browser.newContext();
  await installApi(ownerContext, "owner", state);
  await installApi(staffContext, "staff", state, false);
  await installApi(tenantContext, "tenant", state);
  const owner = await ownerContext.newPage();
  const staff = await staffContext.newPage();
  const tenant = await tenantContext.newPage();
  const errors: string[] = [];
  for (const page of [owner, staff, tenant]) page.on("pageerror", (e) => errors.push(e.message));
  await owner.goto("/team");
  await owner.getByRole("button", { name: "Пригласить", exact: true }).click();
  await owner.getByLabel("Email сотрудника").fill("staff@example.invalid");
  await owner.getByLabel("Роль в команде").selectOption("manager");
  await owner.getByRole("checkbox", { name: /Квартира на Садовой/ }).check();
  await expect(owner.getByRole("checkbox", { name: /Закрытый склад/ })).not.toBeChecked();
  await owner.getByRole("button", { name: "Создать приглашение", exact: true }).click();
  await expect(owner.getByRole("heading", { name: "Передайте ссылку сотруднику" })).toBeVisible();
  await expect(owner.getByRole("dialog")).toContainText("Письмо не отправляется");
  const link = await owner.getByLabel("Ссылка приглашения").inputValue();
  expect(link).toMatch(/\/join-team#invite=[a-f0-9]{64}$/);
  await owner.getByRole("button", { name: "Готово", exact: true }).click();
  await staff.goto(link);
  await expect(staff).toHaveURL(/\/auth\?/);
  expect(await staff.evaluate(() => sessionStorage.getItem("nestlink-team-invite"))).toBe(
    invitationToken,
  );
  expect(new URL(staff.url()).hash).toBe("");
  await staff.getByLabel("Email", { exact: true }).fill("staff@example.invalid");
  await staff.getByLabel("Пароль", { exact: true }).fill("fixture-password-123");
  await staff.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(staff).toHaveURL(/\/team$/);
  await staff.getByRole("button", { name: "Принять приглашение", exact: true }).click();
  await expect(staff.getByTestId("team-workspace")).toBeVisible();
  expect(await staff.evaluate(() => sessionStorage.getItem("nestlink-team-invite"))).toBeNull();
  await expect(staff.getByLabel("Объект для совместной работы").locator("option")).toHaveCount(1);
  await expect(staff.getByText("Закрытый склад на Лесной", { exact: true })).toHaveCount(0);
  await expect(staff.getByRole("button", { name: "Пригласить", exact: true })).toHaveCount(0);
  await expect(staff.getByTestId("team-workspace")).toContainText("Ваша роль: Управляющий");
  const memberCard = owner.getByRole("article", { name: "Участник staff@example.invalid" });
  await expect(memberCard.getByText("Активен", { exact: true })).toBeVisible({ timeout: 12000 });
  await owner.getByLabel("Ответственный по объекту").selectOption("membership-1");
  await owner.getByRole("button", { name: "Назначить", exact: true }).click();
  await expect(staff.getByTestId("team-workspace")).toContainText(
    "Ответственный: Мария Управляющая",
    { timeout: 12000 },
  );
  await staff.getByLabel("Новая заметка").fill(noteText);
  await staff.getByRole("button", { name: "Сохранить заметку", exact: true }).click();
  await expect(
    staff.getByTestId("team-workspace").getByText(noteText, { exact: true }),
  ).toBeVisible();
  const requestCard = staff.getByRole("article", { name: state.request.title });
  await requestCard.getByLabel("Статус заявки").selectOption("in_progress");
  await requestCard.getByRole("button", { name: "Сохранить статус", exact: true }).click();
  await expect(requestCard.getByRole("status")).toHaveText("В работе");
  await requestCard.getByLabel("Комментарий к заявке").fill(commentText);
  await requestCard.getByRole("button", { name: "Добавить комментарий", exact: true }).click();
  await expect(requestCard.getByText(commentText, { exact: true })).toBeVisible();
  await expect(owner.getByText("Изменён статус заявки", { exact: true })).toBeVisible({
    timeout: 12000,
  });
  await expect(owner.getByText("Комментарий к заявке", { exact: true }).last()).toBeVisible();
  await expect(owner.getByText("Приглашение принято", { exact: true })).toBeVisible();
  await expect(owner.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 10000 });
  for (const page of [owner, staff]) {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  }
  await owner.screenshot({ path: "test-results/team-owner.png", fullPage: true });
  await staff.screenshot({ path: "test-results/team-manager.png", fullPage: true });
  await staff.setViewportSize({ width: 375, height: 850 });
  await noOverflow(staff);
  await expect(staff.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 10000 });
  await staff.screenshot({ path: "test-results/team-mobile.png", fullPage: true });
  await staff.setViewportSize({ width: 1280, height: 900 });
  // The team's writes are canonical: existing owner and tenant request pages receive them.
  for (const page of [owner, tenant]) {
    await page.goto("/requests");
    await page.getByRole("button", { name: new RegExp(state.request.title) }).click();
    await expect(page.getByRole("dialog").getByText(commentText, { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("Статус изменён: «Новая» → «В работе»");
    await expect(page.getByRole("dialog")).toContainText("Представитель собственника");
  }
  expect(state.comments[0]!.user_id).toBe(staffId);
  expect(state.statusEvents[0]!.changed_by).toBe(staffId);
  await owner.goto("/team");
  await memberCard.getByRole("button", { name: "Изменить доступ", exact: true }).click();
  await owner.getByLabel("Роль в команде").selectOption("viewer");
  await owner.getByRole("button", { name: "Сохранить доступ", exact: true }).click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  await expect(staff.getByText("У вас доступ для просмотра.", { exact: false })).toBeVisible({
    timeout: 12000,
  });
  await expect(staff.getByLabel("Новая заметка")).toHaveCount(0);
  await expect(staff.getByRole("button", { name: "Сохранить статус", exact: true })).toHaveCount(0);
  await expect(
    staff.getByRole("button", { name: "Добавить комментарий", exact: true }),
  ).toHaveCount(0);
  await expect(staff.getByText(commentText, { exact: true })).toBeVisible();
  await memberCard.getByRole("button", { name: "Отозвать доступ", exact: true }).click();
  await owner
    .getByRole("dialog")
    .getByRole("button", { name: "Отозвать доступ", exact: true })
    .click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  await expect(staff.getByTestId("team-workspace")).toHaveCount(0, { timeout: 12000 });
  await expect(staff.getByText("Нет доступных объектов.", { exact: false })).toBeVisible();
  await expect(staff.getByText(noteText, { exact: true })).toHaveCount(0);
  await expect(staff.getByText(commentText, { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
  for (const context of [ownerContext, staffContext, tenantContext]) await context.close();
});

test("team surfaces stale writes and hides cached details when access refresh fails", async ({
  browser,
}) => {
  test.skip(!process.env["E2E_SUPABASE_URL"], "Use loopback intercepted API.");
  const state = fixture();
  const member = invitedMember(state);
  Object.assign(member, { status: "active", user_id: staffId, name: "Мария Управляющая" });
  state.members.push(member);
  const context = await browser.newContext();
  await installApi(context, "staff", state);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/team");
  const requestCard = page.getByRole("article", { name: state.request.title });
  await requestCard.getByLabel("Статус заявки").selectOption("in_progress");
  state.staleAction = true;
  await requestCard.getByRole("button", { name: "Сохранить статус", exact: true }).click();
  await expect(requestCard.getByRole("alert")).toContainText("Заявка уже изменилась");
  expect(state.request.status).toBe("new");
  await expect(page.getByText("Статус обновлён", { exact: true })).toHaveCount(0);
  state.workspaceDenied = true;
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(page.getByTestId("team-workspace")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("Доступ к объекту отозван");
  expect(errors).toEqual([]);
  await context.close();
});

test("team invitation rejects another email and missing RPC shows a friendly state", async ({
  browser,
}) => {
  test.skip(!process.env["E2E_SUPABASE_URL"], "Use loopback intercepted API.");
  const state = fixture();
  state.members.push(invitedMember(state));
  const context = await browser.newContext();
  await installApi(context, "wrong", state);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/join-team#invite=${invitationToken}`);
  await page.getByRole("button", { name: "Принять приглашение", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Войдите с email, на который создано приглашение",
  );
  await expect(page.getByTestId("team-workspace")).toHaveCount(0);
  expect(state.members[0]!.status).toBe("invited");
  await page.getByRole("button", { name: "Убрать приглашение", exact: true }).click();
  state.available = false;
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(page.getByText("Раздел команды пока недоступен.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Пригласить", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});
