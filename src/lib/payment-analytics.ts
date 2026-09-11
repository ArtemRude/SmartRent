export type PaymentAnalyticsItem = {
  amount: number;
  paid?: boolean;
  paidAmount?: number;
  period: string;
  propertyId: string;
  propertyName: string;
};

export type PaymentAnalyticsGroup = {
  accrued: number;
  paid: number;
};

export function buildPaymentAnalytics(items: PaymentAnalyticsItem[]) {
  let accrued = 0;
  let paid = 0;
  const months = new Map<string, PaymentAnalyticsGroup>();
  const properties = new Map<
    string,
    PaymentAnalyticsGroup & { propertyId: string; propertyName: string }
  >();

  for (const item of items) {
    const month = months.get(item.period) ?? { accrued: 0, paid: 0 };
    const property = properties.get(item.propertyId) ?? {
      propertyId: item.propertyId,
      propertyName: item.propertyName,
      accrued: 0,
      paid: 0,
    };

    accrued += item.amount;
    month.accrued += item.amount;
    property.accrued += item.amount;

    const itemPaid = Math.min(item.amount, item.paidAmount ?? (item.paid ? item.amount : 0));
    paid += itemPaid;
    month.paid += itemPaid;
    property.paid += itemPaid;

    months.set(item.period, month);
    properties.set(item.propertyId, property);
  }

  return {
    accrued,
    paid,
    unpaid: accrued - paid,
    collectionRate: accrued > 0 ? Math.round((paid / accrued) * 100) : 0,
    months: Array.from(months, ([period, totals]) => ({ period, ...totals })).sort((a, b) =>
      a.period.localeCompare(b.period),
    ),
    properties: Array.from(properties.values()).sort(
      (a, b) => b.accrued - a.accrued || a.propertyName.localeCompare(b.propertyName, "ru"),
    ),
  };
}
