import { getRentChargeBalance, getRentChargeTotal } from "./domain.ts";
import type { UtilityBill } from "./utilities.ts";

export type UtilitySummaryCharge = {
  id: string;
  agreement_id: string;
  period_start: string;
  charge_type?: "rent" | "utilities";
  amount: number;
  adjustment_amount?: number | null;
  paid_amount?: number | null;
  paid_at?: string | null;
};

const sumMoney = (values: number[]) =>
  values.reduce((sum, value) => sum + Math.round(value * 100), 0) / 100;

export function buildUtilityMonthlySummary({
  agreementId,
  period,
  charges,
  bills,
  previewAmount,
}: {
  agreementId: string;
  period: string;
  charges: UtilitySummaryCharge[];
  bills: UtilityBill[];
  previewAmount?: number | null;
}) {
  const periodCharges = charges.filter(
    (charge) => charge.agreement_id === agreementId && charge.period_start.slice(0, 7) === period,
  );
  const rent = periodCharges.filter((charge) => charge.charge_type !== "utilities");
  const utilities = periodCharges.filter((charge) => charge.charge_type === "utilities");
  const periodBills = bills.filter(
    (bill) => bill.agreement_id === agreementId && bill.period_start.slice(0, 7) === period,
  );
  const bill =
    periodBills.find((bill) => bill.status === "approved") ??
    periodBills.find((bill) => bill.status === "pending");
  const state =
    utilities.length > 0 || bill?.status === "approved"
      ? "approved"
      : bill?.status === "pending"
        ? "pending"
        : previewAmount != null
          ? "estimate"
          : "missing";
  const rentTotal = rent.length ? sumMoney(rent.map(getRentChargeTotal)) : null;
  const utilityTotal = utilities.length
    ? sumMoney(utilities.map(getRentChargeTotal))
    : bill
      ? Number(bill.amount)
      : (previewAmount ?? null);
  const incomplete =
    bill?.status === "approved" &&
    Number(bill.amount) > 0 &&
    !periodCharges.some((charge) => charge.id === bill.charge_id);
  return {
    state,
    rentTotal,
    utilityTotal,
    total: rentTotal !== null && utilityTotal !== null ? sumMoney([rentTotal, utilityTotal]) : null,
    paid: incomplete
      ? null
      : sumMoney(
          periodCharges.map((charge) => getRentChargeTotal(charge) - getRentChargeBalance(charge)),
        ),
    remaining: incomplete ? null : sumMoney(periodCharges.map(getRentChargeBalance)),
  };
}
