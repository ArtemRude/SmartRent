export type DebtItem = {
  chargeId: string;
  agreementId: string;
  propertyName: string;
  tenantName: string;
  amount: number;
  dueDate: string;
};

export type DebtGroup = {
  agreementId: string;
  propertyName: string;
  tenantName: string;
  total: number;
  overdueCount: number;
  oldestDueDate: string;
  daysOverdue: number;
  chargeIds: string[];
};

function utcDay(value: string) {
  return Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
}

export function buildDebtGroups(items: DebtItem[], today: string): DebtGroup[] {
  const groups = new Map<string, Omit<DebtGroup, "daysOverdue">>();

  for (const item of items) {
    const current = groups.get(item.agreementId) ?? {
      agreementId: item.agreementId,
      propertyName: item.propertyName,
      tenantName: item.tenantName,
      total: 0,
      overdueCount: 0,
      oldestDueDate: item.dueDate,
      chargeIds: [],
    };

    current.total += item.amount;
    current.overdueCount += 1;
    current.oldestDueDate =
      item.dueDate < current.oldestDueDate ? item.dueDate : current.oldestDueDate;
    current.chargeIds.push(item.chargeId);
    groups.set(item.agreementId, current);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      daysOverdue: Math.max(
        0,
        Math.round((utcDay(today) - utcDay(group.oldestDueDate)) / 86_400_000),
      ),
    }))
    .sort((a, b) => b.total - a.total || b.daysOverdue - a.daysOverdue);
}
