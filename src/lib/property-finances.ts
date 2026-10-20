import type { Agreement, Property, RentCharge, RentPayment } from "./queries";
import type { Json } from "../integrations/supabase/types";

export const expenseCategories = {
  repair: "Ремонт",
  maintenance: "Обслуживание",
  tax: "Налоги",
  insurance: "Страхование",
  management: "Управление",
  other: "Другое",
} as const;
export type ExpenseCategory = keyof typeof expenseCategories;
export type PropertyExpense = {
  id: string;
  property_id: string;
  title: string;
  category: ExpenseCategory;
  planned_date: string;
  planned_amount: number;
  status: "planned" | "paid" | "cancelled";
  paid_date: string | null;
  paid_amount: number | null;
  receipt_file: string | null;
  note: string;
  revision: number;
  created_at: string;
  updated_at: string;
};
export type ExpenseEvent = {
  id: string;
  expense_id: string;
  actor_id: string | null;
  reason: string | null;
  snapshot: Json;
  created_at: string;
};
export type ExpenseValues = Pick<
  PropertyExpense,
  | "title"
  | "category"
  | "planned_date"
  | "planned_amount"
  | "status"
  | "paid_date"
  | "paid_amount"
  | "receipt_file"
  | "note"
>;
export const expenseStatusLabels = {
  planned: "Запланирован",
  paid: "Оплачен",
  cancelled: "Отменён",
};
export const financeMoney = (amount: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 2,
  }).format(amount);
export function parseExpenseAmount(value: string): number | null {
  const text = value.trim().replace(",", ".");
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text);
  return amount > 0 && amount < 1_000_000_000 ? amount : null;
}
export function financeMonths(from: string, to: string): string[] {
  if (![from, to].every((x) => /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(x)) || from > to) return [];
  const months: string[] = [];
  let cursor = from;
  while (cursor <= to && months.length < 25) {
    months.push(cursor);
    const [year, month] = cursor.split("-").map(Number) as [number, number];
    cursor = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  }
  return months.length > 24 ? [] : months;
}
const kopecks = (value: number) => {
  if (!Number.isFinite(Number(value)) || Math.abs(Number(value)) >= 1e12)
    throw new Error("Некорректная сумма в данных");
  return Math.round(Number(value) * 100);
};
type Totals = {
  plannedIncome: number;
  income: number;
  plannedExpenses: number;
  expenses: number;
  plannedResult: number;
  result: number;
};
export type FinancePoint = Totals & { id: string; name: string };
const blank = (): Totals => ({
  plannedIncome: 0,
  income: 0,
  plannedExpenses: 0,
  expenses: 0,
  plannedResult: 0,
  result: 0,
});
export function buildPropertyFinances(input: {
  properties: Pick<Property, "id" | "name">[];
  agreements: Pick<Agreement, "id" | "property_id">[];
  charges: Pick<
    RentCharge,
    | "id"
    | "agreement_id"
    | "amount"
    | "adjustment_amount"
    | "period_start"
    | "charge_type"
    | "paid_amount"
  >[];
  payments: Pick<RentPayment, "id" | "charge_id" | "amount" | "paid_at">[];
  paymentsAvailable: boolean;
  expenses: PropertyExpense[];
  from: string;
  to: string;
  propertyId?: string;
}) {
  const selectedMonths = financeMonths(input.from, input.to);
  const months = new Map(selectedMonths.map((id) => [id, { ...blank(), id, name: id }]));
  const properties = new Map(
    input.properties
      .filter((p) => !input.propertyId || p.id === input.propertyId)
      .map((p) => [p.id, { ...blank(), id: p.id, name: p.name }]),
  );
  const agreementProperties = new Map(input.agreements.map((a) => [a.id, a.property_id]));
  const charges = new Map(input.charges.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const paidTotals = new Map<string, number>();
  const issues = new Set<string>();
  const add = (
    propertyId: string | undefined,
    date: string,
    key: "income" | "plannedIncome" | "expenses" | "plannedExpenses",
    value: number,
  ) => {
    if (!propertyId) return;
    const property = properties.get(propertyId),
      month = months.get(date.slice(0, 7));
    if (!property || !month) return;
    const amount = kopecks(value);
    property[key] += amount;
    month[key] += amount;
  };
  if (!input.paymentsAvailable)
    issues.add("Журнал платежей недоступен. Фактический результат нельзя рассчитать.");
  for (const charge of input.charges) {
    if (charge.charge_type === "utilities") continue;
    const property = agreementProperties.get(charge.agreement_id);
    if (!property || !properties.has(property)) continue;
    add(
      property,
      charge.period_start,
      "plannedIncome",
      Number(charge.amount) + Number(charge.adjustment_amount ?? 0),
    );
  }
  for (const payment of input.payments) {
    if (seen.has(payment.id)) continue;
    seen.add(payment.id);
    const charge = charges.get(payment.charge_id);
    if (!charge) {
      issues.add("Есть платежи без доступного начисления. Фактический результат неполон.");
      continue;
    }
    if (charge.charge_type === "utilities") continue;
    const property = agreementProperties.get(charge.agreement_id);
    if (!property) {
      issues.add("Для части платежей не найден объект. Фактический результат неполон.");
      continue;
    }
    paidTotals.set(charge.id, (paidTotals.get(charge.id) ?? 0) + kopecks(payment.amount));
    // Dates follow the recorded payment timestamp, consistent with the payment journal.
    add(property, payment.paid_at, "income", payment.amount);
  }
  for (const charge of input.charges) {
    if (
      charge.charge_type === "utilities" ||
      !properties.has(agreementProperties.get(charge.agreement_id) ?? "")
    )
      continue;
    if (kopecks(charge.paid_amount ?? 0) !== (paidTotals.get(charge.id) ?? 0))
      issues.add(
        "Суммы начислений и журнала платежей расходятся. Проверьте платежи перед использованием результата.",
      );
  }
  for (const expense of input.expenses) {
    if (expense.status === "cancelled") continue;
    add(expense.property_id, expense.planned_date, "plannedExpenses", expense.planned_amount);
    if (expense.status === "paid" && expense.paid_date && expense.paid_amount !== null)
      add(expense.property_id, expense.paid_date, "expenses", expense.paid_amount);
  }
  const convert = (point: FinancePoint): FinancePoint => ({
    ...point,
    plannedIncome: point.plannedIncome / 100,
    income: point.income / 100,
    plannedExpenses: point.plannedExpenses / 100,
    expenses: point.expenses / 100,
    plannedResult: (point.plannedIncome - point.plannedExpenses) / 100,
    result: (point.income - point.expenses) / 100,
  });
  const byProperty = [...properties.values()]
    .map(convert)
    .sort((a, b) => b.result - a.result || a.name.localeCompare(b.name, "ru"));
  const totals = byProperty.reduce((acc, p) => {
    for (const key of Object.keys(acc) as (keyof Totals)[]) acc[key] += kopecks(p[key]);
    return acc;
  }, blank());
  for (const key of Object.keys(totals) as (keyof Totals)[]) totals[key] /= 100;
  return {
    totals,
    properties: byProperty,
    months: [...months.values()].map(convert),
    issues: [...issues],
    actualComplete: issues.size === 0,
  };
}
