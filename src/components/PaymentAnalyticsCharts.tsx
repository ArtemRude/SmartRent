import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMoney } from "@/lib/domain";
import type { PaymentAnalyticsGroup } from "@/lib/payment-analytics";

type MonthlyPoint = PaymentAnalyticsGroup & { period: string };
type PropertyPoint = PaymentAnalyticsGroup & { propertyId: string; propertyName: string };

const chartConfig = {
  accrued: { label: "Начислено", color: "var(--chart-1)" },
  paid: { label: "Оплачено", color: "var(--chart-2)" },
} satisfies ChartConfig;

const compactMoney = (value: number) =>
  `${new Intl.NumberFormat("ru-RU", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)} ₽`;

const shortPropertyName = (name: string) => (name.length > 19 ? `${name.slice(0, 18)}…` : name);

const shortMonth = (period: string) =>
  new Intl.DateTimeFormat("ru-RU", { month: "short", year: "2-digit" }).format(
    new Date(`${period}-01T12:00:00`),
  );

function MoneyTooltip() {
  return (
    <ChartTooltipContent
      formatter={(value, name) => (
        <div className="flex min-w-40 items-center justify-between gap-4">
          <span className="text-muted-foreground">
            {name === "paid" ? "Оплачено" : "Начислено"}
          </span>
          <span className="font-mono font-medium tabular-nums text-foreground">
            {formatMoney(Number(value))}
          </span>
        </div>
      )}
    />
  );
}

export function PaymentAnalyticsCharts({
  months,
  properties,
}: {
  months: MonthlyPoint[];
  properties: PropertyPoint[];
}) {
  const monthlyData = months.map((month) => ({
    ...month,
    label: shortMonth(month.period),
  }));
  const propertyChartHeight = Math.max(260, properties.length * 54);

  return (
    <Tabs defaultValue="months" className="mt-6 border-t pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Графики по выбранным начислениям</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Наведите на столбец, чтобы увидеть точную сумму
          </p>
        </div>
        <TabsList className="grid w-full grid-cols-2 sm:w-auto">
          <TabsTrigger value="months">По месяцам</TabsTrigger>
          <TabsTrigger value="properties">По объектам</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="months" className="mt-5">
        <ChartContainer config={chartConfig} className="h-[300px] w-full aspect-auto">
          <BarChart accessibilityLayer data={monthlyData} margin={{ left: 4, right: 4, top: 8 }}>
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
            <ChartTooltip cursor={false} content={<MoneyTooltip />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="accrued" fill="var(--color-accrued)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="paid" fill="var(--color-paid)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </TabsContent>

      <TabsContent value="properties" className="mt-5">
        <ChartContainer
          config={chartConfig}
          className="w-full aspect-auto"
          style={{ height: propertyChartHeight }}
        >
          <BarChart
            accessibilityLayer
            data={properties}
            layout="vertical"
            margin={{ left: 8, right: 12, top: 8 }}
          >
            <CartesianGrid horizontal={false} />
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => compactMoney(Number(value))}
            />
            <YAxis
              dataKey="propertyName"
              type="category"
              tickLine={false}
              axisLine={false}
              width={140}
              tickFormatter={shortPropertyName}
            />
            <ChartTooltip cursor={false} content={<MoneyTooltip />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="accrued" fill="var(--color-accrued)" radius={[0, 4, 4, 0]} />
            <Bar dataKey="paid" fill="var(--color-paid)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ChartContainer>
      </TabsContent>
    </Tabs>
  );
}
