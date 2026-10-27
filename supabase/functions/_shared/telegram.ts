/** Transport contains no business writes; all authorization and queue state live in RPCs. */
export type TelegramEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SECRET_KEYS?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_WORKER_SECRET?: string;
  APP_URL?: string;
};

type Fetcher = typeof fetch;
type ObjectValue = Record<string, unknown>;
type Delivery = {
  id: string;
  claim_token: string;
  chat_id: string;
  kind: string;
  href: string;
  event_label?: string;
};

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const object = (value: unknown): ObjectValue | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : null;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const chatId = /^[1-9][0-9]{0,15}$/;
const objectActionLabels = new Set([
  "Добавлен объект",
  "Объект обновлён",
  "Добавлено помещение",
  "Помещение обновлено",
  "Помещение удалено",
  "Изменён ответственный по объекту",
  "Добавлена заметка по объекту",
  "Предложение аренды опубликовано",
  "Предложение аренды снято с публикации",
]);

export const telegramEventTexts: Readonly<Record<string, string>> = {
  request_created: "Поступила новая заявка по объекту.",
  request_comment: "В заявке появился новый комментарий.",
  request_status: "Изменился статус заявки.",
  agreement_created: "Появился новый договор аренды.",
  agreement_status: "Изменился статус договора аренды.",
  agreement_accepted: "Арендатор подтвердил условия договора.",
  agreement_amendment: "Обновлено предложение об изменении условий аренды.",
  agreement_expiring: "Приближается окончание срока аренды.",
  payment_status: "Обновлён статус оплаты.",
  payment_due: "Приближается срок оплаты.",
  payment_overdue: "Есть просроченное начисление.",
  payment_reminder: "Вам отправили напоминание об оплате.",
  payment_reported: "Арендатор сообщил об оплате.",
  payment_report_status: "Обновлён результат проверки оплаты.",
  utility_submitted: "Переданы коммунальные показания.",
  utility_reviewed: "Обновлён коммунальный расчёт.",
  handover_status: "Обновлён акт заселения или выезда.",
  repair_status: "Обновлены сведения о ремонте или обслуживании.",
  rental_application: "Обновлена заявка кандидата на аренду.",
  object_activity: "Новое действие по объекту. Подробности доступны в кабинете.",
  test: "Проверка подключения: Telegram-уведомления SmartRent работают.",
};

const telegramEventHeadings: Readonly<Record<string, readonly [string, string]>> = {
  request_created: ["📩", "Новая заявка"],
  request_comment: ["💬", "Комментарий в заявке"],
  request_status: ["📋", "Статус заявки изменён"],
  agreement_created: ["📄", "Новый договор"],
  agreement_status: ["📄", "Статус договора изменён"],
  agreement_accepted: ["✅", "Условия договора подтверждены"],
  agreement_amendment: ["✍️", "Изменение условий аренды"],
  agreement_expiring: ["📅", "Аренда подходит к концу"],
  payment_status: ["💳", "Обновление оплаты"],
  payment_due: ["📅", "Скоро срок оплаты"],
  payment_overdue: ["⏰", "Просроченная оплата"],
  payment_reminder: ["🔔", "Напоминание об оплате"],
  payment_reported: ["💳", "Оплата ожидает проверки"],
  payment_report_status: ["💳", "Результат проверки оплаты"],
  utility_submitted: ["🔢", "Получены показания счётчиков"],
  utility_reviewed: ["🔢", "Коммунальный расчёт обновлён"],
  handover_status: ["🔑", "Заселение и выезд"],
  repair_status: ["🛠", "Обновление ремонта"],
  rental_application: ["🏡", "Обновление по кандидату"],
  object_activity: ["🏠", "Действие по объекту"],
  test: ["✅", "Telegram подключён"],
};

// Only static copy and the closed action dictionary enter the message. Escape every
// text fragment as well, so future copy changes cannot accidentally create HTML.
function telegramHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

export function notificationEventContent(delivery: { kind: string; event_label?: string }): {
  icon: string;
  title: string;
  body: string;
} {
  const [icon, defaultHeading] = Object.hasOwn(telegramEventHeadings, delivery.kind)
    ? telegramEventHeadings[delivery.kind]!
    : (["🔔", "Новое уведомление"] as const);
  const actionLabel =
    delivery.kind === "object_activity" &&
    typeof delivery.event_label === "string" &&
    objectActionLabels.has(delivery.event_label)
      ? delivery.event_label
      : null;
  const heading = actionLabel ?? defaultHeading;
  const body = actionLabel
    ? "В вашем объекте появилось новое событие."
    : Object.hasOwn(telegramEventTexts, delivery.kind)
      ? telegramEventTexts[delivery.kind]!
      : "Новое событие. Подробности доступны в кабинете.";
  return { icon, title: heading, body };
}

