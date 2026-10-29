import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCEPTANCE_PROJECT_URL,
  ACCEPTANCE_APP_URL,
  acceptanceBrowserLink,
  acceptanceFixtureIdentity,
  acceptanceMain,
  acceptanceStateDirectory,
  isOutOfScopeDenied,
  parseAcceptanceArgs,
  validateAcceptanceConfig,
} from "../scripts/acceptance-live.mjs";

const runId = "671b270b-df5e-4b2f-9ca4-948eecc42914";
const keys = {
  ACCEPTANCE_SUPABASE_URL: ACCEPTANCE_PROJECT_URL,
  ACCEPTANCE_SERVICE_KEY: "sb_secret_fixture_secret_for_validation",
  ACCEPTANCE_PUBLIC_KEY: "sb_publishable_fixture_key_for_validation",
};

test("live acceptance is opt-in and dry plan does not inspect secrets or call network", async () => {
  assert.equal(parseAcceptanceArgs([]), "plan");
  const forbiddenEnv = new Proxy(
    {},
    {
      get() {
        throw new Error("Environment read");
      },
    },
  );
  const plan = await acceptanceMain([], forbiddenEnv);
  assert.equal(plan.status, "plan");
  assert.equal((await acceptanceMain(["--plan"], forbiddenEnv)).status, "plan");
  for (const args of [["--setup", "--plan"], ["--setup", "--force"], ["--delete"], ["setup"]])
    assert.throws(() => parseAcceptanceArgs(args));
});

test("live acceptance refuses other projects, credential URLs and secret keys in public clients", () => {
  assert.equal(validateAcceptanceConfig(keys).url, ACCEPTANCE_PROJECT_URL);
  for (const url of [
    "http://euuyvfidarhpeqeeheuu.supabase.co",
    "https://elsewhere.supabase.co",
    `${ACCEPTANCE_PROJECT_URL}/`,
    `${ACCEPTANCE_PROJECT_URL}#secret`,
    "https://user:pass@euuyvfidarhpeqeeheuu.supabase.co",
  ])
    assert.throws(() => validateAcceptanceConfig({ ...keys, ACCEPTANCE_SUPABASE_URL: url }));
  assert.throws(() =>
    validateAcceptanceConfig({ ...keys, ACCEPTANCE_PUBLIC_KEY: keys.ACCEPTANCE_SERVICE_KEY }),
  );
  assert.throws(() =>
    validateAcceptanceConfig({ ...keys, ACCEPTANCE_SERVICE_KEY: keys.ACCEPTANCE_PUBLIC_KEY }),
  );
  assert.throws(() =>
    validateAcceptanceConfig({
      ...keys,
      ACCEPTANCE_SERVICE_KEY: ` ${keys.ACCEPTANCE_SERVICE_KEY}`,
    }),
  );
});

test("fixture identities cannot target existing emails, grant admin or escape the private state directory", () => {
  const addresses = ["owner", "tenant", "manager"].map((role) =>
    acceptanceFixtureIdentity(runId, role),
  );
  assert.equal(new Set(addresses.map((identity) => identity.email)).size, 3);
  for (const identity of addresses) {
    assert.match(identity.email, /^acceptance-[a-f0-9-]+-(owner|tenant|manager)@example\.invalid$/);
    assert.notEqual(identity.appRole, "admin");
  }
  assert.equal(addresses[2]!.appRole, "tenant");
  assert.equal(acceptanceStateDirectory(runId), `/tmp/smartrent-acceptance-${runId}`);
  for (const bad of [
    "../existing",
    "",
    "owner@example.com",
    "671b270b-df5e-1b2f-9ca4-948eecc42914",
  ])
    assert.throws(() => acceptanceStateDirectory(bad));
  assert.throws(() => acceptanceFixtureIdentity(runId, "admin"));
});

test("an unrelated property passes scope verification only on explicit permission denial with no data", () => {
  assert.equal(isOutOfScopeDenied({ data: null, error: { code: "42501" } }), true);
  for (const result of [
    { data: { property: { id: "unexpected" } }, error: null },
    { data: null, error: { code: "PGRST202" } },
    { data: null, error: { code: "503" } },
    { data: { private: "data" }, error: { code: "42501" } },
  ])
    assert.equal(isOutOfScopeDenied(result), false);
});

test("browser links accept only the fixture user and exact project's Auth callback into SmartRent", () => {
  const valid = (role = "owner") => {
    const query = new URLSearchParams({
      token: "fixture_one_time_hash_123456789",
      type: "magiclink",
      redirect_to: `${ACCEPTANCE_APP_URL}/${role === "owner" ? "dashboard" : "cabinet"}`,
    });
    return {
      user: { id: runId },
      properties: { action_link: `${ACCEPTANCE_PROJECT_URL}/auth/v1/verify?${query}` },
    };
  };
  for (const role of ["owner", "tenant", "manager"]) {
    const generated = valid(role);
    assert.deepEqual(acceptanceBrowserLink(role, runId, generated), {
      url: generated.properties.action_link,
      user_id: runId,
    });
  }
  const wrongUser = valid();
  wrongUser.user.id = "671b270b-df5e-4b2f-9ca4-948eecc42915";
  assert.throws(() => acceptanceBrowserLink("owner", runId, wrongUser));
  for (const bad of [
    "https://evil.example/auth/v1/verify",
    `${ACCEPTANCE_PROJECT_URL}/other`,
    `https://user:pass@euuyvfidarhpeqeeheuu.supabase.co/auth/v1/verify`,
    `${valid().properties.action_link}&redirect_to=https://evil.example`,
    `${valid().properties.action_link}#token`,
    valid().properties.action_link.replace("type=magiclink", "type=recovery"),
  ]) {
    assert.throws(() =>
      acceptanceBrowserLink("owner", runId, {
        user: { id: runId },
        properties: { action_link: bad },
      }),
    );
  }
  const redirected = valid();
  const url = new URL(redirected.properties.action_link);
  url.searchParams.set("redirect_to", "https://elsewhere.example/dashboard");
  redirected.properties.action_link = url.href;
  assert.throws(() => acceptanceBrowserLink("owner", runId, redirected), {
    message: "acceptance_browser_redirect_unavailable",
  });
});
