import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ACCEPTANCE_PROJECT_URL = "https://euuyvfidarhpeqeeheuu.supabase.co";
export const ACCEPTANCE_APP_URL = "https://mysmartrent.lovable.app";
const UNRELATED_PROPERTY_ID = "9fa20c52-87d0-4f76-9fef-453a2b5b25b0";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const roles = ["owner", "tenant", "manager"];

export function parseAcceptanceArgs(args) {
  if (args.length === 0 || (args.length === 1 && ["--plan", "--help"].includes(args[0])))
    return "plan";
  if (args.length === 1 && args[0] === "--setup") return "setup";
  throw new Error("acceptance_arguments_invalid");
}

function legacyKeyRole(key) {
  try {
    const parts = key.split(".");
    if (parts.length !== 3 || !parts.every(Boolean)) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).role;
  } catch {
    return null;
  }
}

export function validateAcceptanceConfig(env) {
  const url = env.ACCEPTANCE_SUPABASE_URL;
  // Exact match also excludes userinfo, extra paths, fragments, HTTP and other projects.
  if (url !== ACCEPTANCE_PROJECT_URL) throw new Error("acceptance_configuration_invalid");
  const serviceKey = env.ACCEPTANCE_SERVICE_KEY;
  const publicKey = env.ACCEPTANCE_PUBLIC_KEY;
  if (
    typeof serviceKey !== "string" ||
    serviceKey.length < 24 ||
    serviceKey !== serviceKey.trim() ||
    !(serviceKey.startsWith("sb_secret_") || legacyKeyRole(serviceKey) === "service_role") ||
    typeof publicKey !== "string" ||
    publicKey.length < 24 ||
    publicKey !== publicKey.trim() ||
    !(publicKey.startsWith("sb_publishable_") || legacyKeyRole(publicKey) === "anon")
  )
    throw new Error("acceptance_configuration_invalid");
  return { url, serviceKey, publicKey };
}

export function acceptanceFixtureIdentity(runId, role) {
  if (!UUID.test(runId) || !roles.includes(role)) throw new Error("acceptance_identity_invalid");
  return {
    email: `acceptance-${runId}-${role}@example.invalid`,
    appRole: role === "owner" ? "owner" : "tenant",
    name: {
      owner: "Приёмка: собственник",
      tenant: "Приёмка: арендатор",
      manager: "Приёмка: управляющий",
    }[role],
  };
}

export function acceptanceStateDirectory(runId) {
  if (!UUID.test(runId)) throw new Error("acceptance_identity_invalid");
  return join("/tmp", `smartrent-acceptance-${runId}`);
}

export function isOutOfScopeDenied(result) {
  return Boolean(result?.error?.code === "42501" && result.data == null);
}

export function acceptanceBrowserLink(role, fixtureUserId, generated) {
  if (!roles.includes(role) || !UUID.test(fixtureUserId) || generated?.user?.id !== fixtureUserId)
    throw new Error("acceptance_browser_link_invalid");
  let link;
  try {
    link = new URL(generated.properties.action_link);
  } catch {
    throw new Error("acceptance_browser_link_invalid");
  }
  const expectedRedirect = `${ACCEPTANCE_APP_URL}/${role === "owner" ? "dashboard" : "cabinet"}`;
  if (
    link.origin !== ACCEPTANCE_PROJECT_URL ||
    link.pathname !== "/auth/v1/verify" ||
    link.username ||
    link.password ||
    link.hash ||
    [...link.searchParams.keys()].some((key) => !["token", "type", "redirect_to"].includes(key)) ||
    link.searchParams.getAll("token").length !== 1 ||
    !/^[A-Za-z0-9_-]{16,256}$/.test(link.searchParams.get("token") ?? "") ||
    link.searchParams.getAll("type").length !== 1 ||
    !["magiclink", "email"].includes(link.searchParams.get("type"))
  )
    throw new Error("acceptance_browser_link_invalid");
  if (
    link.searchParams.getAll("redirect_to").length !== 1 ||
    link.searchParams.get("redirect_to") !== expectedRedirect
  )
    throw new Error("acceptance_browser_redirect_unavailable");
  return { url: link.href, user_id: fixtureUserId };
}

async function writePrivateJson(directory, name, value) {
  const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  await rename(temporary, join(directory, name));
}

function requireResult(result) {
  if (result.error || result.data == null) throw new Error("acceptance_operation_failed");
  return result.data;
}

