import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ru } from "date-fns/locale";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Download,
  WalletCards,
} from "lucide-react";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { PaymentStatusBadge } from "@/components/PaymentStatusBadge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { createCsv, downloadCsv } from "@/lib/csv";
import {
  formatDate,
  formatMoney,
  formatMonth,
  getPaymentStatus,
  localDateKey,
  paymentStatusLabels,
  type PaymentStatus,
} from "@/lib/domain";
import {
  fetchAgreements,
  fetchProperties,
  fetchRentCharges,
  fetchTenants,
  fetchUnits,
  type RentCharge,
} from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/payments")({
  head: () => ({
    meta: [
      { title: "Платежи — Умная Аренда" },
      {
        name: "description",
        content: "Начисления аренды, задолженность и история оплат.",
      },
    ],
  }),
  component: PaymentsPage,
});

type PaymentFilter = "all" | PaymentStatus;

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: typeof CreditCard;
  label: string;
  value: string;
  tone?: "default" | "danger" | "success";
}) {
  const iconStyle =
    tone === "danger"
      ? "bg-destructive/10 text-destructive"
      : tone === "success"
        ? "bg-success/12 text-success"
        : "bg-accent text-accent-foreground";
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${iconStyle}`}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="truncate text-xl font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function PaymentsPage() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const charges = useQuery({ queryKey: ["rent-charges"], queryFn: fetchRentCharges });
  const agreements = useQuery({ queryKey: ["agreements"], queryFn: fetchAgreements });
  const properties = useQuery({ queryKey: ["properties"], queryFn: fetchProperties });
  const units = useQuery({ queryKey: ["units"], queryFn: fetchUnits });
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: fetchTenants });
  const [statusFilter, setStatusFilter] = useState<PaymentFilter>("all");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [tenantFilter, setTenantFilter] = useState("all");
  const [periodRange, setPeriodRange] = useState<DateRange>();
  const [periodCalendarOpen, setPeriodCalendarOpen] = useState(false);
  const [selectedCharge, setSelectedCharge] = useState<RentCharge | null>(null);
  const [paidDate, setPaidDate] = useState(localDateKey());
  const [paymentNote, setPaymentNote] = useState("");
  const [selectedChargeIds, setSelectedChargeIds] = useState<Set<string>>(new Set());
  const [bulkPaymentOpen, setBulkPaymentOpen] = useState(false);
  const [bulkPaidDate, setBulkPaidDate] = useState(localDateKey());
  const [bulkPaymentNote, setBulkPaymentNote] = useState("");

  const currentMonth = localDateKey().slice(0, 7);
  const allCharges = useMemo(() => charges.data ?? [], [charges.data]);
  const overdueTotal = allCharges
    .filter((charge) => getPaymentStatus(charge) === "overdue")
    .reduce((sum, charge) => sum + Number(charge.amount), 0);
  const currentMonthDue = allCharges
    .filter((charge) => charge.period_start.startsWith(currentMonth) && charge.paid_at == null)
    .reduce((sum, charge) => sum + Number(charge.amount), 0);
  const currentMonthPaid = allCharges
    .filter((charge) => charge.paid_at?.slice(0, 7) === currentMonth)
    .reduce((sum, charge) => sum + Number(charge.amount), 0);

  const periodLimits = useMemo(() => {
    if (allCharges.length === 0) return undefined;
    const periods = allCharges.map((charge) => charge.period_start).sort();
    return {
      start: new Date(`${periods[0]}T12:00:00`),
      end: new Date(`${periods.at(-1)}T12:00:00`),
    };
  }, [allCharges]);

  const periodFrom = periodRange?.from ? localDateKey(periodRange.from).slice(0, 7) : null;
  const periodTo = periodRange?.to ? localDateKey(periodRange.to).slice(0, 7) : null;

  const visibleCharges = useMemo(() => {
    const statusOrder: Record<PaymentStatus, number> = { overdue: 0, pending: 1, paid: 2 };
    return allCharges
      .filter((charge) => {
        const agreement = agreements.data?.find((item) => item.id === charge.agreement_id);
        const status = getPaymentStatus(charge);
        const chargePeriod = charge.period_start.slice(0, 7);
        return (
          (statusFilter === "all" || status === statusFilter) &&
          (propertyFilter === "all" || agreement?.property_id === propertyFilter) &&
          (tenantFilter === "all" || charge.tenant_id === tenantFilter) &&
          (!periodFrom || chargePeriod >= periodFrom) &&
          (!periodTo || chargePeriod <= periodTo)
        );
      })
      .sort((a, b) => {
        const statusDifference =
          statusOrder[getPaymentStatus(a)] - statusOrder[getPaymentStatus(b)];
        if (statusDifference !== 0) return statusDifference;
        return getPaymentStatus(a) === "paid"
          ? b.due_date.localeCompare(a.due_date)
          : a.due_date.localeCompare(b.due_date);
      });
  }, [
    agreements.data,
    allCharges,
    periodFrom,
    periodTo,
    propertyFilter,
    statusFilter,
    tenantFilter,
  ]);

  useEffect(() => {
    setSelectedChargeIds(new Set());
  }, [periodRange, propertyFilter, statusFilter, tenantFilter]);

  const selectableCharges = visibleCharges.filter((charge) => charge.paid_at == null);
  const allSelectableChecked =
    selectableCharges.length > 0 &&
    selectableCharges.every((charge) => selectedChargeIds.has(charge.id));

  const toggleCharge = (chargeId: string, checked: boolean) => {
    setSelectedChargeIds((current) => {
      const next = new Set(current);
      if (checked) next.add(chargeId);
      else next.delete(chargeId);
      return next;
    });
  };

  const toggleAllSelectable = (checked: boolean) => {
    setSelectedChargeIds(
      checked ? new Set(selectableCharges.map((charge) => charge.id)) : new Set(),
    );
  };

  const openPaymentDialog = (charge: RentCharge) => {
    setSelectedCharge(charge);
    setPaidDate(charge.paid_at ? localDateKey(new Date(charge.paid_at)) : localDateKey());
    setPaymentNote(charge.payment_note ?? "");
  };

  const savePayment = useMutation({
    mutationFn: async () => {
      if (!selectedCharge) throw new Error("Начисление не выбрано");
      if (!paidDate) throw new Error("Укажите дату оплаты");
      if (paidDate > localDateKey()) throw new Error("Дата оплаты не может быть в будущем");
      const { error } = await supabase
        .from("rent_charges")
        .update({
          paid_at: new Date(`${paidDate}T12:00:00`).toISOString(),
          payment_note: paymentNote.trim() || null,
        })
        .eq("id", selectedCharge.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success(selectedCharge?.paid_at ? "Данные оплаты обновлены" : "Оплата отмечена");
      setSelectedCharge(null);
      void qc.invalidateQueries({ queryKey: ["rent-charges"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const clearPayment = useMutation({
    mutationFn: async () => {
      if (!selectedCharge) throw new Error("Начисление не выбрано");
      const { error } = await supabase
        .from("rent_charges")
        .update({ paid_at: null, payment_note: null })
        .eq("id", selectedCharge.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Отметка об оплате снята");
      setSelectedCharge(null);
      void qc.invalidateQueries({ queryKey: ["rent-charges"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveBulkPayment = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selectedChargeIds);
      if (ids.length === 0) throw new Error("Выберите начисления");
      if (!bulkPaidDate) throw new Error("Укажите дату оплаты");
      if (bulkPaidDate > localDateKey()) throw new Error("Дата оплаты не может быть в будущем");
      const { error } = await supabase
        .from("rent_charges")
        .update({
          paid_at: new Date(`${bulkPaidDate}T12:00:00`).toISOString(),
          payment_note: bulkPaymentNote.trim() || null,
        })
        .in("id", ids);
      if (error) throw new Error(error.message);
      return ids.length;
    },
    onSuccess: (count) => {
      toast.success(`Оплачено начислений: ${count}`);
      setBulkPaymentOpen(false);
      setSelectedChargeIds(new Set());
      void qc.invalidateQueries({ queryKey: ["rent-charges"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const loading = [charges, agreements, properties, units, tenants].some(
    (query) => query.isPending,
  );
  const failed = [charges, agreements, properties, units, tenants].some((query) => query.isError);

  const agreementFor = (charge: RentCharge) =>
    agreements.data?.find((agreement) => agreement.id === charge.agreement_id);
  const propertyFor = (charge: RentCharge) => {
    const agreement = agreementFor(charge);
    return properties.data?.find((property) => property.id === agreement?.property_id);
  };
  const unitFor = (charge: RentCharge) => {
    const agreement = agreementFor(charge);
    return units.data?.find((unit) => unit.id === agreement?.unit_id);
  };
  const tenantFor = (charge: RentCharge) =>
    tenants.data?.find((tenant) => tenant.id === charge.tenant_id);

  const exportPayments = () => {
    const csv = createCsv(
      [
        "Статус",
        "Период",
        "Срок оплаты",
        "Дата оплаты",
        "Сумма, ₽",
        "Объект",
        "Помещение",
        "Арендатор",
        "Комментарий",
      ],
      visibleCharges.map((charge) => [
        paymentStatusLabels[getPaymentStatus(charge)],
        formatMonth(charge.period_start),
        formatDate(charge.due_date),
        charge.paid_at ? formatDate(charge.paid_at) : "",
        Number(charge.amount),
        propertyFor(charge)?.name ?? "",
        unitFor(charge)?.name ?? "",
        tenantFor(charge)?.name ?? "",
        charge.payment_note ?? "",
      ]),
    );
    downloadCsv(`rent-payments-${localDateKey()}.csv`, csv);
    toast.success("Отчёт CSV скачан");
  };

  return (
    <>
      <PageHeader
        title="Платежи"
        description={
          role === "tenant"
            ? "Календарь аренды, задолженность и история оплат"
            : "Начисления аренды, поступления и задолженность"
        }
        action={
          <Button
            variant="outline"
            onClick={exportPayments}
            disabled={loading || failed || visibleCharges.length === 0}
          >
            <Download className="h-4 w-4" />
            Скачать CSV
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          icon={AlertTriangle}
          label="Просрочено"
          value={formatMoney(overdueTotal)}
          tone={overdueTotal > 0 ? "danger" : "default"}
        />
        <SummaryCard
          icon={CalendarDays}
          label="К оплате в этом месяце"
          value={formatMoney(currentMonthDue)}
        />
        <SummaryCard
          icon={CheckCircle2}
          label={role === "tenant" ? "Оплачено в этом месяце" : "Получено в этом месяце"}
          value={formatMoney(currentMonthPaid)}
          tone="success"
        />
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as PaymentFilter)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value="pending">Ожидается</SelectItem>
            <SelectItem value="overdue">Просрочено</SelectItem>
            <SelectItem value="paid">Оплачено</SelectItem>
          </SelectContent>
        </Select>

        <Popover open={periodCalendarOpen} onOpenChange={setPeriodCalendarOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="h-10 justify-start px-3 font-normal">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <span className="truncate">
                {!periodRange?.from
                  ? "Все периоды"
                  : periodRange.to
                    ? `${formatMonth(localDateKey(periodRange.from))} — ${formatMonth(localDateKey(periodRange.to))}`
                    : `С ${formatMonth(localDateKey(periodRange.from))}`}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="range"
              selected={periodRange}
              onSelect={setPeriodRange}
              {...(periodLimits
                ? {
                    defaultMonth: periodRange?.from ?? periodLimits.end,
                    startMonth: periodLimits.start,
                    endMonth: periodLimits.end,
                  }
                : {})}
              captionLayout="dropdown"
              locale={ru}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3">
              <p className="text-xs text-muted-foreground">Выберите начало и конец периода</p>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!periodRange}
                  onClick={() => {
                    setPeriodRange(undefined);
                    setPeriodCalendarOpen(false);
                  }}
                >
                  Сбросить
                </Button>
                <Button size="sm" onClick={() => setPeriodCalendarOpen(false)}>
                  Готово
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <Select value={propertyFilter} onValueChange={setPropertyFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Все объекты" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все объекты</SelectItem>
            {(properties.data ?? []).map((property) => (
              <SelectItem key={property.id} value={property.id}>
                {property.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {role !== "tenant" && (
          <Select value={tenantFilter} onValueChange={setTenantFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Все арендаторы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все арендаторы</SelectItem>
              {(tenants.data ?? []).map((tenant) => (
                <SelectItem key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Найдено начислений: {visibleCharges.length}</p>
        {role !== "tenant" && selectableCharges.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={allSelectableChecked}
                onCheckedChange={(checked) => toggleAllSelectable(checked === true)}
                aria-label="Выбрать все неоплаченные начисления"
              />
              Выбрать неоплаченные
            </label>
            <Button
              size="sm"
              disabled={selectedChargeIds.size === 0}
              onClick={() => {
                setBulkPaidDate(localDateKey());
                setBulkPaymentNote("");
                setBulkPaymentOpen(true);
              }}
            >
              Отметить оплату ({selectedChargeIds.size})
            </Button>
          </div>
        )}
      </div>

      {loading && <p className="mt-4 text-sm text-muted-foreground">Загружаем платежи…</p>}
      {failed && (
        <p className="mt-4 text-sm text-destructive">
          Не удалось загрузить начисления. Проверьте применение миграции Supabase.
        </p>
      )}

      {!loading && !failed && visibleCharges.length > 0 && (
        <div className="mt-4 space-y-3">
          {visibleCharges.map((charge) => {
            const status = getPaymentStatus(charge);
            const property = propertyFor(charge);
            const unit = unitFor(charge);
            const tenant = tenantFor(charge);
            return (
              <Card key={charge.id}>
                <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center">
                  {role !== "tenant" && charge.paid_at == null && (
                    <Checkbox
                      checked={selectedChargeIds.has(charge.id)}
                      onCheckedChange={(checked) => toggleCharge(charge.id, checked === true)}
                      aria-label={`Выбрать начисление за ${formatMonth(charge.period_start)}`}
                    />
                  )}
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
                    <WalletCards className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold capitalize">{formatMonth(charge.period_start)}</p>
                      <PaymentStatusBadge status={status} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {property?.name ?? "Объект"}
                      {unit ? ` · ${unit.name}` : ""}
                      {role !== "tenant" ? ` · ${tenant?.name ?? "Арендатор"}` : ""}
                    </p>
                    <p className="mt-1 text-sm">
                      Срок оплаты: {formatDate(charge.due_date)}
                      {charge.paid_at ? ` · Оплачено ${formatDate(charge.paid_at)}` : ""}
                    </p>
                    {charge.payment_note && (
                      <p className="mt-1 text-xs text-muted-foreground">{charge.payment_note}</p>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-3 md:flex-col md:items-end">
                    <p className="text-lg font-semibold">{formatMoney(charge.amount)}</p>
                    {role !== "tenant" && (
                      <Button variant="outline" size="sm" onClick={() => openPaymentDialog(charge)}>
                        {charge.paid_at ? "Изменить оплату" : "Отметить оплату"}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {!loading && !failed && visibleCharges.length === 0 && (
        <Card className="mt-4">
          <CardContent className="p-10 text-center">
            <CreditCard className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium">Начислений не найдено</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Они создаются автоматически для активных договоров аренды.
            </p>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={Boolean(selectedCharge)}
        onOpenChange={(open) => !open && setSelectedCharge(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedCharge?.paid_at ? "Изменить оплату" : "Отметить оплату"}
            </DialogTitle>
            <DialogDescription>
              {selectedCharge
                ? `${formatMonth(selectedCharge.period_start)} · ${formatMoney(selectedCharge.amount)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="paid-date">Дата оплаты</Label>
              <Input
                id="paid-date"
                type="date"
                value={paidDate}
                max={localDateKey()}
                onChange={(event) => setPaidDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payment-note">Комментарий, необязательно</Label>
              <Textarea
                id="payment-note"
                value={paymentNote}
                onChange={(event) => setPaymentNote(event.target.value)}
                placeholder="Например, перевод по СБП"
                maxLength={1000}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {selectedCharge?.paid_at ? (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => clearPayment.mutate()}
                disabled={clearPayment.isPending || savePayment.isPending}
              >
                Снять отметку
              </Button>
            ) : (
              <span />
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSelectedCharge(null)}>
                Отмена
              </Button>
              <Button
                onClick={() => savePayment.mutate()}
                disabled={savePayment.isPending || clearPayment.isPending || !paidDate}
              >
                {savePayment.isPending ? "Сохраняем…" : "Сохранить"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkPaymentOpen} onOpenChange={setBulkPaymentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отметить несколько оплат</DialogTitle>
            <DialogDescription>
              Выбрано начислений: {selectedChargeIds.size}. Для всех будет сохранена одна дата и
              общий комментарий.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bulk-paid-date">Дата оплаты</Label>
              <Input
                id="bulk-paid-date"
                type="date"
                value={bulkPaidDate}
                max={localDateKey()}
                onChange={(event) => setBulkPaidDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bulk-payment-note">Общий комментарий, необязательно</Label>
              <Textarea
                id="bulk-payment-note"
                value={bulkPaymentNote}
                onChange={(event) => setBulkPaymentNote(event.target.value)}
                placeholder="Например, оплата по реестру"
                maxLength={1000}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkPaymentOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={() => saveBulkPayment.mutate()}
              disabled={saveBulkPayment.isPending || selectedChargeIds.size === 0 || !bulkPaidDate}
            >
              {saveBulkPayment.isPending ? "Сохраняем…" : "Подтвердить оплату"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
