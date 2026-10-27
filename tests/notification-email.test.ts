import assert from "node:assert/strict";
import { test } from "node:test";
import { renderNotificationEmail } from "../supabase/functions/_shared/notification-email.ts";

const origin = "https://smartrent.example";
test("email contains the event, correct action and text alternative without tracking", () => {
  const mail = renderNotificationEmail({ kind: "request_created", href: "/requests" }, origin);
  assert.equal(mail.subject, "SmartRent · Новая заявка");
  assert.match(mail.html, /lang="ru"/);
  assert.match(mail.html, /href="https:\/\/smartrent.example\/requests"/);
  assert.match(mail.html, /Открыть заявки/);
  assert.match(mail.text, /Поступила новая заявка по объекту/);
  assert.match(mail.text, /Настройки уведомлений: https:\/\/smartrent.example\/notifications/);
  assert.doesNotMatch(mail.html, /<script|<img|javascript:|utm_/i);
});
test("email rejects untrusted labels and keeps the destination inside the app", () => {
  const mail = renderNotificationEmail(
    {
      kind: "object_activity",
      href: "//evil.example",
      event_label: '<img src=x onerror="steal()">PRIVATE',
    },
    origin,
  );
  assert.doesNotMatch(mail.html + mail.text + mail.subject, /PRIVATE|evil.example|steal/);
  assert.match(mail.html, /href="https:\/\/smartrent.example\/notifications"/);
  assert.match(mail.html, /Действие по объекту/);
});
test("email uses only approved action labels and authorized object paths", () => {
  const mail = renderNotificationEmail(
    {
      kind: "object_activity",
      href: "/objects/10000000-0000-0000-0000-000000000001",
      event_label: "Добавлена заметка по объекту",
    },
    origin,
  );
  assert.equal(mail.subject, "SmartRent · Добавлена заметка по объекту");
  assert.match(mail.html, /Открыть объект/);
  assert.match(mail.text, /\/objects\/10000000-0000-0000-0000-000000000001/);
});
test("email cannot turn an unknown event or application origin into HTML or an external link", () => {
  for (const kind of ["__proto__", "constructor", "<script>secret</script>"]) {
    const mail = renderNotificationEmail({ kind, href: "/requests?token=secret" }, origin);
    assert.equal(mail.subject, "SmartRent · Новое уведомление");
    assert.doesNotMatch(mail.html + mail.text, /secret|<script>|token=/);
  }
  assert.throws(() =>
    renderNotificationEmail({ kind: "test", href: "/notifications" }, "javascript:alert(1)"),
  );
  assert.throws(() =>
    renderNotificationEmail(
      { kind: "test", href: "/notifications" },
      "https://user:pass@evil.example",
    ),
  );
});
