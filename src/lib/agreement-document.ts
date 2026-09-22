export type AgreementInventoryItem = {
  name: string;
  quantity: string;
  condition: string;
};

export type AgreementContractDetails = {
  agreementNumber?: string | undefined;
  contractCity?: string | undefined;
  signedDate?: string | undefined;
  paymentDueDay?: number | null | undefined;
  depositAmount?: number | null | undefined;
  utilitiesTerms?: string | undefined;
  noticeDays?: number | null | undefined;
  ownerPassport?: string | undefined;
  ownerRegistrationAddress?: string | undefined;
  tenantPassport?: string | undefined;
  tenantRegistrationAddress?: string | undefined;
  inventoryItems?: AgreementInventoryItem[] | undefined;
};

export type AgreementDocumentData = {
  agreementId: string;
  propertyType: "apartment" | "warehouse" | "commercial" | "other";
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
  contractDetails?: AgreementContractDetails;
  tenantAcceptedAt?: string | null | undefined;
  inventoryPhotoCount?: number | undefined;
};

export function readAgreementContractDetails(value: unknown): AgreementContractDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const details = value as Record<string, unknown>;
  const stringValue = (key: string) =>
    typeof details[key] === "string" ? details[key] : undefined;
  const numberValue = (key: string) =>
    typeof details[key] === "number" ? details[key] : undefined;
  const inventoryValue = details["inventoryItems"];
  const inventoryItems = Array.isArray(inventoryValue)
    ? inventoryValue
        .flatMap((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return [];
          const row = item as Record<string, unknown>;
          const name = typeof row["name"] === "string" ? row["name"] : "";
          const quantity = typeof row["quantity"] === "string" ? row["quantity"] : "";
          const condition = typeof row["condition"] === "string" ? row["condition"] : "";
          return name.trim() ? [{ name, quantity, condition }] : [];
        })
        .slice(0, 15)
    : undefined;

  return {
    agreementNumber: stringValue("agreementNumber"),
    contractCity: stringValue("contractCity"),
    signedDate: stringValue("signedDate"),
    paymentDueDay: numberValue("paymentDueDay"),
    depositAmount: numberValue("depositAmount"),
    utilitiesTerms: stringValue("utilitiesTerms"),
    noticeDays: numberValue("noticeDays"),
    ownerPassport: stringValue("ownerPassport"),
    ownerRegistrationAddress: stringValue("ownerRegistrationAddress"),
    tenantPassport: stringValue("tenantPassport"),
    tenantRegistrationAddress: stringValue("tenantRegistrationAddress"),
    inventoryItems,
  };
}

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

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));
}

function optionalDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "«___» __________ 20___ г.";
  return text(formatDate(value));
}

function filled(value: string | undefined, fallback: string) {
  return text(value, fallback);
}

