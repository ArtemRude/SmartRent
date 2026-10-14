export type UtilityKind = "meter" | "fixed";
export type UtilityBillStatus = "pending" | "approved" | "rejected";

export type UtilityService = {
  id: string;
  agreement_id: string;
  name: string;
  kind: UtilityKind;
  unit: string;
  rate: number;
  initial_reading: number;
  start_period: string;
  active: boolean;
  created_at: string;
};

export type UtilityBill = {
  id: string;
  agreement_id: string;
  period_start: string;
  status: UtilityBillStatus;
  amount: number;
  submitted_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  charge_id: string | null;
  created_at: string;
};

export type UtilityBillItem = {
  id: string;
  bill_id: string;
  service_id: string;
  name: string;
  kind: UtilityKind;
  unit: string;
  previous_reading: number | null;
  reading: number | null;
  rate: number;
  amount: number;
  photo_path: string | null;
};

export const utilityStatusLabels: Record<UtilityBillStatus, string> = {
  pending: "На проверке",
  approved: "Утверждено",
  rejected: "Нужно исправить",
};

export function parseUtilityNumber(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) && number < 1_000_000_000 ? number : null;
}

// Readings have 3 decimal places, rates 4, and each line is rounded to kopecks.
// Integer multiplication mirrors Postgres numeric rounding without float drift.
export function utilityLineAmount(previous: number, reading: number, rate: number) {
  if (
    ![previous, reading, rate].every(Number.isFinite) ||
    previous < 0 ||
    reading < previous ||
    rate < 0
  ) {
    throw new Error("Проверьте показания и тариф");
  }
  const consumption = BigInt(Math.round(reading * 1000)) - BigInt(Math.round(previous * 1000));
  const tariff = BigInt(Math.round(rate * 10000));
  const kopecks = (consumption * tariff + 50000n) / 100000n;
  if (kopecks >= 100000000000000n) {
    throw new Error("Сумма слишком большая. Проверьте показания и тариф");
  }
  return Number(kopecks) / 100;
}

export function previousUtilityReading(
  service: UtilityService,
  bills: UtilityBill[],
  items: UtilityBillItem[],
) {
  const approved = new Map(
    bills.filter((bill) => bill.status === "approved").map((bill) => [bill.id, bill.period_start]),
  );
  const latest = items
    .filter(
      (item) =>
        item.service_id === service.id && item.reading !== null && approved.has(item.bill_id),
    )
    .sort((a, b) => approved.get(b.bill_id)!.localeCompare(approved.get(a.bill_id)!))[0];
  return latest?.reading ?? Number(service.initial_reading);
}

export function formatUtilityMoney(amount: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatUtilityValue(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 4 }).format(value);
}
