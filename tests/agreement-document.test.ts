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