export function buildAgreementDocumentHtml(data: AgreementDocumentData) {
  const details = data.contractDetails ?? {};
  const inventoryItems = (details.inventoryItems ?? [])
    .filter((item) => item.name.trim())
    .slice(0, 15);
  const inventoryRows = [
    ...inventoryItems.map(
      (item, index) =>
        `<tr><td>${index + 1}</td><td>${text(item.name, "")}</td><td>${text(item.quantity, "")}</td><td>${text(item.condition, "")}</td></tr>`,
    ),
    ...Array.from(
      { length: Math.max(0, 9 - inventoryItems.length) },
      (_, index) =>
        `<tr><td>${inventoryItems.length + index + 1}</td><td></td><td></td><td></td></tr>`,
    ),
  ].join("");
  const agreementNumber = filled(
    details.agreementNumber,
    data.agreementId.slice(0, 8).toUpperCase(),
  );
  const residential = data.propertyType === "apartment";
  const documentTitle = residential ? "Договор найма жилого помещения" : "Договор аренды помещения";
  const ownerRole = residential ? "Наймодатель" : "Арендодатель";
  const tenantRole = residential ? "Наниматель" : "Арендатор";
  const ownerRoleGenitive = residential ? "Наймодателя" : "Арендодателя";
  const tenantRoleGenitive = residential ? "Нанимателя" : "Арендатора";
  const propertyName = text(data.propertyName);
  const propertyAddress = text(data.propertyAddress);
  const startDate = text(formatDate(data.startDate));
  const endDate = text(formatDate(data.endDate));
  const monthlyPayment = text(formatMoney(data.monthlyPayment));
  const contractCity = filled(details.contractCity, "__________________");
  const signedDate = optionalDate(details.signedDate);
  const paymentDueDay = details.paymentDueDay ? String(details.paymentDueDay) : "___";
  const depositAmount =
    details.depositAmount === null || details.depositAmount === undefined
      ? "__________ рублей"
      : text(formatMoney(details.depositAmount));
  const utilitiesTerms = filled(
    details.utilitiesTerms,
    "________________________________________________________________",
  );
  const noticeDays = details.noticeDays ? String(details.noticeDays) : "______";
  const tenantConfirmation = data.tenantAcceptedAt
    ? `Подтверждение ${tenantRoleGenitive.toLocaleLowerCase("ru-RU")} зафиксировано в сервисе ${text(formatDateTime(data.tenantAcceptedAt))}.${data.inventoryPhotoCount ? ` К акту приложено фотографий: ${data.inventoryPhotoCount}.` : ""}`
    : "";
  const premises = data.unitName
    ? `${text(data.unitName)}${data.unitArea ? `, площадь ${data.unitArea} м²` : ""}`
    : "объект полностью";

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${documentTitle} № ${agreementNumber}</title>
  <style>
    :root { color-scheme: light; font-family: Arial, sans-serif; color: #292522; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f4f1ed; }
    .toolbar { position: sticky; top: 0; display: flex; justify-content: center; gap: 12px; padding: 14px; background: #292522; }
    .toolbar button { border: 0; border-radius: 9px; padding: 10px 18px; font: inherit; cursor: pointer; }
    .toolbar .primary { background: #e94b57; color: white; }
    .page { position: relative; width: 210mm; min-height: 297mm; margin: 20px auto; padding: 18mm; background: white; box-shadow: 0 12px 40px rgba(41, 37, 34, .12); break-after: page; page-break-after: always; }
    .page:last-child { break-after: auto; page-break-after: auto; }
    .brand { color: #e94b57; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .cover h1 { margin: 24px 0 5px; font-size: 25px; text-align: center; }
    .number { margin: 0 0 28px; color: #716a64; text-align: center; }
    .cover h2 { margin: 24px 0 9px; font-size: 15px; }
    .cover p { margin: 7px 0; font-size: 13px; line-height: 1.55; }
    .summary { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; padding: 16px; border: 1px solid #e5dfd9; border-radius: 12px; background: #fcfaf8; }
    .summary span { display: block; color: #716a64; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
    .summary strong { display: block; margin-top: 4px; font-size: 13px; }
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; margin-top: 14px; }
    .party { padding-top: 12px; border-top: 1px solid #292522; }
    .muted { color: #716a64; }
    .notice { margin-top: 26px; padding: 12px 14px; border-left: 3px solid #e94b57; background: #fff4f2; font-size: 11px; line-height: 1.45; }
    .footer { margin-top: 30px; color: #8a827b; font-size: 10px; text-align: center; }
    .legal { padding: 15mm 18mm 17mm; color: #111; font-family: "Times New Roman", Times, serif; }
    .legal h1 { margin: 0 0 3mm; font-size: 17px; line-height: 1.15; text-align: center; text-transform: uppercase; }
    .legal .document-number { margin: 0 0 7mm; font-size: 13px; text-align: center; }
    .legal .place-date { display: flex; justify-content: space-between; margin-bottom: 6mm; font-size: 12px; }
    .legal h2 { margin: 5mm 0 2mm; font-size: 14px; text-align: center; }
    .legal h3 { margin: 3mm 0 1.5mm; font-size: 13px; }
    .legal p { margin: 1.4mm 0; font-size: 12px; line-height: 1.34; text-align: justify; text-indent: 8mm; }
    .legal p.no-indent { text-indent: 0; }
    .legal .page-number { position: absolute; right: 18mm; bottom: 8mm; font-size: 10px; }
    .details, .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
    .details { margin-top: 4mm; }
    .details > div { border: 1px solid #777; padding: 4mm; }
    .details p { margin: 1mm 0; text-align: left; text-indent: 0; }
    .signatures { margin-top: 10mm; }
    .signature { padding-top: 8mm; border-top: 1px solid #111; font-size: 12px; }
    .appendix-label { margin: 0 0 6mm; font-size: 11px; text-align: right; }
    .inventory { width: 100%; margin-top: 5mm; border-collapse: collapse; font-size: 11px; }
    .inventory th, .inventory td { min-height: 8mm; border: 1px solid #777; padding: 2mm; text-align: left; vertical-align: middle; overflow-wrap: anywhere; }
    .inventory th:nth-child(1), .inventory td:nth-child(1) { width: 9%; text-align: center; }
    .inventory th:nth-child(3), .inventory td:nth-child(3) { width: 15%; text-align: center; }
    .inventory th:nth-child(4), .inventory td:nth-child(4) { width: 28%; }
    @media screen and (max-width: 800px) {
      .page { width: 100%; min-height: 0; margin: 0; padding: 24px; }
      .summary, .parties, .details, .signatures { grid-template-columns: 1fr; }
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
  <main class="page cover">
    <div class="brand">Умная Аренда</div>
    <h1>${documentTitle}</h1>
    <p class="number">№ ${agreementNumber}</p>

    <section class="summary">
      <div><span>Объект</span><strong>${propertyName}</strong></div>
      <div><span>Помещение</span><strong>${premises}</strong></div>
      <div><span>Адрес</span><strong>${propertyAddress}</strong></div>
      <div><span>Арендная плата</span><strong>${monthlyPayment} в месяц</strong></div>
      <div><span>Начало аренды</span><strong>${startDate}</strong></div>
      <div><span>Окончание аренды</span><strong>${endDate}</strong></div>
    </section>

    <h2>Стороны</h2>
    <div class="parties">
      <div>
        <p><strong>${ownerRole}</strong></p>
        <p>${text(data.ownerName)}</p>
        <p class="muted">${text(data.ownerEmail)}<br>${text(data.ownerPhone)}</p>
      </div>
      <div>
        <p><strong>${tenantRole}</strong></p>
        <p>${text(data.tenantName)}</p>
        <p class="muted">${text(data.tenantEmail)}<br>${text(data.tenantPhone)}</p>
      </div>
    </div>

    <div class="notice"><strong>Черновик.</strong> Первый лист содержит краткую карточку. Далее расположен полный текст договора и акт приёма-передачи. Перед подписанием заполните пропуски, согласуйте индивидуальные условия и проверьте документ с юристом.</div>
    <div class="footer">Сформировано в сервисе «Умная Аренда»</div>
  </main>

  <section class="page legal">
    <h1>${documentTitle}</h1>
    <p class="document-number">№ ${agreementNumber}</p>
    <div class="place-date"><span>г. ${contractCity}</span><span>${signedDate}</span></div>
    <p>${ownerRole} ${text(data.ownerName)}, паспорт: ${filled(details.ownerPassport, "__________________________")}, зарегистрированный по адресу: ${filled(details.ownerRegistrationAddress, "__________________________")}, с одной стороны, и ${tenantRole} ${text(data.tenantName)}, паспорт: ${filled(details.tenantPassport, "__________________________")}, зарегистрированный по адресу: ${filled(details.tenantRegistrationAddress, "__________________________")}, с другой стороны, совместно именуемые «Стороны», заключили настоящий договор о нижеследующем.</p>

    <h2>1. Предмет договора</h2>
    <p>1.1. ${ownerRole} передаёт ${tenantRoleGenitive} за плату во временное владение и пользование объект «${propertyName}», расположенный по адресу: ${propertyAddress}, ${premises} (далее — «Помещение»).</p>
    <p>1.2. Помещение передаётся по акту приёма-передачи, являющемуся неотъемлемой частью настоящего договора. В акте Стороны фиксируют состояние Помещения, комплект ключей, показания приборов учёта и передаваемое имущество.</p>
    <p>1.3. ${ownerRole} подтверждает наличие законных оснований для передачи Помещения и отсутствие препятствий, исключающих его использование по назначению.</p>
    <p>1.4. ${residential ? `${tenantRole} использует Помещение исключительно для проживания.` : `${tenantRole} использует Помещение в соответствии с его назначением и согласованной Сторонами деятельностью.`} Передача Помещения третьим лицам и субаренда допускаются только с предварительного письменного согласия ${ownerRoleGenitive}.</p>

    <h2>2. Передача и возврат помещения</h2>
    <p>2.1. Передача Помещения осуществляется по акту не позднее даты начала аренды — ${startDate}, если Стороны письменно не согласовали иной срок.</p>
    <p>2.2. Вместе с Помещением передаются ключи, документы на оборудование и имущество согласно акту и описи.</p>
    <p>2.3. По окончании договора ${tenantRole} возвращает Помещение по акту в состоянии, в котором оно было получено, с учётом нормального износа.</p>
    <p>2.4. Обнаруженные при возврате повреждения и задолженности фиксируются в акте. Размер подлежащих возмещению расходов определяется документально подтверждёнными затратами либо соглашением Сторон.</p>
    <div class="page-number">2</div>
  </section>

  <section class="page legal">
    <h2>3. Права и обязанности сторон</h2>
    <h3>3.1. ${ownerRole} обязан</h3>
    <p>3.1.1. Передать Помещение и согласованное имущество в состоянии, пригодном для предусмотренного договором использования.</p>
    <p>3.1.2. Не препятствовать правомерному использованию Помещения и своевременно сообщать об обстоятельствах, способных повлиять на исполнение договора.</p>
    <p>3.1.3. Выполнять обязанности по капитальному ремонту, если необходимость ремонта возникла не по вине ${tenantRoleGenitive} и иное письменно не согласовано Сторонами.</p>
    <h3>3.2. ${ownerRole} вправе</h3>
    <p>3.2.1. Проверять состояние Помещения по предварительному уведомлению ${tenantRoleGenitive}, кроме аварийных и иных неотложных случаев.</p>
    <p>3.2.2. Требовать своевременной оплаты, устранения нарушений и возмещения документально подтверждённого ущерба.</p>
    <h3>3.3. ${tenantRole} обязан</h3>
    <p>3.3.1. Использовать Помещение по назначению, соблюдать правила эксплуатации, пожарной безопасности, санитарные нормы и права соседей.</p>
    <p>3.3.2. Своевременно вносить арендную плату и иные согласованные платежи.</p>
    <p>3.3.3. Обеспечивать сохранность Помещения и имущества, поддерживать их в исправном состоянии и выполнять текущий ремонт, вызванный обычной эксплуатацией.</p>
    <p>3.3.4. Незамедлительно уведомлять ${ownerRoleGenitive} об авариях, неисправностях и обстоятельствах, способных причинить ущерб, и принимать разумные меры по его предотвращению.</p>
    <p>3.3.5. Не производить перепланировку, переустройство, неотделимые улучшения и работы, затрагивающие инженерные системы, без письменного согласия ${ownerRoleGenitive}.</p>
    <p>3.3.6. Предоставлять доступ в Помещение для согласованного осмотра и проведения необходимых работ.</p>
    <p>3.3.7. Не передавать права по договору третьим лицам без письменного согласия ${ownerRoleGenitive}.</p>
    <h3>3.4. ${tenantRole} вправе</h3>
    <p>3.4.1. Пользоваться Помещением в течение срока договора при соблюдении его условий.</p>
    <p>3.4.2. Требовать устранения препятствий в пользовании и недостатков, за которые отвечает ${ownerRole}.</p>
    <div class="page-number">3</div>
  </section>

  <section class="page legal">
    <h2>4. Платежи и расчёты</h2>
    <p>4.1. Ежемесячная плата за пользование Помещением составляет ${monthlyPayment}.</p>
    <p>4.2. Плата вносится не позднее ${paymentDueDay}-го числа каждого оплачиваемого месяца способом, согласованным Сторонами. Обязательство считается исполненным в день передачи денежных средств либо зачисления на указанный ${ownerRoleGenitive} счёт.</p>
    <p>4.3. Обеспечительный платёж составляет ${depositAmount}. Условия его внесения, зачёта и возврата Стороны подтверждают до подписания договора.</p>
    <p>4.4. Коммунальные, эксплуатационные услуги, связь и интернет оплачиваются в следующем порядке: ${utilitiesTerms}.</p>
    <p>4.5. Изменение размера платы допускается по письменному соглашению Сторон, если иное прямо не предусмотрено законом.</p>

    <h2>5. Срок действия, изменение и расторжение</h2>
    <p>5.1. Помещение предоставляется на срок с ${startDate} по ${endDate} включительно.</p>
    <p>5.2. Договор вступает в силу с момента подписания обеими Сторонами. Обязательства по расчётам и возврату имущества действуют до их полного исполнения.</p>
    <p>5.3. Изменения и дополнения действительны, если совершены в письменной форме и подписаны обеими Сторонами.</p>
    <p>5.4. Каждая Сторона вправе отказаться от договора, письменно уведомив другую Сторону не менее чем за ${noticeDays} календарных дней, если иной срок не установлен соглашением Сторон или законом.</p>
    <p>5.5. Договор может быть расторгнут досрочно при существенном нарушении его условий, в том числе при систематической просрочке оплаты, использовании Помещения не по назначению, причинении ущерба или создании препятствий для пользования.</p>

    <h2>6. Ответственность и обстоятельства непреодолимой силы</h2>
    <p>6.1. За нарушение обязательств Стороны отвечают в соответствии с договором и законодательством Российской Федерации.</p>
    <p>6.2. Виновная Сторона возмещает другой Стороне документально подтверждённые убытки в части, не покрытой неустойкой, если она согласована Сторонами.</p>
    <p>6.3. Сторона освобождается от ответственности за неисполнение, вызванное чрезвычайными и непредотвратимыми обстоятельствами, если своевременно уведомила другую Сторону и представила разумные подтверждения.</p>
    <div class="page-number">4</div>
  </section>

  <section class="page legal">
    <h2>7. Разрешение споров</h2>
    <p>7.1. Разногласия Стороны стремятся урегулировать переговорами и письменными претензиями.</p>
    <p>7.2. Срок ответа на письменную претензию составляет 10 рабочих дней со дня её получения.</p>
    <p>7.3. Неурегулированный спор передаётся в суд в порядке, установленном законодательством Российской Федерации.</p>

    <h2>8. Заключительные положения</h2>
    <p>8.1. Юридически значимые сообщения направляются по адресам и контактам, указанным в настоящем договоре, способом, позволяющим подтвердить отправку и получение.</p>
    <p>8.2. Недействительность отдельного положения не влечёт недействительность договора в целом.</p>
    <p>8.3. Договор составлен в двух экземплярах равной юридической силы, по одному для каждой Стороны.</p>
    <p>8.4. Неотъемлемой частью договора является акт приёма-передачи Помещения и имущества.</p>

    <h2>9. Данные и подписи сторон</h2>
    <div class="details">
      <div>
        <p><strong>${ownerRole}</strong></p>
        <p>ФИО: ${text(data.ownerName)}</p>
        <p>Паспорт: ${filled(details.ownerPassport, "__________________________")}</p>
        <p>Адрес регистрации: ${filled(details.ownerRegistrationAddress, "_________________")}</p>
        <p>Email: ${text(data.ownerEmail)}</p>
        <p>Телефон: ${text(data.ownerPhone)}</p>
      </div>
      <div>
        <p><strong>${tenantRole}</strong></p>
        <p>ФИО: ${text(data.tenantName)}</p>
        <p>Паспорт: ${filled(details.tenantPassport, "__________________________")}</p>
        <p>Адрес регистрации: ${filled(details.tenantRegistrationAddress, "_________________")}</p>
        <p>Email: ${text(data.tenantEmail)}</p>
        <p>Телефон: ${text(data.tenantPhone)}</p>
      </div>
    </div>
    <div class="signatures">
      <div class="signature">${ownerRole} / ${text(data.ownerName)}</div>
      <div class="signature">${tenantRole} / ${text(data.tenantName)}</div>
    </div>
    <div class="page-number">5</div>
  </section>

  <section class="page legal">
    <p class="appendix-label">Приложение № 1 к договору № ${agreementNumber}</p>
    <h1>Акт приёма-передачи помещения и имущества</h1>
    <div class="place-date"><span>г. ${contractCity}</span><span>${signedDate}</span></div>
    <p>${ownerRole} ${text(data.ownerName)} передал, а ${tenantRole} ${text(data.tenantName)} принял Помещение: объект «${propertyName}», адрес ${propertyAddress}, ${premises}.</p>
    <p>Стороны осмотрели Помещение. Его состояние, замечания, показания приборов учёта и количество переданных ключей указываются ниже.</p>
    <p class="no-indent"><strong>Состояние и замечания:</strong> ________________________________________________________________<br>__________________________________________________________________________________________</p>
    <p class="no-indent"><strong>Ключи и приборы учёта:</strong> _________________________________________________________________<br>__________________________________________________________________________________________</p>
    <table class="inventory">
      <thead><tr><th>№</th><th>Наименование имущества</th><th>Кол-во</th><th>Состояние</th></tr></thead>
      <tbody>
        ${inventoryRows}
      </tbody>
    </table>
    <p>С момента подписания настоящего акта обязанность по передаче Помещения считается исполненной. Акт составлен в двух экземплярах, по одному для каждой Стороны.</p>
    ${tenantConfirmation ? `<p class="no-indent"><strong>Электронное подтверждение:</strong> ${tenantConfirmation}</p>` : ""}
    <div class="signatures">
      <div class="signature">Передал: ${ownerRole} / ${text(data.ownerName)}</div>
      <div class="signature">Принял: ${tenantRole} / ${text(data.tenantName)}</div>
    </div>
    <div class="page-number">6</div>
  </section>
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