/** Explicit operator-only fixture setup. No existing account or data is modified. */
export async function setupAcceptanceFixture(config) {
  // Revalidate exported entrypoint input, not just CLI env, before any I/O.
  config = validateAcceptanceConfig({
    ACCEPTANCE_SUPABASE_URL: config.url,
    ACCEPTANCE_SERVICE_KEY: config.serviceKey,
    ACCEPTANCE_PUBLIC_KEY: config.publicKey,
  });
  const { createClient } = await import("@supabase/supabase-js");
  const runId = randomUUID();
  const directory = acceptanceStateDirectory(runId);
  await mkdir(directory, { mode: 0o700 });
  const manifest = {
    version: 1,
    run_id: runId,
    project_url: ACCEPTANCE_PROJECT_URL,
    created_at: new Date().toISOString(),
    status: "setting_up",
    stage: "initializing",
    users: {},
    property: null,
    membership_id: null,
    checks: {},
  };
  const persist = () => writePrivateJson(directory, "manifest.json", manifest);
  const stage = async (value) => {
    manifest.stage = value;
    await persist();
  };
  const options = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init = {}) =>
        fetch(input, {
          ...init,
          signal: init.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)])
            : AbortSignal.timeout(15_000),
        }),
    },
  };
  // This client is used for admin Auth only. It never signs in or accepts a session.
  const admin = createClient(config.url, config.serviceKey, options);
  const clients = {};
  await persist();
  try {
    for (const role of roles) {
      const identity = acceptanceFixtureIdentity(runId, role);
      await stage(`creating_${role}`);
      const result = await admin.auth.admin.createUser({
        email: identity.email,
        email_confirm: true,
        user_metadata: { role: identity.appRole, name: identity.name },
      });
      const created = requireResult(result).user;
      if (!created?.id || created.email !== identity.email || !created.email_confirmed_at)
        throw new Error("acceptance_operation_failed");
      manifest.users[role] = { id: created.id, email: identity.email, app_role: identity.appRole };
      await persist();
      await stage(`authenticating_${role}`);
      const generated = requireResult(
        await admin.auth.admin.generateLink({ type: "magiclink", email: identity.email }),
      );
      if (
        generated.user?.id !== created.id ||
        typeof generated.properties?.hashed_token !== "string"
      )
        throw new Error("acceptance_operation_failed");
      // New public client per fixture user; no service key is present in its requests.
      const client = createClient(config.url, config.publicKey, options);
      const verified = requireResult(
        await client.auth.verifyOtp({
          type: "email",
          token_hash: generated.properties.hashed_token,
        }),
      );
      if (
        !verified.session?.access_token ||
        legacyKeyRole(verified.session.access_token) !== "authenticated" ||
        verified.session.user.id !== created.id ||
        verified.user?.id !== created.id
      )
        throw new Error("acceptance_operation_failed");
      await writePrivateJson(directory, `${role}-session.json`, verified.session);
      clients[role] = client;
      manifest.users[role].session_file = `${role}-session.json`;
      await persist();
      // Check real server-assigned roles, not user-editable JWT metadata.
      const assigned = requireResult(
        await client.from("user_roles").select("role").eq("user_id", created.id),
      );
      if (
        !Array.isArray(assigned) ||
        assigned.length !== 1 ||
        assigned[0]?.role !== identity.appRole
      )
        throw new Error("acceptance_operation_failed");
      manifest.checks[`${role}_server_role`] = true;
      await persist();
      if (role === "owner") {
        await stage("checking_billing");
        const billing = requireResult(await client.rpc("billing_overview"));
        manifest.checks.billing_mode = billing.mode;
        await persist();
        // A fresh enforced trial has no team seats. Do not enable, pause or override billing.
        if (billing.mode !== "prelaunch") throw new Error("acceptance_billing_unavailable");
      }
    }
    await stage("creating_property");
    const name = `ТЕСТ ПРИЁМКИ ${runId}`;
    const property = requireResult(
      await clients.owner
        .from("properties")
        .insert({
          owner_id: manifest.users.owner.id,
          name,
          type: "apartment",
          address: "Тестовый объект — адрес не существует",
          description:
            "Изолированные данные приёмки SmartRent. Не является предложением реальной недвижимости.",
          photos: [],
          status: "active",
        })
        .select("id,owner_id,name")
        .single(),
    );
    if (
      property.owner_id !== manifest.users.owner.id ||
      property.name !== name ||
      property.id === UNRELATED_PROPERTY_ID
    )
      throw new Error("acceptance_operation_failed");
    manifest.property = { id: property.id, owner_id: property.owner_id, name: property.name };
    await persist();
    await stage("inviting_manager");
    const invitation = requireResult(
      await clients.owner.rpc("invite_team_member", {
        p_email: manifest.users.manager.email,
        p_role: "manager",
        p_property_ids: [property.id],
      }),
    );
    if (typeof invitation.membership_id !== "string" || !/^[a-f0-9]{64}$/.test(invitation.token))
      throw new Error("acceptance_operation_failed");
    manifest.membership_id = invitation.membership_id;
    await persist();
    await stage("accepting_manager_invitation");
    const accepted = requireResult(
      await clients.manager.rpc("accept_team_invitation", { p_token: invitation.token }),
    );
    if (accepted !== invitation.membership_id) throw new Error("acceptance_operation_failed");
    manifest.checks.manager_invitation_accepted = true;
    await persist();
    await stage("checking_manager_scope");
    const workspace = requireResult(
      await clients.manager.rpc("team_workspace", { p_property_id: property.id }),
    );
    if (
      workspace.property?.id !== property.id ||
      workspace.property?.owner_id !== manifest.users.owner.id ||
      workspace.property?.role !== "manager"
    )
      throw new Error("acceptance_operation_failed");
    manifest.checks.manager_fixture_access = true;
    await persist();
    const denied = await clients.manager.rpc("team_workspace", {
      p_property_id: UNRELATED_PROPERTY_ID,
    });
    if (!isOutOfScopeDenied(denied)) throw new Error("acceptance_operation_failed");
    // Only the denial result is recorded; unrelated property data is never persisted or printed.
    manifest.checks.manager_unrelated_property_denied = true;
    const browserLinks = {};
    manifest.browser_link_status = {};
    for (const role of roles) {
      await stage(`preparing_${role}_browser_link`);
      const generated = requireResult(
        await admin.auth.admin.generateLink({
          type: "magiclink",
          email: manifest.users[role].email,
          options: {
            redirectTo: `${ACCEPTANCE_APP_URL}/${role === "owner" ? "dashboard" : "cabinet"}`,
          },
        }),
      );
      try {
        browserLinks[role] = acceptanceBrowserLink(role, manifest.users[role].id, generated);
        manifest.browser_link_status[role] = "ready";
        await writePrivateJson(directory, "browser-links.json", browserLinks);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "acceptance_browser_redirect_unavailable"
        )
          throw error;
        // Do not change the project's public Auth redirect settings for a test.
        manifest.browser_link_status[role] = "browser_redirect_unavailable";
        manifest.checks.browser_redirect_unavailable = true;
      }
      await persist();
    }
    manifest.checks.browser_links_ready = Object.keys(browserLinks).length === roles.length;
    manifest.status = "ready";
    manifest.stage = "complete";
    await persist();
    return {
      status: "ready",
      state_dir: directory,
      user_count: 3,
      property_count: 1,
      manager_scoped: true,
      browser_links_ready: manifest.checks.browser_links_ready,
    };
  } catch (error) {
    manifest.status = "failed";
    manifest.failure =
      error instanceof Error && error.message === "acceptance_billing_unavailable"
        ? "billing_not_prelaunch"
        : "setup_failed";
    await persist();
    return {
      status: "failed",
      state_dir: directory,
      stage: manifest.stage,
      error: manifest.failure,
    };
  }
}

