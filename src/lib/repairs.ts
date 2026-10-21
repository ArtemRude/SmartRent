export type RepairStatus =
  "draft" | "pending" | "approved" | "in_progress" | "review" | "completed" | "cancelled";
export type RepairRole = "owner" | "manager" | "viewer" | "tenant";
export type RepairProperty = {
  id: string;
  owner_id: string;
  name: string;
  address: string;
  role: RepairRole;
};
export type RepairContractor = {
  id: string;
  owner_id: string;
  name: string;
  specialty: string;
  phone: string;
  email: string;
  note: string;
  active: boolean;
  revision: number;
};
export type EstimateItem = { name: string; quantity: number; unit_price: number; amount: number };
export type EstimateInput = { name: string; quantity: string; unit_price: string };
export type RepairJob = {
  id: string;
  property_id: string;
  owner_id: string;
  request_id: string | null;
  request_title: string | null;
  contractor_id: string | null;
  contractor_snapshot: Pick<RepairContractor, "name" | "specialty" | "phone" | "email"> | null;
  title: string;
  description: string;
  scheduled_date: string;
  due_date: string;
  estimate_items: EstimateItem[];
  estimated_total: number | null;
  status: RepairStatus;
  actual_amount: number | null;
  result_note: string;
  result_photos: string[];
  decision_note: string;
  expense_id: string | null;
  published_at: string | null;
  completed_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
  property_name: string;
  role: RepairRole;
};
export type RepairEvent = {
  id: string;
  job_id: string;
  actor_name: string;
  action: string;
  snapshot: RepairJob;
  created_at: string;
};
export type RepairRequest = { id: string; property_id: string; title: string; description: string };
export type RepairsOverview = {
  properties: RepairProperty[];
  contractors: RepairContractor[];
  requests: RepairRequest[];
  jobs: RepairJob[];
  events: RepairEvent[];
  jobs_truncated: boolean;
  events_truncated: boolean;
};
export const repairStatusLabels: Record<RepairStatus, string> = {
  draft: "Черновик",
  pending: "Смета на согласовании",
  approved: "Смета согласована",
  in_progress: "В работе",
  review: "На приёмке",
  completed: "Принято",
  cancelled: "Отменено",
};
export const repairActionLabels: Record<string, string> = {
  draft_saved: "Смета сохранена",
  submit: "Смета отправлена",
  approve: "Смета согласована",
  reject: "Смета возвращена",
  start: "Работа начата",
  report: "Отчёт передан на приёмку",
  return: "Результат возвращён на доработку",
  accept: "Работа принята",
  cancel: "Работа отменена",
  expense: "Создан плановый расход",
};
export const repairMoney = (value: number | null) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("ru-RU", {
        style: "currency",
        currency: "RUB",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
function scaled(input: string) {
  const text = input.trim().replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(text))
    throw new Error("Укажите положительное число с точностью до двух знаков");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
}
export function repairAmount(input: string) {
  const value = scaled(input);
  if (value <= 0n || value >= 100000000000n)
    throw new Error("Сумма должна быть больше нуля и меньше 1 млрд ₽");
  return Number(value) / 100;
}
export function buildRepairEstimate(rows: EstimateInput[]) {
  if (!rows.length || rows.length > 30) throw new Error("Добавьте от 1 до 30 строк сметы");
  let total = 0n;
  const items = rows.map((row) => {
    const name = row.name.trim(),
      quantity = scaled(row.quantity),
      price = scaled(row.unit_price);
    if (
      !name ||
      name.length > 120 ||
      quantity <= 0n ||
      quantity > 1000000n ||
      price <= 0n ||
      price >= 100000000000n
    )
      throw new Error("Проверьте описание, количество и цену в смете");
    const amount = (quantity * price + 50n) / 100n;
    total += amount;
    return {
      name,
      quantity: Number(quantity) / 100,
      unit_price: Number(price) / 100,
      amount: Number(amount) / 100,
    };
  });
  if (total <= 0n || total >= 100000000000n)
    throw new Error("Итог сметы должен быть больше нуля и меньше 1 млрд ₽");
  return { items, total: Number(total) / 100 };
}
export function repairOverdue(job: Pick<RepairJob, "status" | "due_date">, today: string) {
  return !["completed", "cancelled"].includes(job.status) && job.due_date < today;
}
