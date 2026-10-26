import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTelegramHandler,
  telegramDestination,
} from "../supabase/functions/_shared/telegram.ts";

const env = {
  SUPABASE_URL: "https://fixture.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_fixture",
  TELEGRAM_WEBHOOK_SECRET: "w".repeat(40),
  TELEGRAM_WORKER_SECRET: "d".repeat(40),
  TELEGRAM_BOT_TOKEN: "12345:" + "x".repeat(30),
  APP_URL: "https://smartrent.example/app",
};
const id = "10000000-0000-0000-0000-000000000001";
const claim = "20000000-0000-0000-0000-000000000001";
type Call = { url: string; body: Record<string, unknown>; headers: Headers };
function fixture(
  send: (call: Call) => Response | Promise<Response> = () =>
    Response.json({ ok: true, result: { message_id: 17 } }),
) {
  const calls: Call[] = [];
  let actionLabel: string | undefined;
  let actionHref = "/team";
  let claimed = false;
  let ackFails = false;
  const fetcher: typeof fetch = async (input, init) => {
    const call = {
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")),
      headers: new Headers(init?.headers),
    };
    calls.push(call);
    if (call.url.endsWith("/claim_telegram_deliveries")) {
      if (claimed) return Response.json([]);
      claimed = true;
      return Response.json([
        {
          id,
          claim_token: claim,
          chat_id: "12345678",
          kind: "object_activity",
          href: actionHref,
          event_label: actionLabel,
        },
      ]);
    }
    if (call.url.endsWith("/finish_telegram_delivery")) {
      if (ackFails) return Response.json({}, { status: 503 });
      return Response.json(null);
    }
    if (call.url.includes("api.telegram.org")) return send(call);
    return Response.json({ result: "pending" });
  };
  return {
    setAction: (label: string, href: string) => {
      actionLabel = label;
      actionHref = href;
    },
    calls,
    fetcher,
    failAck: () => {
      ackFails = true;
    },
  };
}
function request(mode: "webhook" | "dispatch", body: unknown = {}, secret?: string) {
  return new Request("https://functions.example/telegram-" + mode, {
    method: "POST",
    headers: {
      [mode === "webhook" ? "X-Telegram-Bot-Api-Secret-Token" : "X-Telegram-Worker-Secret"]:
        secret ?? (mode === "webhook" ? env.TELEGRAM_WEBHOOK_SECRET : env.TELEGRAM_WORKER_SECRET),
    },
    body: JSON.stringify(body),
  });
}
function update(text = "/start " + "a".repeat(64)) {
  return {
    update_id: 42,
    message: {
      text,
      chat: { id: 12345678, type: "private" },
      from: { id: 12345678, is_bot: false, username: "fixture_user" },
    },
  };
}