export async function acceptanceMain(args, env) {
  const mode = parseAcceptanceArgs(args);
  if (mode === "plan")
    return {
      status: "plan",
      project_url: ACCEPTANCE_PROJECT_URL,
      creates: [
        "three_fresh_passwordless_fixture_users",
        "one_isolated_property",
        "one_scoped_manager_membership",
        "private_one_use_browser_links",
      ],
      checks: [
        "server_assigned_roles",
        "prelaunch_billing",
        "manager_fixture_access",
        "unrelated_property_denied",
        "browser_callback_origin_and_redirect",
      ],
      does_not: [
        "send_email",
        "connect_telegram",
        "publish_listings",
        "create_contracts",
        "record_payments",
        "change_existing_users",
        "delete_users",
      ],
      setup_command: "node scripts/acceptance-live.mjs --setup",
    };
  return setupAcceptanceFixture(validateAcceptanceConfig(env));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await acceptanceMain(process.argv.slice(2), process.env);
    console.log(JSON.stringify(result));
    if (result.status === "failed") process.exitCode = 1;
  } catch {
    // Do not expose raw Auth/REST/provider errors or secrets in command output.
    console.log(
      JSON.stringify({ status: "rejected", error: "invalid_configuration_or_local_setup" }),
    );
    process.exitCode = 1;
  }
}
