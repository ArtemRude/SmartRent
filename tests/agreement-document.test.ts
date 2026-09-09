import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgreementDocumentHtml,
  type AgreementDocumentData,
} from "../src/lib/agreement-document.ts";

const agreement: AgreementDocumentData = {
  agreementId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
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

test("agreement document contains the contract data and printable A4 layout", () => {
  const html = buildAgreementDocumentHtml(agreement);

  assert.match(html, /Договор аренды/);
  assert.match(html, /A1B2C3D4/);
  assert.match(html, /65(?:&nbsp;|\s)000\s₽/u);
  assert.match(html, /1 сентября 2026 г\./);
  assert.match(html, /@page \{ size: A4/);
  assert.match(html, /Черновик\./);
});

test("agreement document escapes user-provided text", () => {
  const html = buildAgreementDocumentHtml(agreement);

  assert.doesNotMatch(html, /Квартира <Центр>/);
  assert.match(html, /Квартира &lt;Центр&gt;/);
  assert.match(html, /Иван &amp; Партнёры/);
});
