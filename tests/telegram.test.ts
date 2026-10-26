import assert from "node:assert/strict";
import { test } from "node:test";
import {
  telegramBotLink,
  telegramDeliveryExplanation,
  telegramTopics,
} from "../src/lib/telegram.ts";

test("Telegram link uses returned bot and one-time token without permitting URL injection", () => {
  const link = {
    id: "id",
    token: "abcdef1234567890_-",
    bot_username: "smartrent_bot",
    expires_at: "2026-10-25T18:00:00Z",
  };
  assert.equal(telegramBotLink(link), "https://t.me/smartrent_bot?start=abcdef1234567890_-");
  for (const bot_username of ["https://evil.invalid", "a?start=x", "../bad", ""])
    assert.throws(() => telegramBotLink({ ...link, bot_username }));
  for (const token of ["short", "abc\n\ndef1234567890", "abc?redirect=1234567890"])
    assert.throws(() => telegramBotLink({ ...link, token }));
});

test("Telegram explanations distinguish uncertain outcomes from confirmed acceptance and never expose error text", () => {
  assert.match(telegramDeliveryExplanation("sent", null), /не подтверждение прочтения/);
  assert.match(telegramDeliveryExplanation("uncertain", null), /автоматического повтора не будет/);
  assert.match(telegramDeliveryExplanation("failed", "bot_blocked"), /не заблокирован/);
  assert.ok(
    !telegramDeliveryExplanation("failed", "PRIVATE_PROVIDER_SECRET").includes(
      "PRIVATE_PROVIDER_SECRET",
    ),
  );
  assert.ok(Object.keys(telegramTopics).includes("objects"));
});
