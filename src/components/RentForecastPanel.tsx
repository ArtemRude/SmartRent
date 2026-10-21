import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, formatMoney } from "@/lib/domain";
import type { ForecastAgreement, ForecastMonth } from "@/lib/rent-forecast";
import { rentAt } from "@/lib/lease-changes";

const chartConfig = {
  expected: { label: "Плановый доход", color: "var(--chart-1)" },
} satisfies ChartConfig;

const compactMoney = (value: number) =>
  `${new Intl.NumberFormat("ru-RU", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)} ₽`;

const shortMonth = (period: string) =>
  new Intl.DateTimeFormat("ru-RU", { month: "short", year: "2-digit" }).format(
    new Date(`${period}-01T12:00:00`),
  );

export function RentForecastPanel({
  months,
  contracts,
  totalExpected,
  expiringContracts,
  horizonMonths,
  onHorizonChange,
}: {
  months: ForecastMonth[];
  contracts: ForecastAgreement[];
  totalExpected: number;
  expiringContracts: number;
  horizonMonths: number;
  onHorizonChange: (months: number) => void;
}) {
  const chartData = months.map((month) => ({ ...month, label: shortMonth(month.period) }));

  return (
    <Card className="mt-4">
      <CardContent className="p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Прогноз по договорам</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Плановый доход рассчитан по ставкам и срокам активных договоров
            </p>
          </div>
          <div className="flex rounded-lg bg-muted p-1" aria-label="Горизонт прогноза">
            {[3, 6, 12].map((monthsCount) => (
              <Button
                key={monthsCount}
                type="button"
                size="sm"
                variant={horizonMonths === monthsCount ? "secondary" : "ghost"}
                className="h-7 px-3"
                onClick={() => onHorizonChange(monthsCount)}
              >
                {monthsCount} мес.
              </Button>
            ))}
          </div>
        </div>

        {contracts.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed px-4 py-8 text-center">
            <p className="font-medium">Нет активных договоров для прогноза</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Измените фильтр объектов или добавьте действующий договор.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-sm text-muted-foreground">План в текущем месяце</p>
                <p className="mt-1 text-xl font-semibold">
                  {formatMoney(months[0]?.expected ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">За {horizonMonths} месяцев</p>
                <p className="mt-1 text-xl font-semibold">{formatMoney(totalExpected)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Завершатся в этом периоде</p>
                <p className="mt-1 text-xl font-semibold">{expiringContracts}</p>
              </div>
            </div>

            <div className="mt-6 border-t pt-5">
              <h3 className="text-sm font-medium">Плановая динамика</h3>
              <ChartContainer config={chartConfig} className="mt-4 h-[280px] w-full aspect-auto">
                <BarChart
                  accessibilityLayer
                  data={chartData}
                  margin={{ left: 4, right: 4, top: 8 }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={10}
                    minTickGap={24}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={70}
                    tickFormatter={(value) => compactMoney(Number(value))}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        formatter={(value, _name, item) => (
                          <div className="grid min-w-44 gap-1">
                            <div className="flex justify-between gap-4">
                              <span className="text-muted-foreground">Плановый доход</span>
                              <span className="font-mono font-medium tabular-nums">
                                {formatMoney(Number(value))}
                              </span>
                            </div>
                            <p className="text-muted-foreground">
                              Договоров: {Number(item.payload.activeContracts)}
                            </p>
                          </div>
                        )}
                      />
                    }
                  />
                  <Bar dataKey="expected" fill="var(--color-expected)" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </div>

            <div className="mt-6 border-t pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Договоры в прогнозе</h3>
                <span className="text-xs text-muted-foreground">{contracts.length} договоров</span>
              </div>
              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                {contracts.map((contract) => (
                  <div
                    key={contract.id}
                    className="flex items-start justify-between gap-4 rounded-xl border px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{contract.propertyName}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {contract.tenantName} · до {formatDate(contract.endDate)}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-medium">
                      {formatMoney(
                        rentAt(
                          {
                            monthly_payment: contract.monthlyPayment,
                            ...(contract.rentSchedule
                              ? { rent_schedule: contract.rentSchedule }
                              : {}),
                          },
                          months[0]?.period ?? contract.startDate,
                        ),
                      )}
                      /мес.
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Неполный месяц учитывается по полной месячной ставке договора. Ставка в списке
                указана на начало прогноза; график учитывает согласованные изменения по месяцам.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
