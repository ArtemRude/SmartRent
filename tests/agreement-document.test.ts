import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgreementDocumentHtml,
  type AgreementDocumentData,
} from "../src/lib/agreement-document.ts";

const agreement: AgreementDocumentData = {
  agreementId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  propertyType: "apartment",
  propertyName: "Квартира <Центр>",
  propertyAddress: "Москва, ул. Тестовая, 7",
  unitName: "Помещение № 2",
  unitArea: 42,
  tenantName: "Иван & Партнёры",
  tenantEmail: "tenant@example.com",
  tenantPhone: "+7 900 000-00-00",
  ownerName: "Антон Собственник",
  ownerEmail: "owner@example.com",
  ownerPhone: null,
  startDate: "2026-09-01",
  endDate: "2027-08-31",
  monthlyPayment: 65_000,
};

test("agreement document contains a cover, formal contract and transfer act", () => {
  const html = buildAgreementDocumentHtml(agreement);

  assert.match(html, /Договор найма жилого помещения/);
  assert.match(html, /A1B2C3D4/);
  assert.match(html, /65(?:&nbsp;|\s)000\s₽/u);
  assert.match(html, /1 сентября 2026 г\./);
  assert.match(html, /@page \{ size: A4/);
  assert.match(html, /Черновик\./);
  assert.match(html, /Права и обязанности сторон/);
  assert.match(html, /Платежи и расчёты/);
  assert.match(html, /Акт приёма-передачи помещения и имущества/);
  assert.equal((html.match(/class="page(?:\s|")/g) ?? []).length, 6);
});

test("agreement document escapes user-provided text", () => {
  const html = buildAgreementDocumentHtml(agreement);

  assert.doesNotMatch(html, /Квартира <Центр>/);
  assert.match(html, /Квартира &lt;Центр&gt;/);
  assert.match(html, /Иван &amp; Партнёры/);
});

test("non-residential property uses lease terminology", () => {
  const html = buildAgreementDocumentHtml({ ...agreement, propertyType: "commercial" });

  assert.match(html, /Договор аренды помещения/);
  assert.match(html, /Арендодатель/);
  assert.match(html, /Арендатор/);
});

test("agreement document inserts saved contract details", () => {
  const html = buildAgreementDocumentHtml({
    ...agreement,
    contractDetails: {
      agreementNumber: "12/2026",
      contractCity: "Москва",
      signedDate: "2026-08-28",
      paymentDueDay: 10,
      depositAmount: 65_000,
      utilitiesTerms: "оплачиваются нанимателем по квитанциям",
      noticeDays: 30,
      ownerPassport: "00 00 № 000000",
      ownerRegistrationAddress: "г. Москва, тестовый адрес 1",
      tenantPassport: "11 11 № 111111",
      tenantRegistrationAddress: "г. Москва, тестовый адрес 2",
      inventoryItems: [
        { name: "Холодильник Samsung", quantity: "1 шт.", condition: "Исправное" },
        { name: "Стол & 4 стула", quantity: "1 комплект", condition: "Небольшие царапины" },
      ],
    },
  });

  assert.match(html, /№ 12\/2026/);
  assert.match(html, /г\. Москва/);
  assert.match(html, /28 августа 2026 г\./);
  assert.match(html, /не позднее 10-го числа/);
  assert.match(html, /за 30 календарных дней/);
  assert.match(html, /оплачиваются нанимателем по квитанциям/);
  assert.match(html, /00 00 № 000000/);
  assert.match(html, /Холодильник Samsung/);
  assert.match(html, /1 комплект/);
  assert.match(html, /Стол &amp; 4 стула/);
  assert.equal((html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr>/g) ?? []).length, 9);
});

test("agreement document escapes contract detail text", () => {
  const html = buildAgreementDocumentHtml({
    ...agreement,
    contractDetails: {
      agreementNumber: "<12>",
      utilitiesTerms: "собственник & наниматель",
      inventoryItems: [{ name: "Телевизор <OLED>", quantity: "1", condition: "как новый" }],
    },
  });

  assert.doesNotMatch(html, /№ <12>/);
  assert.match(html, /№ &lt;12&gt;/);
  assert.match(html, /собственник &amp; наниматель/);
  assert.doesNotMatch(html, /Телевизор <OLED>/);
  assert.match(html, /Телевизор &lt;OLED&gt;/);
});
