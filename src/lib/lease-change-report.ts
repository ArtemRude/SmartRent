import { amendmentLabels, amendmentMoney, type LeaseAmendment } from "./lease-changes.ts";
import { formatDate, formatDateTime } from "./domain.ts";
const html = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
export function buildLeaseChangeHtml(change: LeaseAmendment) {
  const snapshot =
    change.agreement_snapshot &&
    typeof change.agreement_snapshot === "object" &&
    !Array.isArray(change.agreement_snapshot)
      ? change.agreement_snapshot
      : {};
  const field = (key: string) => html(snapshot[key]);
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Дополнительное соглашение</title><style>*{box-sizing:border-box}body{font:14px/1.6 Arial,sans-serif;color:#172c2b;background:#f5f8f7;margin:0}.page,.toolbar{max-width:850px;padding:28px;margin:24px auto}.page{background:white;border-radius:12px}h1{font-size:25px}p,td{overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border-bottom:1px solid #ddd;text-align:left;padding:10px}.note{white-space:pre-wrap}.status{padding:12px;background:#eef7f4}button{font:inherit;border:0;border-radius:8px;padding:10px 16px;color:white;background:#247d77}footer{font-size:11px;color:#567;margin-top:30px}@page{size:A4;margin:18mm}@media(max-width:600px){.page,.toolbar{padding:16px;margin:12px}}@media print{body{background:white}.toolbar{display:none}.page{padding:0;margin:0;max-width:none}tr{break-inside:avoid}}</style></head><body><div class="toolbar"><button id="print">Печать / Сохранить PDF</button></div><main class="page"><p>SmartRent · Договор № ${html(change.agreement_id)}</p><h1>Дополнительное соглашение</h1><p class="status">${amendmentLabels[change.status]} · версия ${change.revision}</p><p><strong>Объект:</strong> ${field("property_name")} · ${field("property_address")}</p><p><strong>Собственник:</strong> ${field("owner_name")} · ${field("owner_email")}</p><p><strong>Арендатор:</strong> ${field("tenant_name")} · ${field("tenant_email")}</p><p>Стороны согласуют следующие изменения условий договора от ${formatDate(String(snapshot["start_date"] ?? change.effective_from))}.</p><table><thead><tr><th>Условие</th><th>До изменения</th><th>После изменения</th></tr></thead><tbody><tr><td>Арендная плата за месяц</td><td>${amendmentMoney(Number(change.previous_monthly_payment))}</td><td>${amendmentMoney(Number(change.monthly_payment))} с ${formatDate(change.effective_from)}</td></tr><tr><td>Окончание аренды</td><td>${formatDate(change.previous_end_date)}</td><td>${formatDate(change.end_date)}</td></tr></tbody></table><p>Новая ставка применяется к полным расчётным месяцам начиная с указанной даты. Дата внесения ежемесячного платежа и остальные условия договора сохраняются.</p>${change.note ? `<p class="note">${html(change.note)}</p>` : ""}${change.review_note ? `<p class="note">Причина отказа: ${html(change.review_note)}</p>` : ""}<p>Подтверждение арендатора в сервисе: ${change.status === "accepted" && change.decided_at ? formatDateTime(change.decided_at) : "Ожидается / не получено"}</p><p>Собственник: __________________ / __________________</p><p>Арендатор: __________________ / __________________</p><footer>Соглашение № ${html(change.id)}. Данные и стороны взяты из сохранённой версии предложения. Отметка в кабинете фиксирует согласование условий и не является отметкой о подписании PDF или банковской оплате. До подтверждения предложение не меняет начисления.</footer></main></body></html>`;
}
export function openLeaseChangeReport(change: LeaseAmendment) {
  const tab = window.open("", "_blank", "width=960,height=900");
  if (!tab) throw new Error("Разрешите открытие печатной версии в браузере");
  tab.opener = null;
  tab.document.open();
  tab.document.write(buildLeaseChangeHtml(change));
  tab.document.close();
  tab.document.getElementById("print")?.addEventListener("click", () => tab.print());
}
