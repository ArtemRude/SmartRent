import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  Droplets,
  Download,
  Gauge,
  History,
  Plus,
  Send,
  Settings2,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { UtilityBillCard } from "@/components/UtilityBillCard";
import { UtilityServiceDialog } from "@/components/UtilityServiceDialog";
import { UtilityMonthlySummary } from "@/components/UtilityMonthlySummary";
import { FileUploadField } from "@/components/FileUploadField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/auth-context";
import { agreementStatusLabels, formatMonth, localDateKey } from "@/lib/domain";
import {
  fetchAgreements,
  fetchProperties,
  fetchRentCharges,
  fetchTenants,
  fetchUnits,
} from "@/lib/queries";
import { fetchUtilityData, submitUtilityReadings } from "@/lib/utility-queries";
import {
  formatUtilityMoney,
  formatUtilityValue,
  parseUtilityNumber,
  previousUtilityReading,
  utilityLineAmount,
  type UtilityService,
} from "@/lib/utilities";
import { removeFile, uploadFile, UTILITY_READING_PHOTOS } from "@/lib/storage";
import { buildUtilityMonthlySummary } from "@/lib/utility-summary";
import { buildUtilityHistoryCsv } from "@/lib/utility-report";
import { downloadCsv } from "@/lib/csv";

export const Route = createFileRoute("/_authenticated/utilities")({
  validateSearch: (search: Record<string, unknown>) => ({
    agreement: typeof search["agreement"] === "string" ? search["agreement"] : "",
  }),
  head: () => ({
    meta: [
      { title: "Коммунальные услуги — SmartRent" },
      {
        name: "description",
        content: "Счётчики, показания и коммунальные начисления по вашей аренде.",
      },
    ],
  }),
  component: Utilities,
});

