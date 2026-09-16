import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ru } from "date-fns/locale";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Download,
  History,
  Paperclip,
  PencilLine,
  Trash2,
  WalletCards,
} from "lucide-react";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { DebtCenter } from "@/components/DebtCenter";
import { PaymentAnalyticsCharts } from "@/components/PaymentAnalyticsCharts";
import { PaymentReportsPanel } from "@/components/PaymentReportsPanel";
import { PaymentStatusBadge } from "@/components/PaymentStatusBadge";
import { RentForecastPanel } from "@/components/RentForecastPanel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { buildDebtGroups } from "@/lib/debt-center";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatMonth,
  getPaymentStatus,
  getRentChargeBalance,
  getRentChargeTotal,
  localDateKey,
  paymentStatusLabels,
  type PaymentStatus,
} from "@/lib/domain";
import { buildPaymentAnalytics } from "@/lib/payment-analytics";
import { buildRentForecast } from "@/lib/rent-forecast";
import { downloadFile, PAYMENT_RECEIPTS, removeFile, uploadFile } from "@/lib/storage";
import {
  fetchAgreements,
  fetchProperties,
  fetchPaymentReports,
  fetchRentChargeAdjustmentEvents,
  fetchRentCharges,
  fetchRentPayments,
  fetchTenants,
  fetchUnits,
  reviewPaymentReport,
  sendPaymentReminder,
  type RentCharge,
  type RentPayment,
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
  const { role, user } = useAuth();
  const canReviewPaymentReports = role === "owner" || role === "admin";
  const qc = useQueryClient();
  const charges = useQuery({ queryKey: ["rent-charges"], queryFn: fetchRentCharges });
  const payments = useQuery({ queryKey: ["rent-payments"], queryFn: fetchRentPayments });
  const paymentReports = useQuery({
    queryKey: ["payment-reports"],
    queryFn: fetchPaymentReports,
    enabled: canReviewPaymentReports,
  });
  const adjustmentEvents = useQuery({
    queryKey: ["rent-charge-adjustment-events"],
    queryFn: fetchRentChargeAdjustmentEvents,
  });
  const agreements = useQuery({ queryKey: ["agreements"], queryFn: fetchAgreements });
  const properties = useQuery({ queryKey: ["properties"], queryFn: fetchProperties });
  const units = useQuery({ queryKey: ["units"], queryFn: fetchUnits });
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: fetchTenants });
  const [statusFilter, setStatusFilter] = useState<PaymentFilter>("all");
  const [propertyFilters, setPropertyFilters] = useState<string[]>([]);
  const [tenantFilter, setTenantFilter] = useState("all");
  const [periodRange, setPeriodRange] = useState<DateRange>();
  const [periodCalendarOpen, setPeriodCalendarOpen] = useState(false);
  const [selectedCharge, setSelectedCharge] = useState<RentCharge | null>(null);
  const [adjustmentCharge, setAdjustmentCharge] = useState<RentCharge | null>(null);
  const [adjustedTotal, setAdjustedTotal] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [paidDate, setPaidDate] = useState(localDateKey());
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentReceipt, setPaymentReceipt] = useState<File | null>(null);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);
  const [selectedChargeIds, setSelectedChargeIds] = useState<Set<string>>(new Set());
  const [bulkPaymentOpen, setBulkPaymentOpen] = useState(false);
  const [bulkPaidDate, setBulkPaidDate] = useState(localDateKey());
  const [bulkPaymentNote, setBulkPaymentNote] = useState("");
  const [forecastHorizon, setForecastHorizon] = useState(6);

  const currentMonth = localDateKey().slice(0, 7);
  const allCharges = useMemo(() => charges.data ?? [], [charges.data]);
  const paymentFeatureAvailable = payments.data?.available ?? false;
  const receiptFeatureAvailable = payments.data?.receiptsAvailable ?? false;
  const paymentRows = payments.data?.payments;
  const paymentsByCharge = useMemo(() => {
    const rows = new Map<string, RentPayment[]>();
    for (const payment of paymentRows ?? []) {
      const current = rows.get(payment.charge_id) ?? [];
      current.push(payment);
      rows.set(payment.charge_id, current);
    }
    return rows;
  }, [paymentRows]);
  const adjustmentFeatureAvailable = adjustmentEvents.data?.available ?? false;
  const adjustmentEventRows = adjustmentEvents.data?.events;
  const adjustmentEventsByCharge = useMemo(() => {
    const eventsByCharge = new Map<string, NonNullable<typeof adjustmentEventRows>>();
    for (const event of adjustmentEventRows ?? []) {
      const events = eventsByCharge.get(event.charge_id) ?? [];
      events.push(event);
      eventsByCharge.set(event.charge_id, events);
    }
    return eventsByCharge;
  }, [adjustmentEventRows]);
  const overdueTotal = allCharges
    .filter((charge) => charge.paid_at == null && charge.due_date < localDateKey())
    .reduce((sum, charge) => sum + getRentChargeBalance(charge), 0);
  const currentMonthDue = allCharges
    .filter((charge) => charge.period_start.startsWith(currentMonth) && charge.paid_at == null)
    .reduce((sum, charge) => sum + getRentChargeBalance(charge), 0);
  const currentMonthPaid = paymentFeatureAvailable
    ? (payments.data?.payments ?? [])
        .filter((payment) => payment.paid_at.slice(0, 7) === currentMonth)
        .reduce((sum, payment) => sum + Number(payment.amount), 0)
    : allCharges
        .filter((charge) => charge.paid_at?.slice(0, 7) === currentMonth)
        .reduce((sum, charge) => sum + getRentChargeTotal(charge), 0);

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
    const statusOrder: Record<PaymentStatus, number> = {
      overdue: 0,
      partial: 1,
      pending: 2,
      paid: 3,
    };
    return allCharges
      .filter((charge) => {
        const agreement = agreements.data?.find((item) => item.id === charge.agreement_id);
        const status = getPaymentStatus(charge);
        const chargePeriod = charge.period_start.slice(0, 7);
        return (
          (statusFilter === "all" ||
            status === statusFilter ||
            (statusFilter === "overdue" &&
              charge.paid_at == null &&
              charge.due_date < localDateKey())) &&
          (propertyFilters.length === 0 ||
            (agreement?.property_id != null && propertyFilters.includes(agreement.property_id))) &&
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
    propertyFilters,
    statusFilter,
    tenantFilter,
  ]);

  const filteredSummary = useMemo(() => {
    const agreementById = new Map((agreements.data ?? []).map((item) => [item.id, item]));
    const propertyById = new Map((properties.data ?? []).map((item) => [item.id, item]));

    return buildPaymentAnalytics(
      visibleCharges.map((charge) => {
        const propertyId = agreementById.get(charge.agreement_id)?.property_id ?? "unknown";
        return {
          amount: getRentChargeTotal(charge),
          paidAmount: Number(
            charge.paid_amount ?? (charge.paid_at ? getRentChargeTotal(charge) : 0),
          ),
          period: charge.period_start.slice(0, 7),
          propertyId,
          propertyName: propertyById.get(propertyId)?.name ?? "Без объекта",
        };
      }),
    );
  }, [agreements.data, properties.data, visibleCharges]);

  const debtGroups = useMemo(() => {
    const agreementById = new Map((agreements.data ?? []).map((item) => [item.id, item]));
    const propertyById = new Map((properties.data ?? []).map((item) => [item.id, item]));
    const tenantById = new Map((tenants.data ?? []).map((item) => [item.id, item]));
    const today = localDateKey();

    return buildDebtGroups(
      allCharges
        .filter((charge) => {
          const agreement = agreementById.get(charge.agreement_id);
          return (
            charge.paid_at == null &&
            charge.due_date < today &&
            (propertyFilters.length === 0 ||
              (agreement?.property_id != null &&
                propertyFilters.includes(agreement.property_id))) &&
            (tenantFilter === "all" || charge.tenant_id === tenantFilter)
          );
        })
        .map((charge) => {
          const agreement = agreementById.get(charge.agreement_id);
          return {
            chargeId: charge.id,
            agreementId: charge.agreement_id,
            propertyName: propertyById.get(agreement?.property_id ?? "")?.name ?? "Без объекта",
            tenantName: tenantById.get(charge.tenant_id)?.name ?? "Арендатор",
            amount: getRentChargeBalance(charge),
            dueDate: charge.due_date,
          };
        }),
      today,
    );
  }, [agreements.data, allCharges, properties.data, propertyFilters, tenantFilter, tenants.data]);

  const rentForecast = useMemo(() => {
    const propertyById = new Map((properties.data ?? []).map((item) => [item.id, item]));
    const tenantById = new Map((tenants.data ?? []).map((item) => [item.id, item]));
    const forecastAgreements = (agreements.data ?? [])
      .filter(
        (agreement) =>
          (propertyFilters.length === 0 || propertyFilters.includes(agreement.property_id)) &&
          (tenantFilter === "all" || tenantFilter === agreement.tenant_id),
      )
      .map((agreement) => ({
        id: agreement.id,
        status: agreement.status,
        startDate: agreement.start_date,
        endDate: agreement.end_date,
        monthlyPayment: Number(agreement.monthly_payment),
        propertyId: agreement.property_id,
        propertyName: propertyById.get(agreement.property_id)?.name ?? "Без объекта",
        tenantId: agreement.tenant_id,
        tenantName: tenantById.get(agreement.tenant_id)?.name ?? "Арендатор",
      }));

    return buildRentForecast({
      agreements: forecastAgreements,
      startPeriod: currentMonth,
      horizonMonths: forecastHorizon,
    });
  }, [
    agreements.data,
    currentMonth,
    forecastHorizon,
    properties.data,
    propertyFilters,
    tenantFilter,
    tenants.data,
  ]);

  useEffect(() => {
    setSelectedChargeIds(new Set());
  }, [periodRange, propertyFilters, statusFilter, tenantFilter]);

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

  const openDebtPayment = (chargeIds: string[]) => {
    setSelectedChargeIds(new Set(chargeIds));
    setBulkPaidDate(localDateKey());
    setBulkPaymentNote("");
    setBulkPaymentOpen(true);
  };

  const openPaymentDialog = (charge: RentCharge) => {
    setSelectedCharge(charge);
    setPaidDate(localDateKey());
    setPaymentAmount(String(getRentChargeBalance(charge)));
    setPaymentNote("");
    setPaymentReceipt(null);
  };

  const openAdjustmentDialog = (charge: RentCharge) => {
    setAdjustmentCharge(charge);
    setAdjustedTotal(String(getRentChargeTotal(charge)));
    setAdjustmentReason("");
  };

  const savePayment = useMutation({
    mutationFn: async () => {
      if (!selectedCharge) throw new Error("Начисление не выбрано");
      if (!paidDate) throw new Error("Укажите дату оплаты");
      if (paidDate > localDateKey()) throw new Error("Дата оплаты не может быть в будущем");
      const amount = Number(paymentAmount.replace(",", "."));
      const balance = getRentChargeBalance(selectedCharge);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Укажите сумму больше нуля");
      if (paymentFeatureAvailable && amount > balance) {
        throw new Error(`Сумма больше остатка ${formatMoney(balance)}`);
      }

      let receiptPath: string | null = null;
      try {
        if (paymentReceipt && receiptFeatureAvailable) {
          if (!user) throw new Error("Не удалось определить пользователя");
          receiptPath = await uploadFile(PAYMENT_RECEIPTS, user.id, paymentReceipt);
        }

        const { error } = paymentFeatureAvailable
          ? await supabase.from("rent_payments").insert({
              charge_id: selectedCharge.id,
              owner_id: selectedCharge.owner_id,
              tenant_id: selectedCharge.tenant_id,
              amount,
              paid_at: new Date(`${paidDate}T12:00:00`).toISOString(),
              note: paymentNote.trim() || null,
              receipt_file: receiptPath,
            })
          : await supabase
              .from("rent_charges")
              .update({
                paid_at: new Date(`${paidDate}T12:00:00`).toISOString(),
                payment_note: paymentNote.trim() || null,
              })
              .eq("id", selectedCharge.id);
        if (error) throw new Error(error.message);
      } catch (error) {
        if (receiptPath) await removeFile(PAYMENT_RECEIPTS, receiptPath).catch(() => undefined);
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Платёж добавлен");
      setSelectedCharge(null);
      void qc.invalidateQueries({ queryKey: ["rent-charges"] });
      void qc.invalidateQueries({ queryKey: ["rent-payments"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deletePayment = useMutation({
    mutationFn: async (paymentId?: string) => {
      if (!selectedCharge) throw new Error("Начисление не выбрано");
      const payment = payments.data?.payments.find((item) => item.id === paymentId);
      const { error } = paymentFeatureAvailable
        ? await supabase
            .from("rent_payments")
            .delete()
            .eq("id", paymentId ?? "")
        : await supabase
            .from("rent_charges")
            .update({ paid_at: null, payment_note: null })
            .eq("id", selectedCharge.id);
      if (error) throw new Error(error.message);
      if (payment?.receipt_file) {
        await removeFile(PAYMENT_RECEIPTS, payment.receipt_file).catch(() => undefined);
      }
    },
    onSuccess: () => {
      toast.success("Платёж удалён");
      setDeletingPaymentId(null);
      void qc.invalidateQueries({ queryKey: ["rent-charges"] });
      void qc.invalidateQueries({ queryKey: ["rent-payments"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveBulkPayment = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selectedChargeIds);
      if (ids.length === 0) throw new Error("Выберите начисления");
      if (!bulkPaidDate) throw new Error("Укажите дату оплаты");
      if (bulkPaidDate > localDateKey()) throw new Error("Дата оплаты не может быть в будущем");
      const selected = allCharges.filter((charge) => ids.includes(charge.id));
      const { error } = paymentFeatureAvailable
        ? await supabase.from("rent_payments").insert(
            selected.map((charge) => ({
              charge_id: charge.id,
              owner_id: charge.owner_id,
              tenant_id: charge.tenant_id,
              amount: getRentChargeBalance(charge),
              paid_at: new Date(`${bulkPaidDate}T12:00:00`).toISOString(),
              note: bulkPaymentNote.trim() || null,
            })),
          )
        : await supabase
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
      void qc.invalidateQueries({ queryKey: ["rent-payments"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveAdjustment = useMutation({
    mutationFn: async () => {
      if (!adjustmentCharge) throw new Error("Начисление не выбрано");
      if (Number(adjustmentCharge.paid_amount ?? 0) > 0 || adjustmentCharge.paid_at) {
        throw new Error("Начисление с платежами нельзя корректировать");
      }

      const total = Number(adjustedTotal.replace(",", "."));
      if (!Number.isFinite(total) || total < 0) {
        throw new Error("Укажите итоговую сумму не меньше нуля");
      }
      if (!adjustmentReason.trim()) throw new Error("Укажите причину корректировки");

      const adjustmentAmount = Math.round((total - Number(adjustmentCharge.amount)) * 100) / 100;
      const { data, error } = await supabase
        .from("rent_charges")
        .update({
          adjustment_amount: adjustmentAmount,
          adjustment_reason: adjustmentReason.trim(),
        })
        .eq("id", adjustmentCharge.id)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Нет доступа к изменению начисления");
    },
    onSuccess: () => {
      toast.success("Начисление скорректировано");
      setAdjustmentCharge(null);
      void qc.invalidateQueries({ queryKey: ["rent-charges"] });
      void qc.invalidateQueries({ queryKey: ["rent-charge-adjustment-events"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const sendReminder = useMutation({
    mutationFn: sendPaymentReminder,
    onSuccess: (result) => {
      const messages = {
        sent: "Напоминание отправлено арендатору",
        already_sent: "Сегодня напоминание по этому договору уже отправляли",
        tenant_not_connected: "Арендатор ещё не зарегистрирован в сервисе",
        no_debt: "Задолженность по договору уже погашена",
      } as const;
      if (result === "sent") toast.success(messages[result]);
      else toast.info(messages[result]);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const sendAllReminders = useMutation({
    mutationFn: async (agreementIds: string[]) => {
      const settled = await Promise.allSettled(agreementIds.map(sendPaymentReminder));
      const results = settled.flatMap((item) => (item.status === "fulfilled" ? [item.value] : []));
      const failed = settled.filter((item) => item.status === "rejected");
      if (results.length === 0 && failed.length > 0) {
        throw failed[0]?.reason ?? new Error("Не удалось отправить напоминания");
      }
      return { results, failedCount: failed.length };
    },
    onSuccess: ({ results, failedCount }) => {
      const sent = results.filter((result) => result === "sent").length;
      const alreadySent = results.filter((result) => result === "already_sent").length;
      const notConnected = results.filter((result) => result === "tenant_not_connected").length;
      const noDebt = results.filter((result) => result === "no_debt").length;
      const summary = [
        sent > 0 && `отправлено — ${sent}`,
        alreadySent > 0 && `уже отправляли сегодня — ${alreadySent}`,
        notConnected > 0 && `арендаторы не подключены — ${notConnected}`,
        noDebt > 0 && `долг уже погашен — ${noDebt}`,
        failedCount > 0 && `ошибка отправки — ${failedCount}`,
      ]
        .filter(Boolean)
        .join(" · ");
      if (sent > 0) toast.success(`Напоминания: ${summary}`);
      else toast.info(`Напоминания: ${summary}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reviewReport = useMutation({
    mutationFn: reviewPaymentReport,
    onSuccess: (status) => {
      toast.success(
        status === "approved" ? "Оплата подтверждена" : "Сообщение об оплате отклонено",
      );
      void qc.invalidateQueries({ queryKey: ["payment-reports"] });
      void qc.invalidateQueries({ queryKey: ["rent-charges"] });
      void qc.invalidateQueries({ queryKey: ["rent-payments"] });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const pageQueries = [
    charges,
    payments,
    agreements,
    properties,
    units,
    tenants,
    ...(canReviewPaymentReports ? [paymentReports] : []),
  ];
  const loading = pageQueries.some((query) => query.isPending);
  const failed = pageQueries.some((query) => query.isError);

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
  const adjustmentEventsFor = (charge: RentCharge) => adjustmentEventsByCharge.get(charge.id) ?? [];
  const openReceipt = (payment: RentPayment) => {
    if (!payment.receipt_file) return;
    const extension = payment.receipt_file.split(".").pop() ?? "pdf";
    void downloadFile(
      PAYMENT_RECEIPTS,
      payment.receipt_file,
      `чек-${payment.paid_at.slice(0, 10)}.${extension}`,
    );
  };

  const exportPayments = () => {
    const csv = createCsv(
      [
        "Статус",
        "Период",
        "Срок оплаты",
        "Дата оплаты",
        "Базовая сумма, ₽",
        "Корректировка, ₽",
        "Итого, ₽",
        "Оплачено, ₽",
        "Остаток, ₽",
        "Причина корректировки",
        "Объект",
        "Помещение",
        "Арендатор",
        "Комментарий",
      ],
      [
        ...visibleCharges.map((charge) => [
          paymentStatusLabels[getPaymentStatus(charge)],
          formatMonth(charge.period_start),
          formatDate(charge.due_date),
          charge.paid_at ? formatDate(charge.paid_at) : "",
          Number(charge.amount),
          Number(charge.adjustment_amount ?? 0),
          getRentChargeTotal(charge),
          Number(charge.paid_amount ?? (charge.paid_at ? getRentChargeTotal(charge) : 0)),
          getRentChargeBalance(charge),
          charge.adjustment_reason ?? "",
          propertyFor(charge)?.name ?? "",
          unitFor(charge)?.name ?? "",
          tenantFor(charge)?.name ?? "",
          charge.payment_note ?? "",
        ]),
        [],
        ["Итого начислено", "", "", "", "", "", filteredSummary.accrued],
        ["Итого оплачено", "", "", "", "", "", filteredSummary.paid],
        ["Итого не оплачено", "", "", "", "", "", filteredSummary.unpaid],
        [`Собираемость: ${filteredSummary.collectionRate}%`],
      ],
    );
    downloadCsv(`rent-payments-${localDateKey()}.csv`, csv);
    toast.success("Отчёт CSV скачан");
  };

  const hasNoBillingData =
    !loading && !failed && (agreements.data?.length ?? 0) === 0 && allCharges.length === 0;

  if (hasNoBillingData) {
    const isTenant = role === "tenant";
    return (
      <>
        <PageHeader
          title="Платежи"
          description={
            isTenant
              ? "Начисления, оплаты и задолженность по вашей аренде"
              : "Начисления аренды, поступления и задолженность"
          }
        />

        <Card className="overflow-hidden">
          <CardContent className="relative p-8 sm:p-12">
            <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-accent/70 blur-3xl" />
            <div className="relative max-w-2xl">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent text-accent-foreground">
                <WalletCards className="h-7 w-7" />
              </span>
              <h2 className="mt-6 text-2xl font-semibold tracking-tight">
                {isTenant ? "Платежей пока нет" : "Платежи появятся после создания договора"}
              </h2>
              <p className="mt-3 text-base leading-7 text-muted-foreground">
                {isTenant
                  ? "Когда собственник добавит и активирует договор, здесь появятся график начислений, история оплат и актуальный остаток."
                  : "Создайте договор аренды и переведите его в статус «Активен». Мы автоматически сформируем график начислений, прогноз дохода и контроль задолженности."}
              </p>

              {!isTenant && (
                <div className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
                  {["Создайте договор", "Активируйте его", "Следите за оплатами"].map(
                    (step, index) => (
                      <div
                        key={step}
                        className="flex items-center gap-2 rounded-xl border bg-card/80 p-3"
                      >
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                          {index + 1}
                        </span>
                        <span>{step}</span>
                      </div>
                    ),
                  )}
                </div>
              )}

              <Button asChild className="mt-7">
                <Link to={isTenant ? "/cabinet" : "/agreements"}>
                  {isTenant ? "Перейти в мой кабинет" : "Создать договор"}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

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
            <SelectItem value="partial">Частично оплачено</SelectItem>
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

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="h-10 justify-between px-3 font-normal">
              <span className="truncate">
                {propertyFilters.length === 0
                  ? "Все объекты"
                  : propertyFilters.length === 1
                    ? ((properties.data ?? []).find(
                        (property) => property.id === propertyFilters[0],
                      )?.name ?? "1 объект")
                    : `Выбрано объектов: ${propertyFilters.length}`}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-2">
            <p className="px-2 pb-2 text-xs text-muted-foreground">
              Выберите один или несколько объектов
            </p>
            <label className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted">
              <Checkbox
                checked={propertyFilters.length === 0}
                onCheckedChange={() => setPropertyFilters([])}
              />
              Все объекты
            </label>
            <div className="max-h-64 overflow-y-auto">
              {(properties.data ?? []).map((property) => {
                const checked = propertyFilters.includes(property.id);
                return (
                  <label
                    key={property.id}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() =>
                        setPropertyFilters((current) =>
                          checked
                            ? current.filter((id) => id !== property.id)
                            : [...current, property.id],
                        )
                      }
                    />
                    <span className="truncate">{property.name}</span>
                  </label>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>

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

      {!loading && !failed && canReviewPaymentReports && (
        <PaymentReportsPanel
          reports={paymentReports.data?.reports ?? []}
          tenantName={(tenantId) =>
            tenants.data?.find((tenant) => tenant.id === tenantId)?.name ?? "Арендатор"
          }
          propertyName={(chargeId) => {
            const charge = allCharges.find((item) => item.id === chargeId);
            return charge ? (propertyFor(charge)?.name ?? "Объект аренды") : "Объект аренды";
          }}
          reviewingId={reviewReport.isPending ? reviewReport.variables?.reportId : null}
          onReceipt={(path) =>
            void downloadFile(PAYMENT_RECEIPTS, path, "Чек-оплаты").catch((error: Error) =>
              toast.error(error.message),
            )
          }
          onReview={(reportId, approve, reviewNote) =>
            reviewReport.mutate({
              reportId,
              approve,
              ...(reviewNote !== undefined ? { reviewNote } : {}),
            })
          }
        />
      )}

      {!loading && !failed && role !== "tenant" && (
        <DebtCenter
          groups={debtGroups}
          onPay={openDebtPayment}
          onRemind={(agreementId) => sendReminder.mutate(agreementId)}
          onRemindAll={(agreementIds) => sendAllReminders.mutate(agreementIds)}
          remindingAgreementId={sendReminder.isPending ? sendReminder.variables : null}
          remindingAll={sendAllReminders.isPending}
        />
      )}

      {paymentReports.data?.available === false && canReviewPaymentReports && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Подтверждение оплат арендаторов появится после применения последней миграции Supabase.
        </p>
      )}

      {adjustmentEvents.data?.available === false && role !== "tenant" && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Корректировки начислений появятся после применения последней миграции Supabase. Остальные
          операции с платежами доступны.
        </p>
      )}

      {payments.data?.available === false && role !== "tenant" && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Частичные оплаты и история платежей появятся после применения последней миграции Supabase.
          До этого работает прежняя отметка полной оплаты.
        </p>
      )}

      {payments.data?.available === true && !receiptFeatureAvailable && role !== "tenant" && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Прикрепление чеков появится после применения последней миграции Supabase.
        </p>
      )}

      {!loading && !failed && visibleCharges.length > 0 && (
        <Card className="mt-4">
          <CardContent className="p-5 md:p-6">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">Итоги выбранного периода</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Показатели учитывают все активные фильтры
                </p>
              </div>
              <span className="rounded-full bg-accent px-3 py-1 text-sm font-medium">
                {visibleCharges.length} начислений
              </span>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-sm text-muted-foreground">Начислено</p>
                <p className="mt-1 text-xl font-semibold">{formatMoney(filteredSummary.accrued)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Оплачено</p>
                <p className="mt-1 text-xl font-semibold text-success">
                  {formatMoney(filteredSummary.paid)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Не оплачено</p>
                <p className="mt-1 text-xl font-semibold">{formatMoney(filteredSummary.unpaid)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Собираемость</p>
                <p className="mt-1 text-xl font-semibold">{filteredSummary.collectionRate}%</p>
              </div>
            </div>

            <PaymentAnalyticsCharts
              months={filteredSummary.months}
              properties={filteredSummary.properties}
            />
          </CardContent>
        </Card>
      )}

      {!loading && !failed && role !== "tenant" && (
        <RentForecastPanel
          {...rentForecast}
          horizonMonths={forecastHorizon}
          onHorizonChange={setForecastHorizon}
        />
      )}

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
            const chargeAdjustmentEvents = adjustmentEventsFor(charge);
            const chargePayments = paymentsByCharge.get(charge.id) ?? [];
            const hasAdjustment = Number(charge.adjustment_amount ?? 0) !== 0;
            const paidAmount = Number(
              charge.paid_amount ?? (charge.paid_at ? getRentChargeTotal(charge) : 0),
            );
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
                    {charge.adjustment_reason && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Корректировка: {charge.adjustment_reason}
                      </p>
                    )}
                    {chargePayments.length > 0 && (
                      <details className="mt-2 text-xs text-muted-foreground">
                        <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-foreground">
                          <History className="h-3.5 w-3.5" /> История платежей (
                          {chargePayments.length})
                        </summary>
                        <div className="mt-2 space-y-2 border-l pl-3">
                          {chargePayments.map((payment) => (
                            <div key={payment.id}>
                              <p className="font-medium text-foreground">
                                {formatMoney(payment.amount)} · {formatDate(payment.paid_at)}
                              </p>
                              {payment.note && <p>{payment.note}</p>}
                              {payment.receipt_file && (
                                <button
                                  type="button"
                                  className="mt-1 inline-flex items-center gap-1 font-medium text-primary hover:underline"
                                  onClick={() => openReceipt(payment)}
                                >
                                  <Paperclip className="h-3.5 w-3.5" /> Открыть чек
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                    {chargeAdjustmentEvents.length > 0 && (
                      <details className="mt-2 text-xs text-muted-foreground">
                        <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-foreground">
                          <History className="h-3.5 w-3.5" /> История корректировок (
                          {chargeAdjustmentEvents.length})
                        </summary>
                        <div className="mt-2 space-y-2 border-l pl-3">
                          {chargeAdjustmentEvents.map((event) => (
                            <div key={event.id}>
                              <p>
                                {formatMoney(event.previous_adjustment_amount)} →{" "}
                                {formatMoney(event.adjustment_amount)}
                              </p>
                              <p>{event.reason}</p>
                              <p>{formatDateTime(event.created_at)}</p>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-3 md:flex-col md:items-end">
                    <div className="text-right">
                      <p className="text-lg font-semibold">
                        {formatMoney(getRentChargeTotal(charge))}
                      </p>
                      {hasAdjustment && (
                        <p className="text-xs text-muted-foreground">
                          {formatMoney(charge.amount)}{" "}
                          {Number(charge.adjustment_amount) > 0 ? "+" : "−"}{" "}
                          {formatMoney(Math.abs(Number(charge.adjustment_amount)))}
                        </p>
                      )}
                      {paidAmount > 0 && !charge.paid_at && (
                        <p className="text-xs text-muted-foreground">
                          Внесено {formatMoney(paidAmount)} · осталось{" "}
                          {formatMoney(getRentChargeBalance(charge))}
                        </p>
                      )}
                    </div>
                    {role !== "tenant" && (
                      <div className="flex flex-wrap justify-end gap-2">
                        {paidAmount === 0 && adjustmentFeatureAvailable && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openAdjustmentDialog(charge)}
                          >
                            <PencilLine className="h-4 w-4" /> Корректировать
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openPaymentDialog(charge)}
                        >
                          {charge.paid_at ? "История оплат" : "Добавить оплату"}
                        </Button>
                      </div>
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
            <DialogTitle>Платежи по начислению</DialogTitle>
            <DialogDescription>
              {selectedCharge
                ? `${formatMonth(selectedCharge.period_start)} · осталось ${formatMoney(getRentChargeBalance(selectedCharge))}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {selectedCharge && getRentChargeBalance(selectedCharge) > 0 && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="payment-amount">Сумма, ₽</Label>
                    <Input
                      id="payment-amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      value={paymentAmount}
                      onChange={(event) => setPaymentAmount(event.target.value)}
                    />
                  </div>
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
                {receiptFeatureAvailable && (
                  <div className="space-y-1.5">
                    <Label htmlFor="payment-receipt">Чек или подтверждение, необязательно</Label>
                    <Input
                      id="payment-receipt"
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      onChange={(event) => setPaymentReceipt(event.target.files?.[0] ?? null)}
                    />
                    <p className="text-xs text-muted-foreground">PDF, JPG, PNG или WebP до 10 МБ</p>
                  </div>
                )}
              </>
            )}

            {selectedCharge && (paymentsByCharge.get(selectedCharge.id) ?? []).length > 0 && (
              <div className="space-y-2 border-t pt-4">
                <p className="text-sm font-medium">История поступлений</p>
                {(paymentsByCharge.get(selectedCharge.id) ?? []).map((payment) => (
                  <div
                    key={payment.id}
                    className="flex items-start justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {formatMoney(payment.amount)} · {formatDate(payment.paid_at)}
                      </p>
                      {payment.note && (
                        <p className="mt-1 text-xs text-muted-foreground">{payment.note}</p>
                      )}
                      {payment.receipt_file && (
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto px-0 py-1"
                          onClick={() => openReceipt(payment)}
                        >
                          <Paperclip className="h-4 w-4" /> Открыть чек
                        </Button>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      aria-label="Удалить платёж"
                      disabled={deletePayment.isPending}
                      onClick={() => setDeletingPaymentId(payment.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedCharge(null)}>
              Закрыть
            </Button>
            {selectedCharge && getRentChargeBalance(selectedCharge) > 0 && (
              <Button
                onClick={() => savePayment.mutate()}
                disabled={savePayment.isPending || !paidDate || !paymentAmount}
              >
                {savePayment.isPending ? "Сохраняем…" : "Добавить платёж"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deletingPaymentId)}
        onOpenChange={(open) => !open && setDeletingPaymentId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить платёж?</AlertDialogTitle>
            <AlertDialogDescription>
              Оплаченная сумма и остаток по начислению будут пересчитаны автоматически.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletePayment.isPending}
              onClick={() => deletePayment.mutate(deletingPaymentId ?? undefined)}
            >
              {deletePayment.isPending ? "Удаляем…" : "Удалить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={Boolean(adjustmentCharge)}
        onOpenChange={(open) => !open && setAdjustmentCharge(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Корректировать начисление</DialogTitle>
            <DialogDescription>
              {adjustmentCharge
                ? `${formatMonth(adjustmentCharge.period_start)} · базовая сумма ${formatMoney(adjustmentCharge.amount)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="adjusted-total">Итоговая сумма, ₽</Label>
              <Input
                id="adjusted-total"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={adjustedTotal}
                onChange={(event) => setAdjustedTotal(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Базовая сумма договора останется неизменной; в отчётах будет использован итог.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adjustment-reason">Причина корректировки</Label>
              <Textarea
                id="adjustment-reason"
                value={adjustmentReason}
                onChange={(event) => setAdjustmentReason(event.target.value)}
                placeholder="Например, перерасчёт за простой отопления"
                maxLength={1000}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustmentCharge(null)}>
              Отмена
            </Button>
            <Button
              onClick={() => saveAdjustment.mutate()}
              disabled={
                saveAdjustment.isPending || !adjustedTotal.trim() || !adjustmentReason.trim()
              }
            >
              {saveAdjustment.isPending ? "Сохраняем…" : "Сохранить корректировку"}
            </Button>
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
