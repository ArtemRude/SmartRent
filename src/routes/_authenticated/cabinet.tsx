import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Building2,
  CalendarDays,
  CreditCard,
  Download,
  FileText,
  Inbox,
  MapPin,
  Paperclip,
  Ruler,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { AgreementStatusBadge } from "@/components/AgreementStatusBadge";
import { AgreementStatusHistory } from "@/components/AgreementStatusHistory";
import { NotificationsPreview } from "@/components/NotificationsPreview";
import { PaymentStatusBadge } from "@/components/PaymentStatusBadge";
import { StorageImage } from "@/components/StorageImage";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/auth-context";
import { supabase } from "@/integrations/supabase/client";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  getPaymentStatus,
  getRentChargeBalance,
  localDateKey,
  propertyTypeLabels,
} from "@/lib/domain";
import {
  fetchAgreements,
  fetchAgreementAcceptances,
  fetchAgreementStatusEvents,
  fetchMyTenantRecords,
  fetchPaymentReports,
  fetchProperties,
  fetchRentCharges,
  fetchUnits,
  type RentCharge,
} from "@/lib/queries";
import {
  downloadFile,
  LEASE_DOCUMENTS,
  PAYMENT_RECEIPTS,
  PROPERTY_PHOTOS,
  removeFile,
  uploadFile,
} from "@/lib/storage";

export const Route = createFileRoute("/_authenticated/cabinet")({
  head: () => ({ meta: [{ title: "Мой кабинет — Умная Аренда" }] }),
  component: CabinetPage,
});

function CabinetPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [reportCharge, setReportCharge] = useState<RentCharge | null>(null);
  const [reportAmount, setReportAmount] = useState("");
  const [reportDate, setReportDate] = useState(localDateKey());
  const [reportCash, setReportCash] = useState(false);
  const [reportReceipt, setReportReceipt] = useState<File | null>(null);
  const [reportNote, setReportNote] = useState("");
  const tenants = useQuery({
    queryKey: ["my-tenant-records", user?.id],
    queryFn: () => fetchMyTenantRecords(user!.id),
    enabled: Boolean(user),
  });
  const agreements = useQuery({
    queryKey: ["agreements", "tenant", user?.id],
    queryFn: fetchAgreements,
    enabled: Boolean(user),
  });
  const statusEvents = useQuery({
    queryKey: ["agreement-status-events", "tenant", user?.id],
    queryFn: fetchAgreementStatusEvents,
    enabled: Boolean(user),
  });
  const acceptances = useQuery({
    queryKey: ["agreement-acceptances", "tenant", user?.id],
    queryFn: fetchAgreementAcceptances,
    enabled: Boolean(user),
  });
  const properties = useQuery({
    queryKey: ["properties", "tenant", user?.id],
    queryFn: fetchProperties,
    enabled: Boolean(user),
  });
  const units = useQuery({
    queryKey: ["units", "tenant", user?.id],
    queryFn: fetchUnits,
    enabled: Boolean(user),
  });
  const charges = useQuery({
    queryKey: ["rent-charges", "tenant", user?.id],
    queryFn: fetchRentCharges,
    enabled: Boolean(user),
  });
  const paymentReports = useQuery({
    queryKey: ["payment-reports", "tenant", user?.id],
    queryFn: fetchPaymentReports,
    enabled: Boolean(user),
  });
  const acceptAgreement = useMutation({
    mutationFn: async ({
      agreementId,
      agreementVersion,
    }: {
      agreementId: string;
      agreementVersion: string;
    }) => {
      if (!user) throw new Error("Нет активной сессии");
      const { error } = await supabase.from("agreement_acceptances").insert({
        agreement_id: agreementId,
        agreement_version: agreementVersion,
        accepted_by: user.id,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Ознакомление с договором подтверждено");
      void qc.invalidateQueries({ queryKey: ["agreement-acceptances"] });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const reportPayment = useMutation({
    mutationFn: async () => {
      if (!user || !reportCharge) throw new Error("Начисление не выбрано");
      if (!reportDate) throw new Error("Укажите дату оплаты");
      if (reportDate > localDateKey()) throw new Error("Дата оплаты не может быть в будущем");
      const amount = Number(reportAmount.replace(",", "."));
      const balance = getRentChargeBalance(reportCharge);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Укажите сумму больше нуля");
      if (amount > balance) throw new Error(`Сумма больше остатка ${formatMoney(balance)}`);
      if (!reportCash && !reportReceipt) {
        throw new Error("Для банковского перевода обязательно приложите чек");
      }

      let receiptPath: string | null = null;
      try {
        if (!reportCash && reportReceipt) {
          receiptPath = await uploadFile(PAYMENT_RECEIPTS, user.id, reportReceipt);
        }
        const { error } = await supabase.from("payment_reports").insert({
          charge_id: reportCharge.id,
          owner_id: reportCharge.owner_id,
          tenant_id: reportCharge.tenant_id,
          amount,
          paid_at: new Date(`${reportDate}T12:00:00`).toISOString(),
          payment_method: reportCash ? "cash" : "bank_transfer",
          receipt_file: receiptPath,
          note: reportNote.trim() || null,
        });
        if (error?.code === "PGRST205" || error?.code === "42501") {
          throw new Error("Сообщение об оплате станет доступно после применения миграции Supabase");
        }
        if (error) throw new Error(error.message);
      } catch (error) {
        if (receiptPath) await removeFile(PAYMENT_RECEIPTS, receiptPath).catch(() => undefined);
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Сообщение об оплате отправлено собственнику");
      setReportCharge(null);
      setReportReceipt(null);
      void qc.invalidateQueries({ queryKey: ["payment-reports"] });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const queries = [
    tenants,
    agreements,
    statusEvents,
    acceptances,
    properties,
    units,
    charges,
    paymentReports,
  ];
  const loading = queries.some((query) => query.isPending);
  const failed = queries.some((query) => query.isError);
  const unpaidCharges = (charges.data ?? [])
    .filter((charge) => charge.paid_at == null)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const debt = unpaidCharges
    .filter((charge) => charge.due_date < localDateKey())
    .reduce((sum, charge) => sum + getRentChargeBalance(charge), 0);
  const pendingReportByCharge = new Map(
    (paymentReports.data?.reports ?? [])
      .filter((report) => report.status === "pending")
      .map((report) => [report.charge_id, report]),
  );

  const openPaymentReport = (charge: RentCharge) => {
    setReportCharge(charge);
    setReportAmount(String(getRentChargeBalance(charge)));
    setReportDate(localDateKey());
    setReportCash(false);
    setReportReceipt(null);
    setReportNote("");
  };

  return (
    <>
      <PageHeader title="Мой кабинет" description="Данные вашей аренды в одном месте" />
      {loading && <p className="text-sm text-muted-foreground">Загружаем кабинет…</p>}
      {failed && <p className="text-sm text-destructive">Не удалось загрузить данные кабинета.</p>}
      {!loading && !failed && (tenants.data?.length ?? 0) === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <Building2 className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium">Аренда пока не подключена</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Попросите собственника добавить вас с email, использованным при регистрации.
            </p>
          </CardContent>
        </Card>
      )}
      {!loading && !failed && (tenants.data?.length ?? 0) > 0 && (
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4" /> Мой объект
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {(agreements.data ?? []).map((agreement) => {
                const property = properties.data?.find((item) => item.id === agreement.property_id);
                const unit = units.data?.find((item) => item.id === agreement.unit_id);
                return (
                  <div
                    key={agreement.id}
                    className="grid overflow-hidden rounded-xl border sm:grid-cols-[180px_1fr]"
                  >
                    <StorageImage
                      bucket={PROPERTY_PHOTOS}
                      path={property?.photos[0]}
                      alt={property?.name ?? "Объект аренды"}
                      className="h-40 w-full sm:h-full"
                    />
                    <div className="p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">{property?.name ?? "Объект аренды"}</p>
                        <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs text-accent-foreground">
                          {property ? propertyTypeLabels[property.type] : "Недвижимость"}
                        </span>
                      </div>
                      <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                        {property?.address || "Адрес не указан"}
                      </p>
                      {unit && (
                        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                          <Ruler className="h-4 w-4" />
                          {unit.name}
                          {unit.area != null ? ` · ${unit.area} м²` : ""}
                        </p>
                      )}
                      {property?.description && (
                        <p className="mt-3 text-sm">{property.description}</p>
                      )}
                    </div>
                  </div>
                );
              })}
              {(agreements.data?.length ?? 0) === 0 && (
                <p className="text-sm text-muted-foreground">
                  Объект появится после добавления договора собственником.
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" /> Договоры
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(agreements.data ?? []).map((agreement) => {
                const property = properties.data?.find((item) => item.id === agreement.property_id);
                const unit = units.data?.find((item) => item.id === agreement.unit_id);
                const latestAcceptance = acceptances.data?.find(
                  (item) => item.agreement_id === agreement.id,
                );
                const currentAcceptance = acceptances.data?.find(
                  (item) =>
                    item.agreement_id === agreement.id &&
                    item.agreement_version === agreement.status_changed_at,
                );
                const visibleAcceptance =
                  agreement.status === "pending_signature" ? currentAcceptance : latestAcceptance;
                return (
                  <div key={agreement.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{property?.name ?? "Объект аренды"}</p>
                        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5" />
                          {property?.address || "Адрес не указан"}
                          {unit ? ` · ${unit.name}` : ""}
                        </p>
                      </div>
                      <AgreementStatusBadge status={agreement.status} />
                    </div>
                    <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                      <p className="flex items-center gap-2">
                        <CalendarDays className="h-4 w-4 text-muted-foreground" />
                        {formatDate(agreement.start_date)} — {formatDate(agreement.end_date)}
                      </p>
                      <p className="font-medium sm:text-right">
                        {formatMoney(agreement.monthly_payment)}/мес.
                      </p>
                      <p className="text-xs text-muted-foreground sm:col-span-2">
                        {agreement.payment_due_day
                          ? `Срок оплаты — до ${agreement.payment_due_day}-го числа каждого месяца`
                          : "Срок оплаты определяется датой начала аренды"}
                      </p>
                    </div>
                    {visibleAcceptance && (
                      <div className="mt-4 flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
                        <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                          <p className="font-medium">Вы подтвердили ознакомление с договором</p>
                          <p className="mt-0.5 text-xs text-emerald-700">
                            {formatDateTime(visibleAcceptance.accepted_at)}
                          </p>
                        </div>
                      </div>
                    )}
                    {agreement.status === "pending_signature" && !currentAcceptance && (
                      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <p className="text-sm font-medium text-amber-900">
                          Договор ожидает вашего подтверждения
                        </p>
                        <p className="mt-1 text-xs text-amber-800">
                          Сначала проверьте срок, сумму и приложенный PDF. Это подтверждение
                          ознакомления в сервисе и не заменяет юридическую подпись.
                        </p>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" className="mt-3">
                              <BadgeCheck className="mr-2 h-4 w-4" /> Подтвердить ознакомление
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Подтвердить ознакомление?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Вы подтверждаете, что ознакомились с условиями договора для объекта
                                «{property?.name ?? "Объект аренды"}». Отменить это действие нельзя.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Отмена</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() =>
                                  acceptAgreement.mutate({
                                    agreementId: agreement.id,
                                    agreementVersion: agreement.status_changed_at,
                                  })
                                }
                                disabled={acceptAgreement.isPending}
                              >
                                Подтвердить
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    )}
                    <div className="mt-4 border-t pt-4">
                      {agreement.signed_document_file || agreement.document_file ? (
                        <div className="flex flex-wrap gap-2">
                          {agreement.signed_document_file && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                void downloadFile(
                                  LEASE_DOCUMENTS,
                                  agreement.signed_document_file!,
                                  `Подписанный-договор-${property?.name ?? agreement.id}.pdf`,
                                ).catch((error: Error) => toast.error(error.message))
                              }
                            >
                              <Download className="mr-2 h-4 w-4" /> Скачать подписанный договор
                            </Button>
                          )}
                          {agreement.document_file && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                void downloadFile(
                                  LEASE_DOCUMENTS,
                                  agreement.document_file!,
                                  `Договор-${property?.name ?? agreement.id}.pdf`,
                                ).catch((error: Error) => toast.error(error.message))
                              }
                            >
                              <Download className="mr-2 h-4 w-4" /> Исходный PDF
                            </Button>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Собственник ещё не загрузил файл договора.
                        </p>
                      )}
                    </div>
                    <AgreementStatusHistory
                      agreementId={agreement.id}
                      ownerId={agreement.owner_id}
                      currentUserId={user?.id}
                      events={statusEvents.data ?? []}
                      isPending={statusEvents.isPending}
                      isError={statusEvents.isError}
                    />
                  </div>
                );
              })}
              {(agreements.data?.length ?? 0) === 0 && (
                <p className="text-sm text-muted-foreground">
                  Профиль подключён, но собственник ещё не добавил договор.
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="h-4 w-4" /> Платежи
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-sm text-muted-foreground">Текущая задолженность</p>
                  <p className="text-2xl font-semibold">{formatMoney(debt)}</p>
                </div>
                <Button asChild variant="outline">
                  <Link to="/payments">Все платежи</Link>
                </Button>
              </div>
              <div className="space-y-2">
                {unpaidCharges.map((charge) => {
                  const agreement = agreements.data?.find(
                    (item) => item.id === charge.agreement_id,
                  );
                  const property = properties.data?.find(
                    (item) => item.id === agreement?.property_id,
                  );
                  return (
                    <div key={charge.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-medium">{property?.name ?? "Объект аренды"}</p>
                          <p className="text-xs text-muted-foreground">
                            Оплатить до {formatDate(charge.due_date)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium">{formatMoney(getRentChargeBalance(charge))}</p>
                          <PaymentStatusBadge status={getPaymentStatus(charge)} />
                        </div>
                      </div>
                      <div className="mt-3 border-t pt-3">
                        {pendingReportByCharge.has(charge.id) ? (
                          <p className="text-xs font-medium text-amber-700">
                            Оплата отправлена собственнику и ожидает подтверждения
                          </p>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={paymentReports.data?.available === false}
                            onClick={() => openPaymentReport(charge)}
                          >
                            Сообщить об оплате
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {unpaidCharges.length === 0 && (
                  <p className="text-sm text-muted-foreground">Нет ожидающих платежей.</p>
                )}
              </div>
              {paymentReports.data?.available === false && (
                <p className="mt-3 text-xs text-amber-700">
                  Сообщения об оплате появятся после применения последней миграции Supabase.
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Inbox className="h-4 w-4" /> Заявки
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Сообщите собственнику о ремонте, оплате или задайте вопрос по аренде.
              </p>
              <Button asChild className="mt-4">
                <Link to="/requests">Открыть заявки</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
      <NotificationsPreview className="mt-6" />

      <Dialog open={Boolean(reportCharge)} onOpenChange={(open) => !open && setReportCharge(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Сообщить об оплате</DialogTitle>
            <DialogDescription>
              Собственник проверит данные и подтвердит платёж. До подтверждения задолженность не
              изменится.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="reported-payment-amount">Сумма</Label>
              <Input
                id="reported-payment-amount"
                inputMode="decimal"
                value={reportAmount}
                onChange={(event) => setReportAmount(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reported-payment-date">Дата оплаты</Label>
              <Input
                id="reported-payment-date"
                type="date"
                max={localDateKey()}
                value={reportDate}
                onChange={(event) => setReportDate(event.target.value)}
              />
            </div>
            <label className="flex items-start gap-3 rounded-lg border p-3 sm:col-span-2">
              <Checkbox
                checked={reportCash}
                onCheckedChange={(checked) => setReportCash(checked === true)}
              />
              <span>
                <span className="block text-sm font-medium">Оплата передана наличными</span>
                <span className="block text-xs text-muted-foreground">
                  Для наличной оплаты чек из банка не требуется
                </span>
              </span>
            </label>
            {!reportCash && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="reported-payment-receipt">Чек банковского перевода *</Label>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-3 text-sm hover:bg-muted/40">
                  <Paperclip className="h-4 w-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {reportReceipt?.name ?? "Выберите PDF, JPG, PNG или WebP до 10 МБ"}
                  </span>
                  <Input
                    id="reported-payment-receipt"
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(event) => setReportReceipt(event.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            )}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="reported-payment-note">Комментарий</Label>
              <Textarea
                id="reported-payment-note"
                maxLength={1000}
                value={reportNote}
                placeholder="Необязательно"
                onChange={(event) => setReportNote(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportCharge(null)}>
              Отмена
            </Button>
            <Button disabled={reportPayment.isPending} onClick={() => reportPayment.mutate()}>
              Отправить собственнику
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