test("Telegram endpoints reject absent/wrong/cross-endpoint secrets before any network access", async () => {
  const f = fixture();
  for (const mode of ["webhook", "dispatch"] as const) {
    const handler = createTelegramHandler(mode, env, f.fetcher);
    assert.equal((await handler(new Request("https://example", { method: "POST" }))).status, 401);
    assert.equal((await handler(request(mode, {}, "incorrect"))).status, 401);
    assert.equal(
      (
        await handler(
          request(
            mode,
            {},
            mode === "webhook" ? env.TELEGRAM_WORKER_SECRET : env.TELEGRAM_WEBHOOK_SECRET,
          ),
        )
      ).status,
      401,
    );
    assert.equal((await handler(new Request("https://example"))).status, 405);
  }
  assert.equal(f.calls.length, 0);
});
test("private start and stop forward only validated identity to service RPC, opaque server key is not a bearer", async () => {
  const f = fixture();
  const handler = createTelegramHandler("webhook", env, f.fetcher);
  const response = await handler(request("webhook", update()));
  assert.equal(response.status, 200);
  const setup = await response.json();
  assert.equal(setup.method, "sendMessage");
  assert.match(setup.text, /До подтверждения/);
  assert.equal(setup.chat_id, "12345678");
  assert.equal(JSON.stringify(setup).includes("a".repeat(64)), false);
  assert.equal(f.calls[0]?.body["p_chat_id"], "12345678");
  assert.equal(f.calls[0]?.body["p_token"], "a".repeat(64));
  assert.equal(f.calls[0]?.headers.get("Authorization"), null);
  await handler(request("webhook", update("/stop")));
  assert.equal(f.calls[1]?.body["p_stop"], true);
});
test("groups, forwarded messages, bots, mismatched sender, arbitrary commands and malformed updates cannot pair", async () => {
  const f = fixture();
  const handler = createTelegramHandler("webhook", env, f.fetcher);
  const variants = [
    { ...update(), message: { ...update().message, chat: { id: -7, type: "group" } } },
    { ...update(), message: { ...update().message, forward_origin: { type: "user" } } },
    { ...update(), message: { ...update().message, from: { id: 12345678, is_bot: true } } },
    { ...update(), message: { ...update().message, from: { id: 87654321, is_bot: false } } },
    update("/pay 100"),
    update("/start guess"),
  ];
  for (const value of variants)
    assert.equal((await handler(request("webhook", value))).status, 200);
  assert.equal((await handler(request("webhook", {}))).status, 400);
  assert.equal(f.calls.length, 0);
});
test("webhook bounds request size and retries server RPC failures without exposing secrets", async () => {
  const f = fixture();
  const handler = createTelegramHandler("webhook", env, f.fetcher);
  assert.equal((await handler(request("webhook", { padding: "x".repeat(17_000) }))).status, 400);
  const broken = createTelegramHandler("webhook", env, async () => {
    throw new Error("token=secret");
  });
  const response = await broken(request("webhook", update()));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /secret|12345678/);
});
test("dispatcher claims one item, sends generic message and safe cabinet link, then acknowledges with fenced token", async () => {
  const f = fixture();
  const response = await createTelegramHandler("dispatch", env, f.fetcher)(request("dispatch"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, processed: 1 });
  const send = f.calls.find((c) => c.url.includes("api.telegram.org"))!;
  assert.match(String(send.body["text"]), /Новое действие по объекту/);
  assert.equal(send.body["parse_mode"], undefined);
  assert.equal(JSON.stringify(send.body).includes("secret"), false);
  assert.deepEqual(send.body["reply_markup"], {
    inline_keyboard: [[{ text: "Открыть в кабинете", url: "https://smartrent.example/team" }]],
  });
  const ack = f.calls.find((c) => c.url.endsWith("/finish_telegram_delivery"))!;
  assert.equal(ack.body["p_outcome"], "sent");
  assert.equal(ack.body["p_claim_token"], claim);
  assert.equal(ack.body["p_message_id"], 17);
});
for (const [code, expected, error] of [
  [429, "retry", "telegram_429"],
  [503, "retry", "telegram_503"],
  [403, "failed", "telegram_403"],
  [400, "failed", "telegram_rejected"],
] as const) {
  test(`Telegram definitive ${code} becomes ${expected} with safe error code`, async () => {
    const f = fixture(() =>
      Response.json(
        {
          ok: false,
          error_code: code,
          description: "private Telegram detail",
          parameters: { retry_after: 125 },
        },
        { status: code },
      ),
    );
    await createTelegramHandler("dispatch", env, f.fetcher)(request("dispatch"));
    const ack = f.calls.find((c) => c.url.endsWith("/finish_telegram_delivery"))!;
    assert.equal(ack.body["p_outcome"], expected);
    assert.equal(ack.body["p_error_code"], error);
    assert.equal(ack.body["p_retry_after"], code === 429 ? 125 : null);
    assert.doesNotMatch(JSON.stringify(ack.body), /private Telegram detail/);
  });
}
for (const [label, send] of [
  [
    "network timeout",
    async () => {
      throw new Error("timeout");
    },
  ],
  ["malformed success", () => new Response("broken json", { status: 200 })],
  ["unconfirmed response", () => Response.json({ ok: true })],
  ["gateway failure", () => new Response("upstream failed", { status: 502 })],
] as const) {
  test(`${label} is terminal uncertain, never blind retry`, async () => {
    const f = fixture(send);
    await createTelegramHandler("dispatch", env, f.fetcher)(request("dispatch"));
    const ack = f.calls.find((c) => c.url.endsWith("/finish_telegram_delivery"))!;
    assert.equal(ack.body["p_outcome"], "uncertain");
    assert.equal(f.calls.filter((c) => c.url.includes("api.telegram.org")).length, 1);
  });
}
test("failed acknowledgement does not resend the message within invocation", async () => {
  const f = fixture();
  f.failAck();
  const response = await createTelegramHandler("dispatch", env, f.fetcher)(request("dispatch"));
  assert.equal(response.status, 503);
  assert.equal(f.calls.filter((c) => c.url.includes("api.telegram.org")).length, 1);
});

