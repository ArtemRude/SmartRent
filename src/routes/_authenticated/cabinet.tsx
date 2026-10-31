import { rentAt } from "@/lib/lease-changes";
import {
  fetchSearchAgreement,
  isSearchRecordId,
  mergeSelectedRecord,
  scrollToSearchRecord,
} from "@/lib/search-record-queries";
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Building2,
  CalendarDays,
  ChevronDown,
  CreditCard,
  Download,
  FileText,
  History,
  ImagePlus,
  Inbox,
  MapPin,
  Paperclip,
  RotateCcw,
  Ruler,
  Send,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { AgreementStatusBadge } from "@/components/AgreementStatusBadge";
import { AgreementStatusHistory } from "@/components/AgreementStatusHistory";
import { FileUploadField } from "@/components/FileUploadField";
import { NotificationsPreview } from "@/components/NotificationsPreview";
import { PaymentStatusBadge } from "@/components/PaymentStatusBadge";
import { PaymentReportStatusBadge } from "@/components/PaymentReportStatusBadge";
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
import { readAgreementContractDetails } from "@/lib/agreement-document";
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
  cancelPaymentReport,
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
  AGREEMENT_INVENTORY_PHOTOS,
  downloadFile,
  LEASE_DOCUMENTS,
  PAYMENT_RECEIPTS,
  PROPERTY_PHOTOS,
  removeFile,
  uploadFile,
} from "@/lib/storage";

export const Route = createFileRoute("/_authenticated/cabinet")({
  validateSearch: (search: Record<string, unknown>): { agreementId?: string } =>
    typeof search["agreementId"] === "string" ? { agreementId: search["agreementId"] } : {},
  head: () => ({ meta: [{ title: "Мой кабинет — SmartRent" }] }),
  component: CabinetPage,
});

