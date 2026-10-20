import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Download, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { PropertyExpenseEditor } from "@/components/PropertyExpenseEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/auth-context";
import { localDateKey, formatDate, formatDateTime } from "@/lib/domain";
import {
  buildPropertyFinances,
  expenseCategories,
  expenseStatusLabels,
  financeMoney,
  financeMonths,
  type PropertyExpense,
} from "@/lib/property-finances";
import {
  fetchFinanceSources,
  fetchPropertyExpenses,
  savePropertyExpense,
} from "@/lib/property-finance-queries";
import { createCsv, downloadCsv } from "@/lib/csv";
import { downloadFile, EXPENSE_RECEIPTS } from "@/lib/storage";

export const Route = createFileRoute("/_authenticated/finances")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { property?: string | undefined; from?: string | undefined; to?: string | undefined } => ({
    ...(typeof search["property"] === "string" ? { property: search["property"] } : {}),
    ...(typeof search["from"] === "string" ? { from: search["from"] } : {}),
    ...(typeof search["to"] === "string" ? { to: search["to"] } : {}),
  }),
  head: () => ({ meta: [{ title: "Расходы и прибыль — SmartRent" }] }),
  component: FinancesPage,
});
const selectClass =
  "flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm";
// Preserve user text without turning it into spreadsheet formulas in an exported file.
const csvText = (text: string) => (/^[\s]*[=+@-]/.test(text) ? `'${text}` : text);
function FinancesPage() {
  const { user, role } = useAuth();
  const search = Route.useSearch(),
    navigate = Route.useNavigate();
  const qc = useQueryClient();
  const sources = useQuery({
    queryKey: ["property-finances", user?.id],
    queryFn: fetchFinanceSources,
    enabled: Boolean(user),
    refetchInterval: 30_000,
  });
  const data = useQuery({
    queryKey: ["property-expenses", user?.id],
    queryFn: fetchPropertyExpenses,
    enabled: Boolean(user),
    refetchInterval: 30_000,
  });
  const from = search.from ?? localDateKey().slice(0, 7),
    to = search.to ?? from;
  const validRange = financeMonths(from, to).length > 0;
  const properties = sources.data?.properties ?? [];
  const missingProperty = Boolean(
    search.property && !properties.some((p) => p.id === search.property),
  );
  const report = sources.data
    ? buildPropertyFinances({
        ...sources.data,
        expenses: data.data?.expenses ?? [],
        from,
        to,
        ...(search.property ? { propertyId: search.property } : {}),
      })
    : null;
  const actualComplete = Boolean(report?.actualComplete && data.data?.available);
  const [editor, setEditor] = useState<{
    initial: PropertyExpense | null;
    markPaid: boolean;
  } | null>(null);
  const [cancel, setCancel] = useState<PropertyExpense | null>(null);
  const [category, setCategory] = useState("all"),
    [status, setStatus] = useState("all");
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["property-expenses"] });
    void qc.invalidateQueries({ queryKey: ["property-finances"] });
  };
  const cancellation = useMutation({
    mutationFn: async () => {
      if (!cancel) return;
      await savePropertyExpense(
        cancel.property_id,
        { ...cancel, status: "cancelled", paid_date: null, paid_amount: null, receipt_file: null },
        cancel,
        "Плановый расход отменён",
      );
    },
    onSuccess: () => {
      toast.success("Расход отменён");
      setCancel(null);
      refresh();
    },
    onError: (e: Error) => {
      toast.error(e.message);
      refresh();
    },
  });
  const propertyName = (id: string) => properties.find((p) => p.id === id)?.name ?? "Объект";
  const inRange = (date: string | null) =>
    Boolean(date && date.slice(0, 7) >= from && date.slice(0, 7) <= to);
  const visible = (data.data?.expenses ?? [])
    .filter(
      (e) =>
        (!search.property || e.property_id === search.property) &&
        (inRange(e.planned_date) || inRange(e.paid_date)) &&
        (category === "all" || e.category === category) &&
        (status === "all" || e.status === status),
    )
    .sort(
      (a, b) =>
        (b.paid_date ?? b.planned_date).localeCompare(a.paid_date ?? a.planned_date) ||
        b.id.localeCompare(a.id),
    );
  const loading = sources.isPending || data.isPending,
    failed = sources.isError || data.isError;
  const ready = !loading && !failed && data.data?.available && validRange && !missingProperty;
  const fact = (value: number) => (actualComplete ? financeMoney(value) : "—");
  const exportSummary = () => {
    if (!report) return;
    downloadCsv(
      `property-finances-${from}-${to}.csv`,
      createCsv(
        [
          "Объект",
          "С месяца",
          "По месяц",
          "План аренды",
          "Получено аренды",
          "План расходов",
          "Оплачено расходов",
          "Плановый результат",
          "Фактический результат",
          "Полнота факта",
        ],
        report.properties.map((p) => [
          csvText(p.name),
          from,
          to,
          p.plannedIncome,
          actualComplete ? p.income : null,
          p.plannedExpenses,
          p.expenses,
          p.plannedResult,
          actualComplete ? p.result : null,
          actualComplete ? "Полный по внесённым данным" : "Не подтверждён",
        ]),
      ),
    );
  };
  const exportExpenses = () =>
    downloadCsv(
      `expenses-${from}-${to}.csv`,
      createCsv(
        [
          "Объект",
          "Расход",
          "Категория",
          "Состояние",
          "Плановая дата",
          "Плановая сумма",
          "Дата оплаты",
          "Оплачено",
          "Примечание",
        ],
        visible.map((e) => [
          csvText(propertyName(e.property_id)),
          csvText(e.title),
          expenseCategories[e.category],
          expenseStatusLabels[e.status],
          e.planned_date,
          e.planned_amount,
          e.paid_date,
          e.paid_amount,
          csvText(e.note),
        ]),
      ),
    );
  return (
    <>
      <PageHeader
        title="Расходы и прибыль"
        description="Арендные поступления, расходы и результат по каждому объекту"
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={refresh}
              disabled={sources.isFetching || data.isFetching}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Обновить
            </Button>
            <Button
              disabled={!ready || properties.length === 0}
              onClick={() => setEditor({ initial: null, markPaid: false })}
            >
              <Plus className="mr-2 h-4 w-4" />
              Добавить расход
            </Button>
          </div>
        }
      />
      <Card className="mb-5">
        <CardContent className="grid gap-4 p-5 sm:grid-cols-3">
          <div className="min-w-0 space-y-2">
            <Label htmlFor="finance-property">Объект отчёта</Label>
            <select
              id="finance-property"
              className={selectClass}
              value={search.property ?? ""}
              onChange={(e) =>
                void navigate({ search: { ...search, property: e.target.value || undefined } })
              }
            >
              <option value="">Все объекты</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0 space-y-2">
            <Label htmlFor="finance-from">С месяца</Label>
            <Input
              id="finance-from"
              type="month"
              min="2000-01"
              max="2100-12"
              value={from}
              onChange={(e) => void navigate({ search: { ...search, from: e.target.value, to } })}
            />
          </div>
          <div className="min-w-0 space-y-2">
            <Label htmlFor="finance-to">По месяц включительно</Label>
            <Input
              id="finance-to"
              type="month"
              min="2000-01"
              max="2100-12"
              value={to}
              onChange={(e) => void navigate({ search: { ...search, from, to: e.target.value } })}
            />
          </div>
        </CardContent>
      </Card>
      {!validRange && (
        <p role="alert" className="mb-5 text-sm text-destructive">
          Выберите период от 1 до 24 месяцев; начало должно быть не позже окончания.
        </p>
      )}
      {loading && <p className="text-sm text-muted-foreground">Загружаем расходы и поступления…</p>}
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          Не удалось загрузить финансовые данные. Нажмите «Обновить».
        </p>
      )}
      {!loading && !failed && !data.data?.available && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Учёт расходов пока недоступен. Попробуйте открыть раздел позже.
          </CardContent>
        </Card>
      )}
      {!loading && !failed && missingProperty && (
        <p role="alert" className="text-sm text-destructive">
          Этот объект недоступен. Выберите объект из списка.
        </p>
      )}
      {ready && report && (
        <div className="space-y-5">
          {role === "admin" && (
            <p className="text-sm text-muted-foreground">
              Администратор видит все доступные объекты. Выберите объект, чтобы посмотреть его
              расходы и результат.
            </p>
          )}
          {report.issues.length > 0 && (
            <div role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm">
              {report.issues.map((issue) => (
                <p key={issue}>{issue}</p>
              ))}
              <p className="mt-2">
                Фактические доход и результат скрыты до проверки данных. Расходы и план доступны.
              </p>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Получено аренды", fact(report.totals.income), "По датам поступлений"],
              [
                "Оплачено расходов",
                financeMoney(report.totals.expenses),
                "По датам фактической оплаты",
              ],
              [
                "Фактический результат",
                fact(report.totals.result),
                "Полученная аренда минус расходы",
              ],
              [
                "Плановый результат",
                financeMoney(report.totals.plannedResult),
                "Начисленная аренда минус план расходов",
              ],
            ].map(([title, value, description]) => (
              <Card key={title}>
                <CardContent className="space-y-2 p-5">
                  <p className="text-sm text-muted-foreground">{title}</p>
                  <p
                    className="break-words text-xl font-semibold tabular-nums"
                    data-testid={title === "Фактический результат" ? "finance-result" : undefined}
                  >
                    {value}
                  </p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Результат учитывает только внесённые арендные платежи и расходы. Депозиты, удержания и
            коммунальные возмещения не включены. План аренды взят из сформированных начислений с
            учётом корректировок; это не прогноз полной загрузки. Даты поступлений соответствуют
            датам журнала платежей. Неучтённые расходы в расчёт не попадут.
          </p>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-lg">Сравнение объектов · план и факт</CardTitle>
              <Button
                variant="outline"
                size="sm"
                disabled={properties.length === 0}
                onClick={exportSummary}
              >
                <Download className="mr-2 h-4 w-4" />
                Экспорт отчёта
              </Button>
            </CardHeader>
            <CardContent>
              {properties.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Добавьте первый объект, чтобы вести расходы.{" "}
                  <Link to="/properties" className="text-primary underline">
                    Открыть объекты
                  </Link>
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        {[
                          "Объект",
                          "Аренда: план",
                          "Аренда: факт",
                          "Расходы: план",
                          "Расходы: факт",
                          "Результат: план",
                          "Результат: факт",
                        ].map((h) => (
                          <th key={h} className="whitespace-nowrap p-3 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.properties.map((p) => (
                        <tr key={p.id} className="border-b last:border-0">
                          <td className="min-w-40 p-3">
                            <Link
                              to="/properties/$propertyId"
                              params={{ propertyId: p.id }}
                              className="font-medium text-primary underline"
                            >
                              {p.name}
                            </Link>
                          </td>
                          {[
                            financeMoney(p.plannedIncome),
                            fact(p.income),
                            financeMoney(p.plannedExpenses),
                            financeMoney(p.expenses),
                            financeMoney(p.plannedResult),
                            fact(p.result),
                          ].map((value, i) => (
                            <td key={i} className="whitespace-nowrap p-3 tabular-nums">
                              {value}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
          {report.months.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Результат по месяцам</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer
                  data-testid="finance-chart"
                  className="h-[280px] w-full aspect-auto"
                  config={{
                    plannedResult: { label: "План", color: "var(--chart-1)" },
                    result: { label: "Факт", color: "var(--chart-2)" },
                  }}
                >
                  <BarChart accessibilityLayer data={report.months}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="name" tickLine={false} />
                    <YAxis
                      width={60}
                      tickFormatter={(value) =>
                        new Intl.NumberFormat("ru-RU", { notation: "compact" }).format(
                          Number(value),
                        )
                      }
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value, name) => (
                            <span>
                              {name === "result" ? "Факт" : "План"}: {financeMoney(Number(value))}
                            </span>
                          )}
                        />
                      }
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar
                      dataKey="plannedResult"
                      fill="var(--color-plannedResult)"
                      radius={3}
                      isAnimationActive={false}
                    />
                    {actualComplete && (
                      <Bar
                        dataKey="result"
                        fill="var(--color-result)"
                        radius={3}
                        isAnimationActive={false}
                      />
                    )}
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-lg">Журнал расходов</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={visible.length === 0}
                  onClick={exportExpenses}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Экспорт расходов
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="expense-filter-category">Категория расходов</Label>
                  <select
                    id="expense-filter-category"
                    className={selectClass}
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="all">Все категории</option>
                    {Object.entries(expenseCategories).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="expense-filter-status">Состояние расходов</Label>
                  <select
                    id="expense-filter-status"
                    className={selectClass}
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="all">Все состояния</option>
                    {Object.entries(expenseStatusLabels).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Фильтры категории и состояния применяются к журналу и его экспорту. Итоги выше
                относятся ко всем расходам выбранных объектов и периода. В журнале видны записи с
                плановой датой или датой оплаты в периоде.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {visible.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Расходов по выбранным фильтрам пока нет.
                </p>
              )}
              {visible.map((expense) => (
                <article
                  key={expense.id}
                  className="space-y-3 rounded-xl border p-4"
                  data-testid="expense-record"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="break-words font-medium">{expense.title}</h3>
                      <p className="break-words text-xs text-muted-foreground">
                        {propertyName(expense.property_id)} · {expenseCategories[expense.category]}
                      </p>
                    </div>
                    <span className="rounded-full bg-accent px-3 py-1 text-xs">
                      {expenseStatusLabels[expense.status]}
                    </span>
                  </div>
                  <div className="grid gap-3 text-sm sm:grid-cols-2">
                    <p>
                      План: <strong>{financeMoney(expense.planned_amount)}</strong> ·{" "}
                      {formatDate(expense.planned_date)}
                    </p>
                    <p>
                      Оплачено:{" "}
                      <strong>
                        {expense.paid_amount === null ? "—" : financeMoney(expense.paid_amount)}
                      </strong>
                      {expense.paid_date && ` · ${formatDate(expense.paid_date)}`}
                    </p>
                  </div>
                  {expense.note && (
                    <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                      {expense.note}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {expense.status !== "cancelled" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditor({ initial: expense, markPaid: false })}
                      >
                        {expense.status === "paid" ? "Исправить расход" : "Изменить расход"}
                      </Button>
                    )}
                    {expense.status === "planned" && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => setEditor({ initial: expense, markPaid: true })}
                        >
                          Отметить оплату
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setCancel(expense)}>
                          Отменить расход
                        </Button>
                      </>
                    )}
                    {expense.receipt_file && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void downloadFile(
                            EXPENSE_RECEIPTS,
                            expense.receipt_file!,
                            "expense-receipt",
                          ).catch((e: Error) => toast.error(e.message))
                        }
                      >
                        Открыть чек
                      </Button>
                    )}
                  </div>
                  <details className="rounded-lg border p-3 text-sm">
                    <summary className="cursor-pointer font-medium">История расхода</summary>
                    <div className="mt-3 space-y-3">
                      {(data.data?.events ?? [])
                        .filter((e) => e.expense_id === expense.id)
                        .sort(
                          (a, b) =>
                            Number((b.snapshot as unknown as PropertyExpense).revision) -
                            Number((a.snapshot as unknown as PropertyExpense).revision),
                        )
                        .map((event) => {
                          const snapshot = event.snapshot as unknown as PropertyExpense;
                          return (
                            <div key={event.id} className="space-y-1 border-t pt-2">
                              <p className="text-xs text-muted-foreground">
                                {formatDateTime(event.created_at)} · версия {snapshot.revision} ·{" "}
                                {expenseStatusLabels[snapshot.status]}
                              </p>
                              <p className="break-words">
                                {snapshot.title} · {expenseCategories[snapshot.category]}
                              </p>
                              <p>
                                План {financeMoney(snapshot.planned_amount)} ·{" "}
                                {formatDate(snapshot.planned_date)}
                              </p>
                              {snapshot.paid_amount !== null && (
                                <p>
                                  Оплачено {financeMoney(snapshot.paid_amount)} ·{" "}
                                  {formatDate(snapshot.paid_date)}
                                </p>
                              )}
                              {event.reason && (
                                <p className="whitespace-pre-wrap break-words">
                                  Причина: {event.reason}
                                </p>
                              )}
                              {snapshot.note && (
                                <p className="whitespace-pre-wrap break-words text-muted-foreground">
                                  {snapshot.note}
                                </p>
                              )}
                              {snapshot.receipt_file && (
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="h-auto p-0"
                                  onClick={() =>
                                    void downloadFile(
                                      EXPENSE_RECEIPTS,
                                      snapshot.receipt_file!,
                                      "expense-receipt",
                                    ).catch((e: Error) => toast.error(e.message))
                                  }
                                >
                                  Чек этой версии
                                </Button>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  </details>
                </article>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
      {editor && (
        <PropertyExpenseEditor
          initial={editor.initial}
          properties={properties}
          propertyId={search.property ?? properties[0]?.id ?? ""}
          markPaid={editor.markPaid}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            refresh();
          }}
        />
      )}
      <Dialog
        open={Boolean(cancel)}
        onOpenChange={(open) => {
          if (!open && !cancellation.isPending) setCancel(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отменить плановый расход?</DialogTitle>
            <DialogDescription>
              «{cancel?.title}» перестанет учитываться в плане. Запись и её история сохранятся.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={cancellation.isPending}
              onClick={() => setCancel(null)}
            >
              Назад
            </Button>
            <Button disabled={cancellation.isPending} onClick={() => cancellation.mutate()}>
              Подтвердить отмену
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