test("object action carries only allowlisted label and links to the exact accessible object", async () => {
  const f = fixture();
  f.setAction("Добавлена заметка по объекту", `/objects/${id}`);
  await createTelegramHandler("dispatch", env, f.fetcher)(request("dispatch"));
  const send = f.calls.find((c) => c.url.includes("api.telegram.org"))!;
  assert.match(String(send.body["text"]), /Добавлена заметка по объекту/);
  assert.equal(JSON.stringify(send.body["reply_markup"]).includes(`/objects/${id}`), true);
  const bad = fixture();
  bad.setAction("PRIVATE CONTACT +70000000000", "/team");
  await createTelegramHandler("dispatch", env, bad.fetcher)(request("dispatch"));
  assert.doesNotMatch(
    JSON.stringify(bad.calls.find((c) => c.url.includes("api.telegram.org"))!.body),
    /PRIVATE CONTACT|70000000000/,
  );
});
test("unconfigured dispatcher does not claim queue and unsafe application origins/links cannot leak identifiers", async () => {
  const f = fixture();
  const response = await createTelegramHandler(
    "dispatch",
    { ...env, TELEGRAM_BOT_TOKEN: "" },
    f.fetcher,
  )(request("dispatch"));
  assert.equal(response.status, 503);
  assert.equal(f.calls.length, 0);
  for (const href of [
    "//evil.example",
    "https://evil.example",
    "/team?token=private",
    "javascript:alert(1)",
  ])
    assert.equal(telegramDestination(env.APP_URL, href), "https://smartrent.example/notifications");
  assert.throws(() => telegramDestination("https://user:password@example.com", "/team"));
  assert.throws(() => telegramDestination("http://example.com", "/team"));
});

test("modern injected key dictionary authenticates RPC with apikey and no bearer", async () => {
  const f = fixture();
  const response = await createTelegramHandler(
    "dispatch",
    {
      ...env,
      SUPABASE_SECRET_KEY: "",
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_modern_fixture" }),
    },
    f.fetcher,
  )(request("dispatch"));
  assert.equal(response.status, 200);
  const rpcCalls = f.calls.filter((call) => call.url.includes("/rest/v1/rpc/"));
  assert.ok(rpcCalls.length > 0);
  for (const call of rpcCalls) {
    assert.equal(call.headers.get("apikey"), "sb_secret_modern_fixture");
    assert.equal(call.headers.get("Authorization"), null);
  }
});

test("malformed or unusable modern key dictionaries retain legacy server-key fallback", async () => {
  for (const dictionary of [
    "broken json",
    "{}",
    "[]",
    "null",
    '{"other":"sb_secret_other"}',
    '{"default":42}',
    '{"default":""}',
    '{"default":"public_key"}',
  ]) {
    const f = fixture();
    const response = await createTelegramHandler(
      "dispatch",
      {
        ...env,
        SUPABASE_SECRET_KEY: "",
        SUPABASE_SECRET_KEYS: dictionary,
        SUPABASE_SERVICE_ROLE_KEY: "legacy.jwt.fixture",
      },
      f.fetcher,
    )(request("dispatch"));
    assert.equal(response.status, 200, dictionary);
    const rpc = f.calls.find((call) => call.url.includes("/rest/v1/rpc/"))!;
    assert.equal(rpc.headers.get("apikey"), "legacy.jwt.fixture");
    assert.equal(rpc.headers.get("Authorization"), "Bearer legacy.jwt.fixture");
  }
});

test("missing server keys fail safely before any privileged request", async () => {
  for (const dictionary of ["", "broken json", "{}", '{"default":false}']) {
    const f = fixture();
    const response = await createTelegramHandler(
      "dispatch",
      { ...env, SUPABASE_SECRET_KEY: "", SUPABASE_SECRET_KEYS: dictionary },
      f.fetcher,
    )(request("dispatch"));
    assert.equal(response.status, 503);
    assert.equal(f.calls.length, 0);
    assert.doesNotMatch(await response.text(), /sb_secret|legacy\.jwt|TELEGRAM_BOT_TOKEN/);
  }
});
