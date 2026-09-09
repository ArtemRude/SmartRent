export type ForecastAgreement = {
  id: string;
  status: string;
  startDate: string;
  endDate: string;
  monthlyPayment: number;
  propertyId: string;
  propertyName: string;
  tenantId: string;
  tenantName: string;
};

export type ForecastMonth = {
  period: string;
  expected: number;
  activeContracts: number;
};

function monthKey(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addMonths(period: string, offset: number) {
  const [year, month] = period.split("-").map(Number);
  return monthKey(new Date(Date.UTC(year!, month! - 1 + offset, 1)));
}

function lastDayOfMonth(period: string) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10);
}

export function buildRentForecast({
  agreements,
  startPeriod,
  horizonMonths,
}: {
  agreements: ForecastAgreement[];
  startPeriod: string;
  horizonMonths: number;
}) {
  const periods = Array.from({ length: horizonMonths }, (_, index) =>
    addMonths(startPeriod, index),
  );
  const horizonStart = `${startPeriod}-01`;
  const horizonEnd = lastDayOfMonth(periods.at(-1) ?? startPeriod);
  const relevantContracts = agreements.filter(
    (agreement) =>
      agreement.status === "active" &&
      agreement.startDate <= horizonEnd &&
      agreement.endDate >= horizonStart,
  );

  const months: ForecastMonth[] = periods.map((period) => {
    const firstDay = `${period}-01`;
    const lastDay = lastDayOfMonth(period);
    const active = relevantContracts.filter(
      (agreement) => agreement.startDate <= lastDay && agreement.endDate >= firstDay,
    );

    return {
      period,
      expected: active.reduce((sum, agreement) => sum + agreement.monthlyPayment, 0),
      activeContracts: active.length,
    };
  });

  return {
    months,
    contracts: relevantContracts.sort(
      (a, b) => a.endDate.localeCompare(b.endDate) || a.propertyName.localeCompare(b.propertyName),
    ),
    totalExpected: months.reduce((sum, month) => sum + month.expected, 0),
    expiringContracts: relevantContracts.filter(
      (agreement) => agreement.endDate >= horizonStart && agreement.endDate <= horizonEnd,
    ).length,
  };
}
