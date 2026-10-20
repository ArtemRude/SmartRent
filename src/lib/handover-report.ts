import { formatDate, formatDateTime } from "./domain.ts";
import { handoverChecks, handoverStatusLabels, type LeaseHandover } from "./handovers.ts";
import { readAgreementContractDetails } from "./agreement-document.ts";

const html = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
export const handoverMoney = (value: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 2,
  }).format(value);
export function buildHandoverHtml(
  report: LeaseHandover,
  context: { property: string; address: string; tenant: string },
) {
  const inventory =
    readAgreementContractDetails({ inventoryItems: report.inventory_snapshot }).inventoryItems ??
    [];
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Акт осмотра</title><style>*{box-sizing:border-box}body{font:14px/1.6 Arial,sans-serif;color:#172c2b;margin:0;background:#f4f7f6}.page,.toolbar{max-width:850px;margin:24px auto;padding:24px}.page{background:white;border-radius:12px}h1{font-size:26px}h2{font-size:18px;margin-top:24px}p,li{overflow-wrap:anywhere}.note{white-space:pre-wrap}table{width:100%;border-collapse:collapse;table-layout:fixed}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left;overflow-wrap:anywhere}button{font:inherit;border:0;border-radius:8px;padding:10px 16px;background:#247d77;color:white}.status{padding:12px;background:#edf7f5}footer{font-size:11px;color:#536864;margin-top:24px}@media(max-width:600px){.page,.toolbar{margin:12px;padding:16px}}@page{size:A4;margin:18mm}@media print{body{background:white}.toolbar{display:none}.page{padding:0;margin:0;max-width:none}tr{break-inside:avoid}}</style></head><body><div class="toolbar"><button id="print" type="button">Печать / Сохранить PDF</button></div><main class="page"><p>SmartRent</p><h1>${report.kind === "move_in" ? "Акт заселения" : "Акт выезда"}</h1><p class="status">${handoverStatusLabels[report.status]} · Версия ${report.revision}</p><p><strong>Объект:</strong> ${html(context.property)} · ${html(context.address)}</p><p><strong>Арендатор:</strong> ${html(context.tenant)}</p><p>Дата осмотра: ${formatDate(report.inspection_date)} · Ключей: ${report.keys_count}</p><ul>${Object.entries(
    handoverChecks,
  )
    .map(
      ([key, title]) =>
        `<li>${report.checklist[key as keyof typeof handoverChecks] ? "✓" : "○"} ${title}</li>`,
    )
    .join(
      "",
    )}</ul><h2>Состояние помещения и имущества</h2><p class="note">${html(report.condition_note)}</p>${inventory.length ? `<h2>Опись на момент сохранения акта</h2><ul>${inventory.map((item) => `<li>${html(item.name)} · ${html(item.quantity)} · ${html(item.condition)}</li>`).join("")}</ul>` : ""}<h2>Показания счётчиков</h2><p class="note">${html(report.meter_readings)}</p><p>Фотографий в акте: ${report.photos.length}. Фотографии доступны участникам в сервисе.</p><h2>Депозит</h2><p>Получено собственником: ${handoverMoney(Number(report.deposit_received))}</p>${report.kind === "move_out" ? `<table><thead><tr><th>Причина удержания</th><th>Сумма</th></tr></thead><tbody>${report.deductions.map((item) => `<tr><td>${html(item.reason)}</td><td>${handoverMoney(Number(item.amount))}</td></tr>`).join("")}</tbody></table><p>Удержано: ${handoverMoney(Number(report.deductions_total))}</p><p><strong>К возврату: ${handoverMoney(Number(report.refund_due))}</strong></p><p>Возврат отмечен собственником: ${report.refund_marked_at ? formatDateTime(report.refund_marked_at) : "Нет"}</p><p>Получение подтверждено арендатором: ${report.refund_confirmed_at ? formatDateTime(report.refund_confirmed_at) : "Нет"}</p>` : ""}${report.review_note ? `<p class="note">Замечания: ${html(report.review_note)}</p>` : ""}<p>Подтверждение акта в сервисе: ${report.status === "confirmed" && report.reviewed_at ? formatDateTime(report.reviewed_at) : "Ожидается"}</p><footer>Акт № ${html(report.id)} · Договор № ${html(report.agreement_id)}. Подтверждение участников зафиксировано в сервисе. Расчёт депозита и отметка возврата не выполняют банковский перевод и не погашают начисления аренды или коммунальных услуг.</footer></main></body></html>`;
}

export function openHandoverReport(
  report: LeaseHandover,
  context: { property: string; address: string; tenant: string },
) {
  const tab = window.open("", "_blank", "width=960,height=900");
  if (!tab) throw new Error("Разрешите открытие печатной версии в браузере");
  tab.opener = null;
  tab.document.open();
  tab.document.write(buildHandoverHtml(report, context));
  tab.document.close();
  tab.document.getElementById("print")?.addEventListener("click", () => tab.print());
}