function CabinetPage() {
  const { agreementId } = Route.useSearch();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [reportCharge, setReportCharge] = useState<RentCharge | null>(null);
  const [reportAmount, setReportAmount] = useState("");
  const [reportDate, setReportDate] = useState(localDateKey());
  const [reportCash, setReportCash] = useState(false);
  const [reportReceipt, setReportReceipt] = useState<File | null>(null);
  const [reportNote, setReportNote] = useState("");
  const [reportHistoryExpanded, setReportHistoryExpanded] = useState(false);
  const [signedAgreementFiles, setSignedAgreementFiles] = useState<Record<string, File | null>>({});
  const [inventoryPhotoFiles, setInventoryPhotoFiles] = useState<Record<string, File[]>>({});
  const tenants = useQuery({
    queryKey: ["my-tenant-records", user?.id],
    queryFn: () => fetchMyTenantRecords(user!.id),
    enabled: Boolean(user),
  });
  const agreementList = useQuery({
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
  const propertyList = useQuery({
    queryKey: ["properties", "tenant", user?.id],
    queryFn: fetchProperties,
    enabled: Boolean(user),
  });
  const unitList = useQuery({
    queryKey: ["units", "tenant", user?.id],
    queryFn: fetchUnits,
    enabled: Boolean(user),
  });
  const selectedAgreement = useQuery({
    queryKey: ["agreements", "search-record", user?.id, agreementId],
    queryFn: ({ signal }) => fetchSearchAgreement(agreementId!, signal),
    enabled: Boolean(user && isSearchRecordId(agreementId)),
    retry: false,
    refetchInterval: 5000,
  });
  const exact =
    selectedAgreement.isSuccess && !selectedAgreement.isError ? selectedAgreement.data : null;
  const agreements = {
    ...agreementList,
    data: mergeSelectedRecord(agreementList.data, agreementId, exact?.agreement),
  };
  const properties = {
    ...propertyList,
    data: mergeSelectedRecord(propertyList.data, exact?.property?.id, exact?.property),
  };
  const units = {
    ...unitList,
    data: mergeSelectedRecord(unitList.data, exact?.unit?.id, exact?.unit),
  };
  const exactAgreementId = exact?.agreement.id;
  useEffect(() => {
    if (agreementId && exactAgreementId === agreementId)
      scrollToSearchRecord(`agreement-${agreementId}`);
  }, [agreementId, exactAgreementId]);
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
  const signAgreement = useMutation({
    mutationFn: async ({
      agreementId,
      agreementVersion,
      document,
      photos,
    }: {
      agreementId: string;
      agreementVersion: string;
      document: File;
      photos: File[];
    }) => {
      if (!user) throw new Error("Нет активной сессии");
      if (photos.length > 6) throw new Error("Можно приложить не более 6 фотографий");

      let documentPath: string | null = null;
      const photoPaths: string[] = [];
      try {
        documentPath = await uploadFile(LEASE_DOCUMENTS, `${user.id}/${agreementId}`, document);
        for (const photo of photos) {
          photoPaths.push(
            await uploadFile(AGREEMENT_INVENTORY_PHOTOS, `${user.id}/${agreementId}`, photo),
          );
        }
        const { data: previousPath, error } = await supabase.rpc("submit_tenant_agreement", {
          p_agreement_id: agreementId,
          p_agreement_version: agreementVersion,
          p_document_path: documentPath,
          p_photo_paths: photoPaths,
        });
        if (error) throw new Error(error.message);
        return { agreementId, previousPath };
      } catch (error) {
        if (documentPath) await removeFile(LEASE_DOCUMENTS, documentPath).catch(() => undefined);
        await Promise.all(
          photoPaths.map((path) =>
            removeFile(AGREEMENT_INVENTORY_PHOTOS, path).catch(() => undefined),
          ),
        );
        throw error;
      }
    },
    onSuccess: ({ agreementId, previousPath }) => {
      toast.success("Договор подписан и отправлен собственнику");
      setSignedAgreementFiles((current) => ({ ...current, [agreementId]: null }));
      setInventoryPhotoFiles((current) => ({ ...current, [agreementId]: [] }));
      if (previousPath) void removeFile(LEASE_DOCUMENTS, previousPath).catch(() => undefined);
      void qc.invalidateQueries({ queryKey: ["agreements"] });
      void qc.invalidateQueries({ queryKey: ["agreement-acceptances"] });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const submitSignedAgreement = useMutation({
    mutationFn: async ({ agreementId, file }: { agreementId: string; file: File }) => {
      if (!user) throw new Error("Нет активной сессии");
      let uploadedPath: string | null = null;
      try {
        uploadedPath = await uploadFile(LEASE_DOCUMENTS, `${user.id}/${agreementId}`, file);
        const { data: previousPath, error } = await supabase.rpc("submit_signed_agreement", {
          p_agreement_id: agreementId,
          p_document_path: uploadedPath,
        });
        if (error) throw new Error(error.message);
        return { agreementId, previousPath };
      } catch (error) {
        if (uploadedPath) await removeFile(LEASE_DOCUMENTS, uploadedPath).catch(() => undefined);
        throw error;
      }
    },
    onSuccess: ({ agreementId, previousPath }) => {
      toast.success("Подписанный договор отправлен собственнику");
      setSignedAgreementFiles((current) => ({ ...current, [agreementId]: null }));
      if (previousPath) {
        void removeFile(LEASE_DOCUMENTS, previousPath).catch(() => undefined);
      }
      void qc.invalidateQueries({ queryKey: ["agreements"] });
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
          throw new Error("Сообщения об оплате временно недоступны");
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
  const cancelReport = useMutation({
    mutationFn: cancelPaymentReport,
    onSuccess: () => {
      toast.success("Сообщение об оплате отменено");
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
  const allPaymentReports = paymentReports.data?.reports ?? [];
  const visiblePaymentReports = reportHistoryExpanded
    ? allPaymentReports
    : allPaymentReports.slice(0, 5);

  const openPaymentReport = (charge: RentCharge) => {
    setReportCharge(charge);
    setReportAmount(String(getRentChargeBalance(charge)));
    setReportDate(localDateKey());
    setReportCash(false);
    setReportReceipt(null);
    setReportNote("");
  };

  const addInventoryPhotos = (agreementId: string, files: FileList | null) => {
    if (!files?.length) return;
    const selected = Array.from(files);
    setInventoryPhotoFiles((current) => {
      const existing = current[agreementId] ?? [];
      const next = [...existing, ...selected].slice(0, 6);
      if (existing.length + selected.length > 6) {
        toast.warning("Можно приложить не более 6 фотографий");
      }
      return { ...current, [agreementId]: next };
    });
  };

  return (
    <>
      <PageHeader title="Мой кабинет" description="Данные вашей аренды в одном месте" />
      {agreementId && (
        <p
          role={selectedAgreement.isPending && isSearchRecordId(agreementId) ? "status" : "alert"}
          className="mb-4 text-sm text-muted-foreground"
        >
          {selectedAgreement.isPending && isSearchRecordId(agreementId)
            ? "Загружаем выбранный договор…"
            : !exact
              ? "Выбранный договор недоступен: он удалён или доступ изменился."
              : "Найденный договор выделен ниже."}
        </p>
      )}
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
                const acceptancePhotos = visibleAcceptance?.photos ?? [];
                const inventoryItems =
                  readAgreementContractDetails(agreement.contract_details).inventoryItems ?? [];
                const selectedPhotos = inventoryPhotoFiles[agreement.id] ?? [];
                return (
                  <div
                    key={agreement.id}
                    id={`agreement-${agreement.id}`}
                    data-testid="cabinet-agreement"
                    className={`rounded-xl border p-4 ${agreementId === agreement.id ? "border-primary/50 ring-2 ring-primary/20" : ""}`}
                  >
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
                      <Button asChild variant="outline" size="sm">
                        <Link to="/lease-changes" search={{ agreement: agreement.id }}>
                          Изменения условий
                        </Link>
                      </Button>
                      <p className="font-medium sm:text-right">
                        {formatMoney(rentAt(agreement, localDateKey()))}/мес.
                      </p>
                      <p className="text-xs text-muted-foreground sm:col-span-2">
                        {agreement.payment_due_day
                          ? `Срок оплаты — до ${agreement.payment_due_day}-го числа каждого месяца`
                          : "Срок оплаты определяется датой начала аренды"}
                      </p>
                    </div>
                    {inventoryItems.length > 0 && (
                      <div className="mt-4 rounded-xl border bg-muted/30 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">Передаваемое имущество</p>
                          <span className="text-xs text-muted-foreground">
                            {inventoryItems.length} поз.
                          </span>
                        </div>
                        <div className="mt-3 divide-y rounded-lg border bg-background">
                          {inventoryItems.map((item, index) => (
                            <div
                              key={`${item.name}-${index}`}
                              className="grid gap-1 px-3 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,0.7fr)] sm:gap-4"
                            >
                              <span className="font-medium">
                                {index + 1}. {item.name}
                              </span>
                              <span className="text-muted-foreground">
                                {item.quantity || "Количество не указано"}
                              </span>
                              <span className="text-muted-foreground sm:text-right">
                                {item.condition || "Состояние не указано"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {(agreement.status === "active" || agreement.status === "completed") && (
                      <Button variant="outline" size="sm" asChild className="mt-4 mr-2">
                        <Link to="/handover" search={{ agreement: agreement.id }}>
                          Заселение и выезд
                        </Link>
                      </Button>
                    )}
                    {agreement.status === "active" && (
                      <Button variant="outline" size="sm" asChild className="mt-4">
                        <Link to="/utilities" search={{ agreement: agreement.id }}>
                          Передать показания счётчиков
                        </Link>
                      </Button>
                    )}
                    {agreement.status === "pending_signature" && !currentAcceptance && (
                      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                        <p className="text-sm font-medium text-amber-900">
                          Подпишите договор и отправьте собственнику
                        </p>
                        <p className="mt-1 text-xs text-amber-800">
                          Одним действием вы подтверждаете условия договора
                          {inventoryItems.length > 0 ? " и получение перечисленного имущества" : ""}
                          . Дата подписания будет зафиксирована автоматически.
                        </p>
                        <FileUploadField
                          id={`tenant-signed-agreement-${agreement.id}`}
                          className="mt-3 bg-background"
                          accept="application/pdf"
                          file={signedAgreementFiles[agreement.id] ?? null}
                          description="Подписанный договор в PDF до 20 МБ"
                          disabled={signAgreement.isPending}
                          onFileChange={(file) =>
                            setSignedAgreementFiles((current) => ({
                              ...current,
                              [agreement.id]: file,
                            }))
                          }
                        />
                        <div className="mt-3 rounded-lg border border-dashed border-amber-300 bg-background/70 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                Фотографии имущества
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Необязательно · до 6 изображений по 8 МБ
                              </p>
                            </div>
                            <Label
                              htmlFor={`inventory-photos-${agreement.id}`}
                              className="inline-flex h-9 cursor-pointer items-center rounded-md border bg-background px-3 text-sm font-medium shadow-xs hover:bg-muted"
                            >
                              <ImagePlus className="mr-2 h-4 w-4" /> Добавить фото
                            </Label>
                            <Input
                              id={`inventory-photos-${agreement.id}`}
                              type="file"
                              accept="image/jpeg,image/png,image/webp,image/gif"
                              multiple
                              className="sr-only"
                              disabled={signAgreement.isPending || selectedPhotos.length >= 6}
                              onChange={(event) => {
                                addInventoryPhotos(agreement.id, event.target.files);
                                event.target.value = "";
                              }}
                            />
                          </div>
                          {selectedPhotos.length > 0 && (
                            <div className="mt-3 space-y-2">
                              {selectedPhotos.map((file, index) => (
                                <div
                                  key={`${file.name}-${file.lastModified}-${index}`}
                                  className="flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs"
                                >
                                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 shrink-0"
                                    aria-label={`Удалить фото ${file.name}`}
                                    onClick={() =>
                                      setInventoryPhotoFiles((current) => ({
                                        ...current,
                                        [agreement.id]: (current[agreement.id] ?? []).filter(
                                          (_, photoIndex) => photoIndex !== index,
                                        ),
                                      }))
                                    }
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              className="mt-3"
                              disabled={
                                !signedAgreementFiles[agreement.id] || signAgreement.isPending
                              }
                            >
                              <Send className="mr-2 h-4 w-4" /> Подписать и отправить
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Подписать договор?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Вы подтверждаете условия договора для объекта «
                                {property?.name ?? "Объект аренды"}»
                                {inventoryItems.length > 0
                                  ? ` и получение имущества (${inventoryItems.length} поз.)`
                                  : ""}
                                . Подписанный PDF
                                {selectedPhotos.length > 0
                                  ? ` и фотографии (${selectedPhotos.length})`
                                  : ""}{" "}
                                будут отправлены собственнику. Отменить подтверждение нельзя.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Отмена</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => {
                                  const document = signedAgreementFiles[agreement.id];
                                  if (document) {
                                    signAgreement.mutate({
                                      agreementId: agreement.id,
                                      agreementVersion: agreement.status_changed_at,
                                      document,
                                      photos: selectedPhotos,
                                    });
                                  }
                                }}
                                disabled={signAgreement.isPending}
                              >
                                {signAgreement.isPending &&
                                signAgreement.variables?.agreementId === agreement.id
                                  ? "Отправляем…"
                                  : "Подписать и отправить"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    )}
                    {agreement.status === "pending_signature" &&
                      currentAcceptance &&
                      !agreement.signed_document_file && (
                        <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
                          <div className="flex items-start gap-2 text-sm">
                            <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                            <div>
                              <p className="font-medium">Подписание уже подтверждено</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                Осталось отправить собственнику подписанный PDF-файл.
                              </p>
                            </div>
                          </div>
                          <FileUploadField
                            id={`tenant-signed-agreement-legacy-${agreement.id}`}
                            className="mt-3 bg-background"
                            accept="application/pdf"
                            file={signedAgreementFiles[agreement.id] ?? null}
                            description="Подписанный договор в PDF до 20 МБ"
                            disabled={
                              submitSignedAgreement.isPending &&
                              submitSignedAgreement.variables?.agreementId === agreement.id
                            }
                            onFileChange={(file) =>
                              setSignedAgreementFiles((current) => ({
                                ...current,
                                [agreement.id]: file,
                              }))
                            }
                          />
                          <Button
                            size="sm"
                            className="mt-3"
                            disabled={
                              !signedAgreementFiles[agreement.id] || submitSignedAgreement.isPending
                            }
                            onClick={() => {
                              const file = signedAgreementFiles[agreement.id];
                              if (file)
                                submitSignedAgreement.mutate({ agreementId: agreement.id, file });
                            }}
                          >
                            <Send className="mr-2 h-4 w-4" />
                            {submitSignedAgreement.isPending &&
                            submitSignedAgreement.variables?.agreementId === agreement.id
                              ? "Отправляем…"
                              : "Отправить собственнику"}
                          </Button>
                        </div>
                      )}
                    {visibleAcceptance &&
                      (agreement.status !== "pending_signature" ||
                        agreement.signed_document_file) && (
                        <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                          <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" />
                          <div>
                            <p className="font-medium">
                              {agreement.signed_document_file
                                ? "Подписанный договор отправлен"
                                : "Договор подтверждён"}
                            </p>
                            <p className="mt-0.5 text-xs text-emerald-700">
                              Подписано {formatDateTime(visibleAcceptance.accepted_at)}
                              {inventoryItems.length > 0
                                ? " · получение имущества подтверждено"
                                : ""}
                            </p>
                            {agreement.status === "pending_signature" && (
                              <p className="mt-1 text-xs text-emerald-700">
                                Собственник проверит файл и активирует договор.
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    {acceptancePhotos.length > 0 && (
                      <div className="mt-4">
                        <p className="mb-2 text-sm font-medium">
                          Фотографии к акту · {acceptancePhotos.length}
                        </p>
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                          {acceptancePhotos.map((photo, index) => (
                            <StorageImage
                              key={photo}
                              bucket={AGREEMENT_INVENTORY_PHOTOS}
                              path={photo}
                              alt={`Имущество, фото ${index + 1}`}
                              className="aspect-square w-full rounded-lg border"
                            />
                          ))}
                        </div>
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
                            {charge.charge_type === "utilities" ? "Коммунальные услуги" : "Аренда"}{" "}
                            · Оплатить до {formatDate(charge.due_date)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium">{formatMoney(getRentChargeBalance(charge))}</p>
                          <PaymentStatusBadge status={getPaymentStatus(charge)} />
                        </div>
                      </div>
                      <div className="mt-3 border-t pt-3">
                        {charge.charge_type === "utilities" && (
                          <Link
                            to="/utilities"
                            search={{ agreement: charge.agreement_id }}
                            className="mb-2 block text-xs text-primary hover:underline"
                          >
                            Посмотреть показания и расчёт
                          </Link>
                        )}
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
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-amber-700">
                  <span>Сообщения об оплате временно недоступны.</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    disabled={paymentReports.isFetching}
                    onClick={() => void paymentReports.refetch()}
                  >
                    <RotateCcw
                      className={`h-3.5 w-3.5 ${paymentReports.isFetching ? "animate-spin" : ""}`}
                    />
                    Проверить снова
                  </Button>
                </div>
              )}
              {visiblePaymentReports.length > 0 && (
                <div className="mt-5 border-t pt-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <History className="h-4 w-4" /> История сообщений об оплате
                  </h3>
                  <div className="mt-3 space-y-2">
                    {visiblePaymentReports.map((report) => {
                      const charge = charges.data?.find((item) => item.id === report.charge_id);
                      const agreement = agreements.data?.find(
                        (item) => item.id === charge?.agreement_id,
                      );
                      const property = properties.data?.find(
                        (item) => item.id === agreement?.property_id,
                      );
                      return (
                        <div key={report.id} className="rounded-lg bg-muted/50 p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium">
                                {property?.name ?? "Объект аренды"}
                              </p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {formatMoney(report.amount)} · {formatDate(report.paid_at)} ·{" "}
                                {report.payment_method === "cash"
                                  ? "наличными"
                                  : "банковский перевод"}
                              </p>
                            </div>
                            <PaymentReportStatusBadge status={report.status} />
                          </div>
                          {report.review_note && (
                            <p className="mt-2 text-xs">Причина: {report.review_note}</p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs text-muted-foreground">
                              {report.cancelled_at
                                ? `Отменено: ${formatDateTime(report.cancelled_at)}`
                                : report.reviewed_at
                                  ? `Решение: ${formatDateTime(report.reviewed_at)}`
                                  : `Отправлено: ${formatDateTime(report.created_at)}`}
                            </p>
                            <div className="flex flex-wrap items-center gap-1">
                              {report.receipt_file && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    void downloadFile(
                                      PAYMENT_RECEIPTS,
                                      report.receipt_file!,
                                      "Чек-оплаты",
                                    ).catch((error: Error) => toast.error(error.message))
                                  }
                                >
                                  <Download className="h-4 w-4" /> Чек
                                </Button>
                              )}
                              {report.status === "pending" && (
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      disabled={cancelReport.isPending}
                                    >
                                      Отменить
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>
                                        Отменить сообщение об оплате?
                                      </AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Собственник больше не сможет подтвердить это сообщение. При
                                        необходимости вы сможете отправить новое.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Оставить</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => cancelReport.mutate(report.id)}
                                      >
                                        Отменить сообщение
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {allPaymentReports.length > 5 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-2"
                      onClick={() => setReportHistoryExpanded((current) => !current)}
                    >
                      {reportHistoryExpanded
                        ? "Свернуть"
                        : `Показать всю историю (${allPaymentReports.length})`}
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${reportHistoryExpanded ? "rotate-180" : ""}`}
                      />
                    </Button>
                  )}
                </div>
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