function deliveryText(delivery: Delivery): string {
  const { icon, title, body } = notificationEventContent(delivery);
  const footer =
    delivery.kind === "test"
      ? "Темы и отправку можно изменить в разделе «Уведомления»."
      : "Подробности и действия — в кабинете.";
  return `<b>SmartRent</b>\n\n${icon} <b>${telegramHtml(title)}</b>\n${telegramHtml(body)}\n\n<i>${telegramHtml(footer)}</i>`;
}

export function notificationActionLabel(destination: string): string {
  const path = new URL(destination).pathname;
  if (/^\/objects\/[0-9a-f-]{36}$/i.test(path)) return "Открыть объект";
  const labels: Readonly<Record<string, string>> = {
    "/requests": "Открыть заявки",
    "/agreements": "Открыть договоры",
    "/payments": "Открыть платежи",
    "/cabinet": "Открыть мой кабинет",
    "/utilities": "Открыть коммунальные услуги",
    "/handover": "Открыть акты",
    "/lease-changes": "Открыть изменения договора",
    "/repairs": "Открыть ремонты",
    "/recruitment": "Открыть кандидатов",
    "/team": "Открыть команду",
    "/portfolio": "Открыть портфель",
    "/notifications": "Открыть уведомления",
  };
  return Object.hasOwn(labels, path) ? labels[path]! : "Открыть в кабинете";
}

export function telegramDestination(appUrl: string, href: string): string {
  const base = new URL(appUrl);
  if (
    base.username ||
    base.password ||
    (base.protocol !== "https:" &&
      !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname)))
  )
    throw new Error("Invalid application origin");
  // Do not accept protocol-relative URLs, arbitrary paths or user-controlled query strings.
  const allowed = new Set([
    "/requests",
    "/agreements",
    "/payments",
    "/cabinet",
    "/utilities",
    "/handover",
    "/lease-changes",
    "/repairs",
    "/recruitment",
    "/team",
    "/portfolio",
    "/notifications",
  ]);
  const path =
    allowed.has(href) || /^\/objects\/[0-9a-f-]{36}$/i.test(href) ? href : "/notifications";
  return new URL(path, base.origin).href;
}

async function equalSecret(actual: string | null, expected: string | undefined) {
  if (!actual || !expected || expected.length < 32) return false;
  const digest = async (s: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(actual), digest(expected)]);
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a[i]! ^ b[i]!;
  return different === 0;
}

export function telegramServerKey(env: TelegramEnvironment): string | undefined {
  if (env.SUPABASE_SECRET_KEY) return env.SUPABASE_SECRET_KEY;
  try {
    const keys = object(JSON.parse(env.SUPABASE_SECRET_KEYS || "null"));
    if (typeof keys?.["default"] === "string" && keys["default"].startsWith("sb_secret_"))
      return keys["default"];
  } catch {
    // Legacy projects may only provide the service-role key.
  }
  return env.SUPABASE_SERVICE_ROLE_KEY;
}

