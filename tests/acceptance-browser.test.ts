import assert from "node:assert/strict";
import { test } from "node:test";
import { validateBrowserCallback, validateBrowserFixture } from "../scripts/acceptance-browser.mjs";
const run = "671b270b-df5e-4b2f-9ca4-948eecc42914";
const user = "10000000-0000-4000-8000-000000000001";
const url =
  "https://euuyvfidarhpeqeeheuu.supabase.co/auth/v1/verify?token=fixture_browser_token_123456&type=magiclink&redirect_to=" +
  encodeURIComponent("https://mysmartrent.lovable.app/dashboard");
test("fixture browser redirects cannot target other accounts, hosts or redirect destinations", () => {
  assert.equal(validateBrowserCallback({ url, user_id: user }, "owner", user), url);
  for (const changed of [
    url.replace("supabase.co", "evil.example"),
    url.replace(/token=[^&]+/, "token="),
    url.replace("magiclink", "recovery"),
    url.replace("dashboard", "billing"),
    url.replace("https://euuy", "https://user:pass@euuy"),
  ])
    assert.throws(() => validateBrowserCallback({ url: changed, user_id: user }, "owner", user));
  assert.throws(() => validateBrowserCallback({ url, user_id: "other" }, "owner", user));
  assert.throws(() => validateBrowserCallback({ url, user_id: user }, "__proto__", user));
});
test("fixture browser accepts only the dedicated state path and all three fresh test identities", () => {
  const fixture = {
    version: 1,
    status: "ready",
    run_id: run,
    project_url: "https://euuyvfidarhpeqeeheuu.supabase.co",
    users: Object.fromEntries(
      ["owner", "tenant", "manager"].map((role) => [
        role,
        { id: user, email: `acceptance-${run}-${role}@example.invalid` },
      ]),
    ),
    property: { owner_id: user, name: `ТЕСТ ПРИЁМКИ ${run}` },
  };
  assert.doesNotThrow(() => validateBrowserFixture(fixture, `/tmp/smartrent-acceptance-${run}`));
  assert.throws(() => validateBrowserFixture(fixture, "/tmp/other"));
  fixture.users.tenant!.email = "real@example.com";
  assert.throws(() => validateBrowserFixture(fixture, `/tmp/smartrent-acceptance-${run}`));
});
