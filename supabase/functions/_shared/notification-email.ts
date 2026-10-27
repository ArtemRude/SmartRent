import {
  notificationActionLabel,
  notificationEventContent,
  telegramDestination,
} from "./telegram.ts";

function html(value: string): string {
  return value.replace(
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

/** Presentation only. Does not enqueue mail, select recipients or claim delivery. */
export function renderNotificationEmail(
  event: { kind: string; href: string; event_label?: string },
  appUrl: string,
): { subject: string; html: string; text: string } {
  const content = notificationEventContent(event);
  const destination = telegramDestination(appUrl, event.href);
  const settings = telegramDestination(appUrl, "/notifications");
  const action = notificationActionLabel(destination);
  const subject = `SmartRent · ${content.title}`;
  const text = [
    "SmartRent",
    "",
    content.title,
    content.body,
    "",
    `${action}: ${destination}`,
    "",
    `Настройки уведомлений: ${settings}`,
    "Подробности и действия доступны после входа в кабинет.",
  ].join("\n");
  return {
    subject,
    text,
    html: `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${html(subject)}</title></head>
<body style="margin:0;padding:0;background:#f7f5f1;color:#263d3a;font-family:Arial,Helvetica,sans-serif;word-break:break-word">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${html(content.body)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5f1"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td style="padding:0 8px 22px;font-size:22px;font-weight:bold;color:#194b47">SmartRent<span style="display:block;margin-top:7px;font-size:12px;font-weight:normal;color:#626e66">Управление арендой</span></td></tr>
<tr><td style="background:#ffffff;border:1px solid #e4e6df;border-radius:20px;padding:28px 24px">
<p style="margin:0 0 22px"><span style="display:inline-block;padding:8px 12px;border-radius:10px;background:#e4f4f0;font-size:12px;font-weight:bold;color:#24685e">Новое уведомление</span></p>
<h1 style="margin:0 0 14px;font-size:25px;line-height:1.3;letter-spacing:-0.4px">${html(content.title)}</h1>
<p style="margin:0 0 26px;font-size:16px;line-height:1.7;color:#69746d">${html(content.body)}</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#267c72" style="border-radius:12px"><a href="${html(destination)}" style="display:inline-block;padding:14px 22px;border:1px solid #267c72;border-radius:12px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none">${html(action)}</a></td></tr></table>
<p style="margin:24px 0 0;padding-top:20px;border-top:1px solid #eceee8;font-size:12px;line-height:1.7;color:#626e66">Подробности и действия доступны после входа в кабинет.</p>
</td></tr>
<tr><td style="padding:20px 8px 0;font-size:12px;line-height:1.8;color:#626e66">Темы и каналы отправки можно изменить в <a href="${html(settings)}" style="color:#267c72;text-decoration:underline">настройках уведомлений</a>.<br>SmartRent · Важное по вашей аренде</td></tr>
</table></td></tr></table>
</body></html>`,
  };
}
