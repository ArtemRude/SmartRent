import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { Agreement, Property, RentCharge, RentPayment } from "./queries";
import type { ExpenseEvent, ExpenseValues, PropertyExpense } from "./property-finances";

type FinanceTable =
  | "properties"
  | "lease_agreements"
  | "rent_charges"
  | "rent_payments"
  | "property_expenses"
  | "property_expense_events";
async function rows<T>(
  table: FinanceTable,
  optional = false,
): Promise<{ rows: T[]; available: boolean }> {
  const result: T[] = [];
  // Stable pagination avoids silently using the Data API's default 1,000-row cap.
  for (let from = 0; from < 100_000;) {
    const { data, error, count } = await supabase
      .from(table)
      .select("*", { count: "exact" })
      .order("id")
      .range(from, from + 499);
    if (error) {
      if (optional && error.code === "PGRST205") return { rows: [], available: false };
      throw new Error(error.message);
    }
    result.push(...((data ?? []) as unknown as T[]));
    const loaded = data?.length ?? 0;
    if (loaded === 0) {
      if (count !== null && from < count)
        throw new Error("Не удалось прочитать все записи отчёта. Обновите данные.");
      return { rows: result, available: true };
    }
    from += loaded;
    if ((count !== null && from >= count) || (count === null && loaded < 500))
      return { rows: result, available: true };
  }
  throw new Error("Слишком много записей для отчёта. Обратитесь в поддержку.");
}
export async function fetchFinanceSources() {
  const [properties, agreements, charges, payments] = await Promise.all([
    rows<Property>("properties"),
    rows<Agreement>("lease_agreements"),
    rows<RentCharge>("rent_charges"),
    rows<RentPayment>("rent_payments", true),
  ]);
  return {
    properties: properties.rows,
    agreements: agreements.rows,
    charges: charges.rows,
    payments: payments.rows,
    paymentsAvailable: payments.available,
  };
}
export async function fetchPropertyExpenses() {
  const [expenses, events] = await Promise.all([
    rows<PropertyExpense>("property_expenses", true),
    rows<ExpenseEvent>("property_expense_events", true),
  ]);
  return {
    available: expenses.available && events.available,
    expenses: expenses.rows,
    events: events.rows,
  };
}
export async function savePropertyExpense(
  propertyId: string,
  values: ExpenseValues,
  initial: PropertyExpense | null,
  reason: string,
) {
  const { data, error } = await supabase.rpc("save_property_expense", {
    p_property_id: propertyId,
    p_values: values as unknown as Json,
    p_expense_id: initial?.id ?? null,
    p_expected_revision: initial?.revision ?? null,
    p_reason: reason.trim() || null,
  });
  if (error) throw new Error(error.message);
  return data;
}
