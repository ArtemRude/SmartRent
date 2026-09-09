import assert from "node:assert/strict";
import { test } from "node:test";
import { createCsv } from "../src/lib/csv.ts";

test("CSV is UTF-8 friendly and uses the Excel-compatible semicolon delimiter", () => {
  assert.equal(
    createCsv(["Статус", "Сумма"], [["Оплачено", 45_000]]),
    "\uFEFFСтатус;Сумма\r\nОплачено;45000",
  );
});

test("CSV safely escapes delimiters, quotes, and line breaks", () => {
  assert.equal(
    createCsv(["Комментарий"], [['Перевод; пометка "май"\nпроверено']]),
    '\uFEFFКомментарий\r\n"Перевод; пометка ""май""\nпроверено"',
  );
});
