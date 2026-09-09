export type AgreementDocumentData = {
  agreementId: string;
  propertyName: string;
  propertyAddress: string;
  unitName?: string | null;
  unitArea?: number | null;
  tenantName: string;
  tenantEmail: string;
  tenantPhone?: string | null;
  ownerName: string;
  ownerEmail: string;
  ownerPhone?: string | null;
  startDate: string;
  endDate: string;
  monthlyPayment: number;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function text(value: string | null | undefined, fallback = "не указано") {
  return escapeHtml(value?.trim() || fallback);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(value);
}

export function buildAgreementDocumentHtml(data: AgreementDocumentData) {
  const agreementNumber = text(data.agreementId.slice(0, 8).toUpperCase());
  const premises = data.unitName
    ? `${text(data.unitName)}${data.unitArea ? `, площадь ${data.unitArea} м²` : ""}`
    : "объект полностью";

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Договор аренды № ${agreementNumber}</title>
  <style>
    :root { color-scheme: light; font-family: Arial, sans-serif; color: #292522; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f4f1ed; }
    .toolbar { position: sticky; top: 0; display: flex; justify-content: center; gap: 12px; padding: 14px; background: #292522; }
    .toolbar button { border: 0; border-radius: 9px; padding: 10px 18px; font: inherit; cursor: pointer; }
    .toolbar .primary { background: #e94b57; color: white; }
    .page { width: 210mm; min-height: 297mm; margin: 20px auto; padding: 18mm; background: white; box-shadow: 0 12px 40px rgba(41, 37, 34, .12); }
    .brand { color: #e94b57; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 24px 0 5px; font-size: 25px; text-align: center; }
    .number { margin: 0 0 28px; color: #716a64; text-align: center; }
    h2 { margin: 24px 0 9px; font-size: 15px; }
    p { margin: 7px 0; font-size: 13px; line-height: 1.55; }
    .summary { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; padding: 16px; border: 1px solid #e5dfd9; border-radius: 12px; background: #fcfaf8; }
    .summary span { display: block; color: #716a64; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
    .summary strong { display: block; margin-top: 4px; font-size: 13px; }
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; margin-top: 14px; }
    .party { padding-top: 12px; border-top: 1px solid #292522; }
    .muted { color: #716a64; }
    .notice { margin-top: 26px; padding: 12px 14px; border-left: 3px solid #e94b57; background: #fff4f2; font-size: 11px; line-height: 1.45; }
    .footer { margin-top: 30px; color: #8a827b; font-size: 10px; text-align: center; }
    @media screen and (max-width: 800px) {
      .page { width: 100%; min-height: 0; margin: 0; padding: 24px; }
      .summary, .parties { grid-template-columns: 1fr; }
    }
    @page { size: A4; margin: 0; }
    @media print {
      body { background: white; }
      .toolbar { display: none; }
      .page { margin: 0; box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button class="primary" onclick="window.print()">Сохранить как PDF / печать</button>
    <button onclick="window.close()">Закрыть</button>
  </div>
  <main class="page">
    <div class="brand">Умная Аренда</div>
    <h1>Договор аренды</h1>
    <p class="number">№ ${agreementNumber}</p>

    <section class="summary">
      <div><span>Объект</span><strong>${text(data.propertyName)}</strong></div>
      <div><span>Помещение</span><strong>${premises}</strong></div>
      <div><span>Адрес</span><strong>${text(data.propertyAddress)}</strong></div>
      <div><span>Арендная плата</span><strong>${text(formatMoney(data.monthlyPayment))} в месяц</strong></div>
      <div><span>Начало аренды</span><strong>${text(formatDate(data.startDate))}</strong></div>
      <div><span>Окончание аренды</span><strong>${text(formatDate(data.endDate))}</strong></div>
    </section>

    <h2>1. Предмет договора</h2>
    <p>Арендодатель передаёт Арендатору во временное владение и пользование объект «${text(data.propertyName)}» по адресу: ${text(data.propertyAddress)} (${premises}).</p>

    <h2>2. Срок аренды</h2>
    <p>Срок аренды устанавливается с ${text(formatDate(data.startDate))} по ${text(formatDate(data.endDate))} включительно.</p>

    <h2>3. Арендная плата</h2>
    <p>Ежемесячная арендная плата составляет ${text(formatMoney(data.monthlyPayment))}. Порядок оплаты, обеспечительный платёж, коммунальные расходы и иные условия стороны согласовывают до подписания.</p>

    <h2>4. Стороны</h2>
    <div class="parties">
      <div>
        <p><strong>Арендодатель</strong></p>
        <p>${text(data.ownerName)}</p>
        <p class="muted">${text(data.ownerEmail)}<br>${text(data.ownerPhone)}</p>
      </div>
      <div>
        <p><strong>Арендатор</strong></p>
        <p>${text(data.tenantName)}</p>
        <p class="muted">${text(data.tenantEmail)}<br>${text(data.tenantPhone)}</p>
      </div>
    </div>

    <h2>5. Подписи</h2>
    <div class="parties">
      <div class="party">Арендодатель / ${text(data.ownerName)}</div>
      <div class="party">Арендатор / ${text(data.tenantName)}</div>
    </div>

    <div class="notice"><strong>Черновик.</strong> Документ сформирован автоматически из данных сервиса. Перед подписанием дополните существенные условия и проверьте текст с учётом конкретного объекта и требований законодательства.</div>
    <div class="footer">Сформировано в сервисе «Умная Аренда»</div>
  </main>
</body>
</html>`;
}

export function printAgreementDocument(data: AgreementDocumentData) {
  const printWindow = window.open("", "_blank", "width=940,height=900");
  if (!printWindow)
    throw new Error("Браузер заблокировал окно печати. Разрешите всплывающие окна.");

  printWindow.opener = null;
  printWindow.document.open();
  printWindow.document.write(buildAgreementDocumentHtml(data));
  printWindow.document.close();
  printWindow.focus();
}