function createRpc(env: TelegramEnvironment, fetcher: Fetcher) {
  const base = env.SUPABASE_URL;
  const key = telegramServerKey(env);
  if (!base || !key) throw new Error("Missing server configuration");
  const origin = new URL(base);
  if (!["https:", "http:"].includes(origin.protocol)) throw new Error("Invalid database origin");
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_secret_")) headers["Authorization"] = `Bearer ${key}`;
  return async (name: string, args: ObjectValue = {}): Promise<unknown> => {
    const result = await fetcher(`${origin.origin}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers,
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(10_000),
    });
    if (!result.ok) throw new Error("Database operation failed");
    const text = await result.text();
    return text ? JSON.parse(text) : null;
  };
}

function isDelivery(value: unknown): value is Delivery {
  const d = object(value);
  return Boolean(
    d &&
    typeof d["id"] === "string" &&
    uuid.test(d["id"]) &&
    typeof d["claim_token"] === "string" &&
    uuid.test(d["claim_token"]) &&
    typeof d["chat_id"] === "string" &&
    chatId.test(d["chat_id"]) &&
    typeof d["kind"] === "string" &&
    typeof d["href"] === "string",
  );
}

async function readUpdate(request: Request) {
  if (Number(request.headers.get("content-length")) > 16_384) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const parts: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 16_384) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  try {
    return object(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

/** Webhook verifies Telegram's secret header; dispatcher verifies a separate scheduler secret. */
export function createTelegramHandler(
  mode: "webhook" | "dispatch",
  env: TelegramEnvironment,
  fetcher: Fetcher = fetch,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const valid =
      mode === "webhook"
        ? await equalSecret(
            request.headers.get("X-Telegram-Bot-Api-Secret-Token"),
            env.TELEGRAM_WEBHOOK_SECRET,
          )
        : await equalSecret(
            request.headers.get("X-Telegram-Worker-Secret"),
            env.TELEGRAM_WORKER_SECRET,
          );
    if (!valid) return json({ error: "Unauthorized" }, 401);
    try {
      const rpc = createRpc(env, fetcher);
      if (mode === "webhook") {
        const update = await readUpdate(request);
        if (
          !update ||
          !Number.isSafeInteger(update["update_id"]) ||
          Number(update["update_id"]) < 0
        )
          return json({ error: "Invalid update" }, 400);
        const message = object(update["message"]);
        const chat = object(message?.["chat"]);
        const from = object(message?.["from"]);
        // A group, forwarded command or bot message cannot bind a personal account.
        if (
          !message ||
          chat?.["type"] !== "private" ||
          from?.["is_bot"] !== false ||
          !Number.isSafeInteger(chat["id"]) ||
          chat["id"] !== from["id"] ||
          Number(chat["id"]) <= 0 ||
          message["forward_origin"] ||
          message["via_bot"]
        )
          return json({ ok: true });
        const text = message["text"];
        if (typeof text !== "string") return json({ ok: true });
        const match = /^\/start ([A-Za-z0-9_-]{32,64})$/.exec(text);
        const stop = text === "/stop";
        if (!match && !stop) return json({ ok: true });
        const received = object(
          await rpc("receive_telegram_update", {
            p_update_id: update["update_id"],
            p_chat_id: String(chat["id"]),
            p_username: typeof from["username"] === "string" ? from["username"] : null,
            p_token: match?.[1] ?? null,
            p_stop: stop,
          }),
        );
        // Telegram can execute this reply directly. It is a setup hint, not a tracked delivery.
        if (received?.["result"] === "pending" || received?.["result"] === "stopped") {
          return json({
            method: "sendMessage",
            chat_id: String(chat["id"]),
            parse_mode: "HTML",
            text:
              received["result"] === "pending"
                ? "<b>SmartRent</b>\n\n🔗 <b>Осталось подтвердить подключение</b>\nВернитесь в кабинет → Уведомления и подтвердите свой Telegram-аккаунт.\n\n<i>До подтверждения уведомления не отправляются.</i>"
                : "<b>SmartRent</b>\n\n🔕 <b>Telegram-уведомления отключены</b>\nНовые события больше не будут приходить в этот чат.\n\n<i>Для подключения создайте новую ссылку в разделе «Уведомления» в кабинете.</i>",
          });
        }
        // Never return the token, RPC internals or business data, or log requests.
        return json({ ok: true });
      }
      const token = env.TELEGRAM_BOT_TOKEN;
      if (!token || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(token) || !env.APP_URL)
        return json({ error: "Missing server configuration" }, 503);
      telegramDestination(env.APP_URL, "/notifications");
      let processed = 0;
      const started = Date.now();
      for (let index = 0; index < 10 && Date.now() - started < 25_000; index++) {
        const claimed = await rpc("claim_telegram_deliveries", { p_limit: 1 });
        if (!Array.isArray(claimed)) throw new Error("Invalid queue response");
        if (!claimed.length) break;
        const delivery = claimed[0];
        if (!isDelivery(delivery)) throw new Error("Invalid delivery");
        let outcome: "sent" | "retry" | "failed" | "uncertain" = "uncertain";
        let errorCode: string | null = "unknown_delivery";
        let retryAfter: number | null = null;
        let messageId: number | null = null;
        try {
          const destination = telegramDestination(env.APP_URL, delivery.href);
          const response = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: delivery.chat_id,
              text: deliveryText(delivery),
              parse_mode: "HTML",
              link_preview_options: { is_disabled: true },
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: notificationActionLabel(destination),
                      url: destination,
                    },
                  ],
                ],
              },
            }),
            signal: AbortSignal.timeout(8_000),
          });
          const body = object(await response.json());
          const result = object(body?.["result"]);
          if (
            response.ok &&
            body?.["ok"] === true &&
            Number.isSafeInteger(result?.["message_id"])
          ) {
            outcome = "sent";
            errorCode = null;
            messageId = Number(result!["message_id"]);
          } else if (body?.["ok"] === false) {
            const code = Number(body["error_code"]);
            if (code === 429) {
              outcome = "retry";
              errorCode = "telegram_429";
              const parameters = object(body["parameters"]);
              const seconds = Number(parameters?.["retry_after"]);
              retryAfter =
                Number.isSafeInteger(seconds) && seconds > 0 ? Math.min(seconds, 86_400) : 60;
            } else if ([500, 502, 503, 504].includes(code)) {
              outcome = "retry";
              errorCode = `telegram_${code}`;
            } else {
              outcome = "failed";
              errorCode = code === 403 ? "telegram_403" : "telegram_rejected";
            }
          }
        } catch {
          // Timeout may happen after Telegram accepted the message. Never blindly resend it.
        }
        await rpc("finish_telegram_delivery", {
          p_id: delivery.id,
          p_claim_token: delivery.claim_token,
          p_outcome: outcome,
          p_error_code: errorCode,
          p_retry_after: retryAfter,
          p_message_id: messageId,
        });
        processed++;
        if (outcome === "retry" || errorCode === "telegram_403") break;
      }
      return json({ ok: true, processed });
    } catch {
      // Telegram retries webhook 5xx; worker leases turn an unacknowledged send into uncertain.
      return json({ error: "Temporary processing failure" }, 503);
    }
  };
}
