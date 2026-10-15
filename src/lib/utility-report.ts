import { createCsv } from "./csv.ts";
import { formatDate, formatMonth, getRentChargeBalance } from "./domain.ts";
import {
  formatUtilityMoney,
  formatUtilityValue,
  utilityStatusLabels,
  type UtilityBill,
  type UtilityBillItem,
} from "./utilities.ts";
import type { UtilitySummaryCharge } from "./utility-summary.ts";

export type UtilityReportContext = {
  propertyName: string;
  propertyAddress: string;
  tenantName: string;
  unitName: string | null;
};
export type UtilityReportData = UtilityReportContext & {
  bill: UtilityBill;
  items: UtilityBillItem[];
  charge?: (UtilitySummaryCharge & { due_date: string }) | undefined;
};

function html(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildUtilityReportHtml(data: UtilityReportData) {
  const { bill, charge } = data;
  const rows = data.items
    .filter((item) => item.bill_id === bill.id)
    .map(
      (item) => `<tr>
    <td>${html(item.name)}<small>${item.kind === "fixed" ? "Фиксированный платёж" : html(item.unit)}</small></td>
    <td>${item.kind === "meter" ? `${formatUtilityValue(Number(item.previous_reading))} → ${formatUtilityValue(Number(item.reading))}` : "—"}</td>
    <td>${item.kind === "meter" ? formatUtilityValue(Number(item.reading) - Number(item.previous_reading)) : "1 мес."}</td>
    <td>${formatUtilityValue(Number(item.rate))} ₽</td><td class="money">${formatUtilityMoney(Number(item.amount))}</td>
  </tr>`,
    )
    .join("");
  const statusNote =
    bill.status === "pending"
      ? "Предварительный расчёт. Сумма будет начислена после утверждения собственником."
      : bill.status === "rejected"
        ? "Расчёт возвращён на исправление. По этому расчёту начисление не создано."
        : "Коммунальный расчёт утверждён собственником.";
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Коммунальные услуги · ${html(formatMonth(bill.period_start))}</title>
  <style>
  *{box-sizing:border-box}body{margin:0;background:#f3f5f4;color:#182423;font:14px/1.5 Arial,sans-serif}.toolbar{max-width:900px;margin:20px auto;display:flex;gap:16px;align-items:center;padding:0 16px}button{border:0;background:#183b38;color:white;padding:12px 18px;border-radius:8px;cursor:pointer;font:inherit}.toolbar span{font-size:12px;color:#596663}.page{max-width:900px;margin:20px auto;padding:40px;background:white;border-radius:16px}.brand{color:#247d77;font-weight:bold;letter-spacing:.04em}h1{font-size:27px;margin:16px 0 4px}.period{font-size:18px;margin:0 0 24px;text-transform:capitalize}.status{padding:12px 16px;background:#eaf5f3;border-radius:8px;margin:20px 0}.details{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:24px 0}.details dt{font-size:12px;color:#596663}.details dd{margin:3px 0;overflow-wrap:anywhere}table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px}th{text-align:left;background:#eff4f3;color:#52635f;font-weight:normal}th,td{overflow-wrap:anywhere;padding:12px 8px;border-bottom:1px solid #dae3e0;vertical-align:top}th:first-child{width:30%}th:nth-child(2){width:21%}th:nth-child(3){width:13%}th:nth-child(4){width:16%}th:nth-child(5){width:20%}td small{display:block;color:#65756f;font-size:11px}.money{text-align:right;white-space:nowrap}.total{display:flex;justify-content:space-between;gap:16px;padding:18px 0;font-size:20px;font-weight:bold}.payment{border-top:1px solid #dae3e0;padding-top:16px}.note{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f6f5;padding:14px;border-radius:8px}.footer{margin-top:24px;color:#65756f;font-size:11px}
  @media(max-width:600px){.page{padding:20px 12px;margin:12px;border-radius:8px}.details{grid-template-columns:1fr}.toolbar{flex-wrap:wrap}table{font-size:10px}th,td{padding:8px 3px}.money{white-space:normal}.total{font-size:17px}}
  @page{size:A4;margin:18mm}@media print{body{background:white}.toolbar{display:none}.page{margin:0;padding:0;max-width:none;border-radius:0}.details{grid-template-columns:1fr 1fr}thead{display:table-header-group}tr{break-inside:avoid}.total,.payment,.note{break-inside:avoid}}
  </style></head><body><div class="toolbar"><button id="print-report" type="button">Печать / Сохранить PDF</button><span>В окне печати выберите «Сохранить как PDF».</span></div>
  <main class="page"><div class="brand">SmartRent</div><h1>Расчёт коммунальных услуг</h1><p class="period">${html(formatMonth(bill.period_start))}</p>
  <div class="status"><strong>${utilityStatusLabels[bill.status]}</strong><br>${statusNote}</div>
  <dl class="details"><div><dt>Объект</dt><dd>${html(data.propertyName)}${data.unitName ? ` · ${html(data.unitName)}` : ""}</dd><dd>${html(data.propertyAddress)}</dd></div><div><dt>Арендатор</dt><dd>${html(data.tenantName)}</dd></div><div><dt>Передано</dt><dd>${formatDate(bill.created_at)}</dd></div><div><dt>Проверено</dt><dd>${bill.reviewed_at ? formatDate(bill.reviewed_at) : "Ожидает проверки"}</dd></div></dl>
  <table><thead><tr><th>Услуга</th><th>Показания</th><th>Расход</th><th>Тариф</th><th class="money">Сумма</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="total"><span>Коммунальные услуги, итого</span><span>${formatUtilityMoney(Number(bill.amount))}</span></div>
  ${bill.review_note ? `<p class="note">${html(bill.review_note)}</p>` : ""}
  ${bill.status === "approved" && charge ? `<div class="payment"><p>Оплатить до: <strong>${formatDate(charge.due_date)}</strong></p><p>Остаток к оплате: <strong>${formatUtilityMoney(getRentChargeBalance(charge))}</strong>${charge.paid_at ? " · Оплачено" : ""}</p></div>` : ""}
  <p class="footer">Арендная плата начисляется отдельно. В расчёте сохранены показания и тарифы на момент отправки. Расчёт № ${html(bill.id)}.</p></main></body></html>`;
}

export function openUtilityReport(data: UtilityReportData) {
  const tab = window.open("", "_blank", "width=960,height=900");
  if (!tab) throw new Error("Разрешите всплывающие окна, чтобы открыть расчёт");
  tab.opener = null;
  tab.document.open();
  tab.document.write(buildUtilityReportHtml(data));
  tab.document.close();
  tab.document.getElementById("print-report")?.addEventListener("click", () => tab.print());
  tab.focus();
}

// Protect text entered by users from being interpreted as spreadsheet formulas.
function csvText(value: string) {
  return /^(?:\s*[=+\-@]|[\t\r\n])/.test(value) ? `'${value}` : value;
}
const csvNumber = (value: number) => String(value).replace(".", ",");

export function buildUtilityHistoryCsv(bills: UtilityBill[], items: UtilityBillItem[]) {
  return createCsv(
    [
      "Расчёт",
      "Месяц",
      "Статус",
      "Услуга",
      "Тип",
      "Предыдущие показания",
      "Текущие показания",
      "Расход",
      "Единица",
      "Тариф, ₽",
      "Сумма, ₽",
      "Проверено",
      "Комментарий",
    ],
    bills.flatMap((bill) =>
      items
        .filter((item) => item.bill_id === bill.id)
        .map((item) => [
          csvText(bill.id),
          bill.period_start.slice(0, 7),
          utilityStatusLabels[bill.status],
          csvText(item.name),
          item.kind === "meter" ? "Счётчик" : "Фиксированный платёж",
          item.previous_reading === null ? "" : csvNumber(Number(item.previous_reading)),
          item.reading === null ? "" : csvNumber(Number(item.reading)),
          item.kind === "meter"
            ? csvNumber(
                Math.round((Number(item.reading) - Number(item.previous_reading)) * 1000) / 1000,
              )
            : "",
          csvText(item.unit),
          csvNumber(Number(item.rate)),
          Number(item.amount).toFixed(2).replace(".", ","),
          bill.reviewed_at ? formatDate(bill.reviewed_at) : "",
          csvText(bill.review_note ?? ""),
        ]),
    ),
  );
}