function Utilities() {
  const { user, role } = useAuth();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const canManage = role === "owner" || role === "admin";
  const agreements = useQuery({ queryKey: ["agreements"], queryFn: fetchAgreements });
  const properties = useQuery({ queryKey: ["properties"], queryFn: fetchProperties });
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: fetchTenants });
  const units = useQuery({ queryKey: ["units"], queryFn: fetchUnits });
  const charges = useQuery({ queryKey: ["rent-charges"], queryFn: fetchRentCharges });
  const utilities = useQuery({
    queryKey: ["utilities", user?.id],
    queryFn: fetchUtilityData,
    enabled: Boolean(user),
    refetchInterval: 30_000,
  });
  const [period, setPeriod] = useState(localDateKey().slice(0, 7));
  const [readings, setReadings] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Record<string, File | null>>({});
  const [serviceDialog, setServiceDialog] = useState<{ service: UtilityService | null } | null>(
    null,
  );
  const [formError, setFormError] = useState("");
  const [historyPeriod, setHistoryPeriod] = useState("all");
  const [historyStatus, setHistoryStatus] = useState("all");
  const allAgreements = (agreements.data ?? []).filter(
    (agreement) => canManage || ["active", "completed"].includes(agreement.status),
  );
  const agreement =
    allAgreements.find((item) => item.id === search.agreement) ??
    allAgreements.find((item) => item.status === "active") ??
    allAgreements[0];
  const agreementServices = (utilities.data?.services ?? []).filter(
    (service) => service.agreement_id === agreement?.id,
  );
  const bills = (utilities.data?.bills ?? []).filter((bill) => bill.agreement_id === agreement?.id);
  const items = utilities.data?.items ?? [];
  const activeServices = agreementServices.filter(
    (service) => service.active && service.start_period.slice(0, 7) <= period,
  );
  const pendingBill = bills.find((bill) => bill.status === "pending");
  const latestApproved = bills.find((bill) => bill.status === "approved");
  const queries = [agreements, properties, tenants, units, charges, utilities];
  const loading = queries.some((query) => query.isPending);
  const failed = queries.some((query) => query.isError);
  const canSubmit =
    agreement?.status === "active" &&
    agreement.start_date <= localDateKey() &&
    agreement.end_date >= localDateKey();
  const periodValid = Boolean(
    agreement &&
    /^\d{4}-\d{2}$/.test(period) &&
    period >= agreement.start_date.slice(0, 7) &&
    period <= agreement.end_date.slice(0, 7) &&
    period <= localDateKey().slice(0, 7),
  );
  const periodAlreadyBilled = Boolean(
    latestApproved && latestApproved.period_start.slice(0, 7) >= period,
  );
  const preview = activeServices.map((service) => {
    const previous = previousUtilityReading(service, bills, items);
    const reading = parseUtilityNumber(readings[service.id] ?? "");
    let invalid =
      service.kind === "meter" &&
      (reading === null || reading < previous || reading !== Math.round(reading * 1000) / 1000);
    let error = "Показания не должны уменьшаться. Допускается до 3 знаков после запятой.";
    let amount = service.kind === "fixed" ? Math.round(Number(service.rate) * 100) / 100 : 0;
    if (service.kind === "meter" && !invalid && reading !== null) {
      try {
        amount = utilityLineAmount(previous, reading, Number(service.rate));
      } catch (cause) {
        invalid = true;
        error = cause instanceof Error ? cause.message : "Проверьте показания и тариф";
      }
    }
    return { service, previous, reading, invalid, amount, error };
  });
  const previewTotal = preview.reduce((sum, line) => sum + Math.round(line.amount * 100), 0) / 100;
  const previewComplete =
    preview.length > 0 &&
    previewTotal < 1_000_000_000_000 &&
    preview.every((line) => !line.invalid);
  const summaryPeriod =
    pendingBill?.period_start.slice(0, 7) ??
    (/^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : localDateKey().slice(0, 7));
  const summary = buildUtilityMonthlySummary({
    agreementId: agreement?.id ?? "",
    period: summaryPeriod,
    charges: charges.data ?? [],
    bills,
    previewAmount:
      canSubmit && periodValid && !periodAlreadyBilled && previewComplete ? previewTotal : null,
  });
  const historyBills = bills.filter(
    (bill) =>
      bill.status !== "pending" &&
      (historyPeriod === "all" || bill.period_start.slice(0, 7) === historyPeriod) &&
      (historyStatus === "all" || bill.status === historyStatus),
  );
  const historyPeriods = Array.from(
    new Set(
      bills
        .filter((bill) => bill.status !== "pending")
        .map((bill) => bill.period_start.slice(0, 7)),
    ),
  )
    .sort()
    .reverse();
  const reportContext = {
    propertyName:
      properties.data?.find((property) => property.id === agreement?.property_id)?.name ?? "Объект",
    propertyAddress:
      properties.data?.find((property) => property.id === agreement?.property_id)?.address ?? "",
    tenantName:
      tenants.data?.find((tenant) => tenant.id === agreement?.tenant_id)?.name ?? "Арендатор",
    unitName: units.data?.find((unit) => unit.id === agreement?.unit_id)?.name ?? null,
  };
  const allPendingBills = (utilities.data?.bills ?? []).filter((bill) => bill.status === "pending");
  const submit = useMutation({
    mutationFn: async () => {
      if (
        !user ||
        !agreement ||
        !canSubmit ||
        !periodValid ||
        periodAlreadyBilled ||
        !previewComplete
      )
        throw new Error("Проверьте месяц и заполните показания всех счётчиков");
      const uploaded: string[] = [];
      try {
        const input = [];
        for (const line of preview) {
          if (line.service.kind !== "meter") continue;
          const photo = photos[line.service.id];
          const path = photo
            ? await uploadFile(UTILITY_READING_PHOTOS, `${user.id}/${agreement.id}`, photo)
            : null;
          if (path) uploaded.push(path);
          input.push({ service_id: line.service.id, reading: line.reading, photo_path: path });
        }
        return await submitUtilityReadings(agreement.id, period, input);
      } catch (error) {
        await Promise.allSettled(uploaded.map((path) => removeFile(UTILITY_READING_PHOTOS, path)));
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Расчёт отправлен на проверку");
      setReadings({});
      setPhotos({});
      setFormError("");
      void qc.invalidateQueries({ queryKey: ["utilities"] });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (error: Error) => {
      setFormError(error.message);
      toast.error(error.message);
    },
  });
  const agreementLabel = (item: NonNullable<typeof agreement>) => {
    const property = properties.data?.find((property) => property.id === item.property_id);
    const tenant = tenants.data?.find((tenant) => tenant.id === item.tenant_id);
    const unit = units.data?.find((unit) => unit.id === item.unit_id);
    return `${property?.name ?? "Объект"}${unit ? ` · ${unit.name}` : ""}${canManage ? ` · ${tenant?.name ?? "Арендатор"}` : ""}`;
  };

  const selectAgreement = (value: string) => {
    setReadings({});
    setPhotos({});
    setFormError("");
    setServiceDialog(null);
    setHistoryPeriod("all");
    setHistoryStatus("all");
    void navigate({ search: { agreement: value } });
  };

  return (
    <div>
      <PageHeader
        title="Коммунальные услуги"
        description={
          canManage
            ? "Настройте услуги, проверьте показания и утвердите начисления"
            : "Передавайте показания и проверяйте расчёт коммунальных платежей"
        }
      />
      {loading && (
        <p className="mt-6 text-sm text-muted-foreground">Загружаем счётчики и расчёты…</p>
      )}
      {failed && (
        <Card className="mt-6">
          <CardContent className="space-y-3 p-5">
            <p role="alert" className="text-sm text-destructive">
              Не удалось загрузить коммунальные услуги.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                for (const query of queries) void query.refetch();
              }}
            >
              Попробовать снова
            </Button>
          </CardContent>
        </Card>
      )}
      {!loading && !failed && !utilities.data?.available && (
        <Card className="mt-6">
          <CardContent className="p-5 text-sm text-muted-foreground">
            Коммунальные услуги пока недоступны. Попробуйте открыть раздел позже.
          </CardContent>
        </Card>
      )}
      {!loading && !failed && utilities.data?.available && !agreement && (
        <Card className="mt-6">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Gauge className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">Сначала подключите договор аренды</p>
            <p className="max-w-md text-sm text-muted-foreground">
              {canManage
                ? "Счётчики и коммунальные услуги настраиваются отдельно для каждого договора."
                : "Здесь появятся счётчики и расчёты, когда собственник активирует ваш договор."}
            </p>
            {canManage && (
              <Button asChild>
                <Link to="/agreements">Перейти к договорам</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}
      {!loading && !failed && utilities.data?.available && agreement && (
        <>
          {canManage && allPendingBills.some((bill) => bill.agreement_id !== agreement.id) && (
            <Card className="mt-6 border-amber-200 bg-amber-50/40">
              <CardContent className="space-y-3 p-5">
                <h2 className="font-semibold">Ожидают проверки: {allPendingBills.length}</h2>
                {allPendingBills.map((bill) => {
                  const related = allAgreements.find((item) => item.id === bill.agreement_id);
                  return (
                    <div
                      key={bill.id}
                      className="flex flex-wrap items-center justify-between gap-3"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {related ? agreementLabel(related) : "Договор аренды"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatMonth(bill.period_start)} ·{" "}
                          {formatUtilityMoney(Number(bill.amount))}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={submit.isPending}
                        onClick={() => selectAgreement(bill.agreement_id)}
                      >
                        Проверить расчёт
                      </Button>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="space-y-2">
              <Label>Договор и объект</Label>
              <Select
                value={agreement.id}
                disabled={submit.isPending}
                onValueChange={selectAgreement}
              >
                <SelectTrigger
                  aria-label="Договор и объект"
                  className="h-auto min-h-10 [&>span]:whitespace-normal [&>span]:text-left"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allAgreements.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {agreementLabel(item)} · {agreementStatusLabels[item.status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Badge variant="secondary" className="mb-2">
                {agreementStatusLabels[agreement.status]}
              </Badge>
              <Button variant="outline" asChild>
                <Link to="/payments">
                  <WalletCards className="mr-2 h-4 w-4" />
                  Все платежи
                </Link>
              </Button>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Активные счётчики</p>
                <p className="mt-1 text-2xl font-semibold">
                  {
                    agreementServices.filter(
                      (service) => service.active && service.kind === "meter",
                    ).length
                  }
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Фиксированные платежи в месяц</p>
                <p className="mt-1 text-xl font-semibold">
                  {formatUtilityMoney(
                    agreementServices
                      .filter(
                        (service) =>
                          service.active &&
                          service.kind === "fixed" &&
                          service.start_period.slice(0, 7) <= localDateKey().slice(0, 7),
                      )
                      .reduce((sum, service) => sum + Math.round(Number(service.rate) * 100), 0) /
                      100,
                  )}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Последний утверждённый расчёт</p>
                <p className="mt-1 text-xl font-semibold">
                  {latestApproved ? formatUtilityMoney(Number(latestApproved.amount)) : "Пока нет"}
                </p>
                {latestApproved && (
                  <p className="mt-1 text-xs capitalize text-muted-foreground">
                    {formatMonth(latestApproved.period_start)}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
          <Tabs defaultValue="readings" className="mt-6">
            <TabsList className="grid w-full grid-cols-2 sm:w-auto">
              <TabsTrigger value="readings" aria-label="Показания и расчёты">
                <Droplets className="mr-2 h-4 w-4 shrink-0" />
                <span className="sm:hidden">Показания</span>
                <span className="hidden sm:inline">Показания и расчёты</span>
              </TabsTrigger>
              <TabsTrigger value="services" aria-label="Счётчики и услуги">
                <Settings2 className="mr-2 h-4 w-4 shrink-0" />
                <span className="sm:hidden">Услуги</span>
                <span className="hidden sm:inline">Счётчики и услуги</span>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="readings" className="mt-5 space-y-6">
              <UtilityMonthlySummary period={summaryPeriod} summary={summary} />
              {pendingBill ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {canManage
                      ? "Проверьте показания и фотографии перед утверждением."
                      : "Расчёт отправлен собственнику. После проверки здесь появится результат."}
                  </p>
                  <UtilityBillCard
                    key={pendingBill.id}
                    bill={pendingBill}
                    items={items.filter((item) => item.bill_id === pendingBill.id)}
                    canReview={canManage}
                    reportContext={reportContext}
                  />
                </div>
              ) : canSubmit && agreementServices.some((service) => service.active) ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {canManage ? "Внести показания и подготовить расчёт" : "Передать показания"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="space-y-5"
                      onSubmit={(event) => {
                        event.preventDefault();
                        setFormError("");
                        submit.mutate();
                      }}
                    >
                      <div className="max-w-xs space-y-2">
                        <Label htmlFor="utility-reading-period">Расчётный месяц</Label>
                        <Input
                          id="utility-reading-period"
                          type="month"
                          value={period}
                          min={agreement.start_date.slice(0, 7)}
                          max={
                            [agreement.end_date.slice(0, 7), localDateKey().slice(0, 7)].sort()[0]
                          }
                          disabled={submit.isPending}
                          onChange={(event) => {
                            setPeriod(event.target.value);
                            setReadings({});
                            setPhotos({});
                            setFormError("");
                          }}
                          required
                        />
                      </div>
                      {periodAlreadyBilled ? (
                        <p className="rounded-lg bg-accent p-3 text-sm">
                          {latestApproved?.period_start.slice(0, 7) === localDateKey().slice(0, 7)
                            ? "Расчёт за текущий месяц уже утверждён. Новые показания можно будет передать в следующем месяце."
                            : "Этот или более поздний месяц уже утверждён. Выберите следующий расчётный месяц."}
                        </p>
                      ) : !periodValid ? (
                        <p role="alert" className="text-sm text-destructive">
                          Выберите прошедший или текущий месяц в пределах договора.
                        </p>
                      ) : activeServices.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          На выбранный месяц услуги ещё не настроены.
                        </p>
                      ) : (
                        <>
                          <div className="grid gap-4 lg:grid-cols-2">
                            {preview.map(
                              ({ service, previous, reading, invalid, amount, error }) => (
                                <div key={service.id} className="space-y-3 rounded-xl border p-4">
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <p className="font-medium">{service.name}</p>
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        {service.kind === "meter"
                                          ? `${formatUtilityValue(Number(service.rate))} ₽ / ${service.unit}`
                                          : "Фиксированный платёж"}
                                      </p>
                                    </div>
                                    <span className="whitespace-nowrap text-sm font-semibold">
                                      {service.kind === "meter" && invalid
                                        ? "—"
                                        : formatUtilityMoney(amount)}
                                    </span>
                                  </div>
                                  {service.kind === "meter" && (
                                    <>
                                      <div className="space-y-2">
                                        <Label htmlFor={`utility-reading-${service.id}`}>
                                          Текущие показания, {service.unit}
                                        </Label>
                                        <Input
                                          id={`utility-reading-${service.id}`}
                                          inputMode="decimal"
                                          placeholder={`Не меньше ${formatUtilityValue(previous)}`}
                                          value={readings[service.id] ?? ""}
                                          onChange={(event) =>
                                            setReadings((current) => ({
                                              ...current,
                                              [service.id]: event.target.value,
                                            }))
                                          }
                                          aria-invalid={Boolean(readings[service.id] && invalid)}
                                          disabled={submit.isPending}
                                          required
                                        />
                                        <p className="text-xs text-muted-foreground">
                                          Предыдущие: {formatUtilityValue(previous)} {service.unit}
                                          {!invalid && reading !== null
                                            ? ` · Расход: ${formatUtilityValue(reading - previous)} ${service.unit}`
                                            : ""}
                                        </p>
                                        {readings[service.id] && invalid && (
                                          <p className="text-xs text-destructive">{error}</p>
                                        )}
                                      </div>
                                      <FileUploadField
                                        id={`utility-photo-${service.id}`}
                                        file={photos[service.id] ?? null}
                                        onFileChange={(file) =>
                                          setPhotos((current) => ({
                                            ...current,
                                            [service.id]: file,
                                          }))
                                        }
                                        accept="image/jpeg,image/png,image/webp"
                                        description="Фото счётчика, до 8 МБ"
                                        buttonLabel="Выбрать фото"
                                        disabled={submit.isPending}
                                      />
                                    </>
                                  )}
                                </div>
                              ),
                            )}
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-accent/50 p-4">
                            <div>
                              <p className="text-sm text-muted-foreground">
                                Предварительный расчёт коммунальных услуг
                              </p>
                              <p className="mt-1 text-2xl font-semibold">
                                {previewComplete
                                  ? formatUtilityMoney(previewTotal)
                                  : "Заполните показания"}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Аренда начисляется отдельно. Сумма коммунальных услуг появится в
                                платежах после утверждения.
                              </p>
                            </div>
                            <Button type="submit" disabled={submit.isPending || !previewComplete}>
                              <Send className="mr-2 h-4 w-4" />
                              {submit.isPending ? "Отправляем…" : "Отправить на проверку"}
                            </Button>
                          </div>
                        </>
                      )}
                      {formError && (
                        <p role="alert" className="text-sm text-destructive">
                          {formError}
                        </p>
                      )}
                      {previewTotal >= 1_000_000_000_000 && (
                        <p role="alert" className="text-sm text-destructive">
                          Сумма слишком большая. Проверьте показания и тарифы.
                        </p>
                      )}
                    </form>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="space-y-3 p-6">
                    <Gauge className="h-8 w-8 text-muted-foreground" />
                    <p className="font-medium">
                      {agreementServices.some((service) => service.active)
                        ? "Передача показаний пока недоступна"
                        : "Коммунальные услуги ещё не настроены"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {agreementServices.some((service) => service.active)
                        ? "Новые расчёты доступны во время действующей аренды. История сохраняется ниже."
                        : canManage
                          ? "Добавьте счётчики с начальными показаниями и тарифами или фиксированные ежемесячные услуги."
                          : "Собственник добавит счётчики и тарифы — после этого вы сможете передавать показания."}
                    </p>
                    {canManage && agreement.status !== "completed" && (
                      <Button variant="outline" onClick={() => setServiceDialog({ service: null })}>
                        <Plus className="mr-2 h-4 w-4" />
                        Добавить услугу
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}
              <div className="space-y-3">
                <h2 className="flex items-center gap-2 font-semibold">
                  <History className="h-4 w-4" />
                  История расчётов
                </h2>
                {historyPeriods.length > 0 && (
                  <div className="flex flex-wrap gap-3">
                    <Select value={historyPeriod} onValueChange={setHistoryPeriod}>
                      <SelectTrigger className="w-full sm:w-52" aria-label="Месяц истории расчётов">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Все месяцы</SelectItem>
                        {historyPeriods.map((month) => (
                          <SelectItem key={month} value={month}>
                            {formatMonth(`${month}-01`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={historyStatus} onValueChange={setHistoryStatus}>
                      <SelectTrigger
                        className="w-full sm:w-52"
                        aria-label="Статус истории расчётов"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Все результаты</SelectItem>
                        <SelectItem value="approved">Утверждённые</SelectItem>
                        <SelectItem value="rejected">На исправление</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      disabled={historyBills.length === 0}
                      onClick={() =>
                        downloadCsv(
                          `коммунальные-${historyPeriod === "all" ? "история" : historyPeriod}.csv`,
                          buildUtilityHistoryCsv(historyBills, items),
                        )
                      }
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Скачать CSV
                    </Button>
                  </div>
                )}
                {historyBills.map((bill) => (
                  <UtilityBillCard
                    key={bill.id}
                    bill={bill}
                    items={items.filter((item) => item.bill_id === bill.id)}
                    canReview={canManage}
                    charge={charges.data?.find((charge) => charge.id === bill.charge_id)}
                    reportContext={reportContext}
                  />
                ))}
                {historyBills.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {historyPeriods.length === 0
                      ? "Здесь появятся утверждённые расчёты и показания, возвращённые на исправление."
                      : "Расчётов с выбранными фильтрами нет."}
                  </p>
                )}
              </div>
            </TabsContent>
            <TabsContent value="services" className="mt-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-xl text-sm text-muted-foreground">
                  Тарифы устанавливает собственник. Изменение тарифа не меняет сохранённые расчёты.
                </p>
                {canManage && agreement.status !== "completed" && (
                  <Button
                    disabled={Boolean(pendingBill)}
                    onClick={() => setServiceDialog({ service: null })}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Добавить услугу
                  </Button>
                )}
              </div>
              {pendingBill && canManage && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <AlertCircle className="h-4 w-4" />
                  Сначала проверьте отправленный расчёт, затем меняйте настройки.
                </p>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                {agreementServices.map((service) => (
                  <Card key={service.id}>
                    <CardContent className="space-y-3 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 gap-3">
                          <Gauge className="mt-1 h-5 w-5 shrink-0 text-primary" />
                          <div>
                            <p className="break-words font-medium">{service.name}</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {service.kind === "meter"
                                ? `${formatUtilityValue(Number(service.rate))} ₽ / ${service.unit}`
                                : `${formatUtilityMoney(Number(service.rate))} / месяц`}
                            </p>
                          </div>
                        </div>
                        {!service.active && <Badge variant="secondary">Отключена</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        С {formatMonth(service.start_period)}
                        {service.kind === "meter"
                          ? ` · Последние показания: ${formatUtilityValue(previousUtilityReading(service, bills, items))} ${service.unit}`
                          : ""}
                      </p>
                      {canManage && agreement.status !== "completed" && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={Boolean(pendingBill)}
                          onClick={() => setServiceDialog({ service })}
                        >
                          <Settings2 className="mr-2 h-4 w-4" />
                          Тариф и настройки
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
              {agreementServices.length === 0 && (
                <p className="py-6 text-sm text-muted-foreground">
                  Счётчики и фиксированные платежи пока не добавлены.
                </p>
              )}
            </TabsContent>
          </Tabs>
          <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <ArrowRight className="h-4 w-4" />
            Платежи по аренде и коммунальным услугам доступны в общем разделе «Платежи».
          </div>
          {serviceDialog && (
            <UtilityServiceDialog
              key={serviceDialog.service?.id ?? `new-${agreement.id}`}
              agreement={agreement}
              service={serviceDialog.service}
              onClose={() => setServiceDialog(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
