import { rentAt } from "@/lib/lease-changes";
import {
  fetchSearchAgreement,
  isSearchRecordId,
  mergeSelectedRecord,
  scrollToSearchRecord,
} from "@/lib/search-record-queries";
import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  CalendarPlus,
  CircleStop,
  Download,
  FileDown,
  FileText,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { AgreementStatusBadge } from "@/components/AgreementStatusBadge";
import { AgreementStatusHistory } from "@/components/AgreementStatusHistory";
import { AgreementPreparation } from "@/components/AgreementPreparation";
import { FileUploadField } from "@/components/FileUploadField";
import { StorageImage } from "@/components/StorageImage";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/auth-context";
import { supabase } from "@/integrations/supabase/client";
import {
  type AgreementInventoryItem,
  printAgreementDocument,
  readAgreementContractDetails,
} from "@/lib/agreement-document";
import {
  localDateKey,
  agreementStatusLabels,
  formatDate,
  formatDateTime,
  formatMoney,
  getDefaultLeaseDates,
  getRenewalLeaseDates,
  type AgreementStatus,
} from "@/lib/domain";
import {
  type Agreement,
  fetchAgreementAcceptances,
  fetchAgreementStatusEvents,
  fetchAgreements,
  fetchProperties,
  fetchTenants,
  fetchUnits,
} from "@/lib/queries";
import {
  AGREEMENT_INVENTORY_PHOTOS,
  downloadFile,
  LEASE_DOCUMENTS,
  removeFile,
  uploadFile,
} from "@/lib/storage";
import { cn } from "@/lib/utils";
import { getAgreementPreparation } from "@/lib/rental-onboarding";

export const Route = createFileRoute("/_authenticated/agreements")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    agreementId?: string;
    newForProperty?: string;
    newForTenant?: string;
  } => ({
    ...(typeof search["agreementId"] === "string" ? { agreementId: search["agreementId"] } : {}),
    ...(isSearchRecordId(search["newForProperty"])
      ? { newForProperty: search["newForProperty"].toLowerCase() }
      : {}),
    ...(isSearchRecordId(search["newForTenant"])
      ? { newForTenant: search["newForTenant"].toLowerCase() }
      : {}),
  }),
  head: () => ({
    meta: [
      { title: "Договоры — SmartRent" },
      { name: "description", content: "Договоры аренды, сроки, суммы и документы." },
    ],
  }),
  component: AgreementsPage,
});

type AgreementForm = {
  propertyId: string;
  unitId: string;
  tenantId: string;
  startDate: string;
  endDate: string;
  monthlyPayment: string;
  agreementNumber: string;
  contractCity: string;
  signedDate: string;
  paymentDueDay: string;
  depositAmount: string;
  utilitiesTerms: string;
  noticeDays: string;
  ownerPassport: string;
  ownerRegistrationAddress: string;
  tenantPassport: string;
  tenantRegistrationAddress: string;
  inventoryItems: AgreementInventoryItem[];
  file: File | null;
  signedFile: File | null;
};

const emptyForm: AgreementForm = {
  propertyId: "",
  unitId: "",
  tenantId: "",
  startDate: "",
  endDate: "",
  monthlyPayment: "",
  agreementNumber: "",
  contractCity: "",
  signedDate: "",
  paymentDueDay: "",
  depositAmount: "",
  utilitiesTerms: "",
  noticeDays: "",
  ownerPassport: "",
  ownerRegistrationAddress: "",
  tenantPassport: "",
  tenantRegistrationAddress: "",
  inventoryItems: [],
  file: null,
  signedFile: null,
};

function createForm(): AgreementForm {
  return {
    ...emptyForm,
    ...getDefaultLeaseDates(),
  };
}

function optionalNumber(value: string, label: string, options: { min: number; max: number }) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < options.min || parsed > options.max) {
    throw new Error(`${label}: укажите целое число от ${options.min} до ${options.max}`);
  }
  return parsed;
}

function AgreementsPage() {
  const { agreementId, newForProperty, newForTenant } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { user, profile, role } = useAuth();
  const qc = useQueryClient();
  const agreementList = useQuery({ queryKey: ["agreements"], queryFn: fetchAgreements });
  const statusEvents = useQuery({
    queryKey: ["agreement-status-events"],
    queryFn: fetchAgreementStatusEvents,
  });
  const acceptances = useQuery({
    queryKey: ["agreement-acceptances"],
    queryFn: fetchAgreementAcceptances,
  });
  const propertyList = useQuery({ queryKey: ["properties"], queryFn: fetchProperties });
  const unitList = useQuery({ queryKey: ["units"], queryFn: fetchUnits });
  const tenantList = useQuery({ queryKey: ["tenants"], queryFn: fetchTenants });
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
  const tenants = {
    ...tenantList,
    data: mergeSelectedRecord(tenantList.data, exact?.tenant?.id, exact?.tenant),
  };
  const exactAgreementId = exact?.agreement.id;
  useEffect(() => {
    if (agreementId && exactAgreementId === agreementId)
      scrollToSearchRecord(`agreement-${agreementId}`);
  }, [agreementId, exactAgreementId]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Agreement | null>(null);
  const [editSection, setEditSection] = useState<"details" | "signed-document">("details");
  const [renewingFrom, setRenewingFrom] = useState<Agreement | null>(null);
  const [form, setForm] = useState<AgreementForm>(createForm);
  const [statusFilter, setStatusFilter] = useState<"all" | AgreementStatus>("all");
  const [scopedCreate, setScopedCreate] = useState(false);

  const openCreate = useCallback(
    ({ propertyId = "", tenantId = "" } = {}) => {
      setEditSection("details");
      setEditing(null);
      setRenewingFrom(null);
      setScopedCreate(Boolean(propertyId || tenantId));
      setForm({ ...createForm(), propertyId, tenantId });
      setOpen(true);
      if (newForProperty || newForTenant) {
        void navigate({ search: agreementId ? { agreementId } : {}, replace: true });
      }
    },
    [agreementId, navigate, newForProperty, newForTenant],
  );
  const shortcutRequested = !agreementId && Boolean(newForProperty || newForTenant);
  const ownProperties = (propertyList.data ?? []).filter(
    (property) => property.owner_id === user?.id,
  );
  const ownTenants = (tenantList.data ?? []).filter((tenant) => tenant.owner_id === user?.id);
  const shortcutLoading =
    !user ||
    propertyList.isPending ||
    propertyList.isFetching ||
    tenantList.isPending ||
    tenantList.isFetching;
  const shortcutFailed = propertyList.isError || tenantList.isError;
  const shortcutPropertyAvailable =
    !newForProperty || ownProperties.some((property) => property.id === newForProperty);
  const shortcutTenantAvailable =
    !newForTenant || ownTenants.some((tenant) => tenant.id === newForTenant);
  const missingProperty = shortcutRequested ? !ownProperties.length : !properties.data?.length;
  const missingTenant = shortcutRequested ? !ownTenants.length : !tenants.data?.length;
  const shortcutReady =
    shortcutRequested &&
    !shortcutLoading &&
    !shortcutFailed &&
    !missingProperty &&
    !missingTenant &&
    shortcutPropertyAvailable &&
    shortcutTenantAvailable;
  useEffect(() => {
    if (shortcutReady && !open) {
      openCreate({ propertyId: newForProperty ?? "", tenantId: newForTenant ?? "" });
    }
  }, [newForProperty, newForTenant, open, openCreate, shortcutReady]);
  const shortcutIssue = !shortcutRequested
    ? null
    : shortcutLoading
      ? "Загружаем объект и список арендаторов…"
      : shortcutFailed
        ? "Не удалось загрузить объект или арендаторов. Обновите страницу."
        : !shortcutPropertyAvailable
          ? "Выбранный объект недоступен для создания договора."
          : !shortcutTenantAvailable
            ? "Выбранный арендатор недоступен для создания договора."
            : null;

  const openEdit = (agreement: Agreement, section: "details" | "signed-document" = "details") => {
    setScopedCreate(false);
    setEditSection(section);
    const details = readAgreementContractDetails(agreement.contract_details);
    setEditing(agreement);
    setRenewingFrom(null);
    setForm({
      propertyId: agreement.property_id,
      unitId: agreement.unit_id ?? "",
      tenantId: agreement.tenant_id,
      startDate: agreement.start_date,
      endDate: agreement.end_date,
      monthlyPayment: String(agreement.monthly_payment),
      agreementNumber: details.agreementNumber ?? "",
      contractCity: details.contractCity ?? "",
      signedDate: details.signedDate ?? "",
      paymentDueDay:
        agreement.payment_due_day?.toString() ?? details.paymentDueDay?.toString() ?? "",
      depositAmount: details.depositAmount?.toString() ?? "",
      utilitiesTerms: details.utilitiesTerms ?? "",
      noticeDays: details.noticeDays?.toString() ?? "",
      ownerPassport: details.ownerPassport ?? "",
      ownerRegistrationAddress: details.ownerRegistrationAddress ?? "",
      tenantPassport: details.tenantPassport ?? "",
      tenantRegistrationAddress: details.tenantRegistrationAddress ?? "",
      inventoryItems: details.inventoryItems ?? [],
      file: null,
      signedFile: null,
    });
    setOpen(true);
  };

  const openRenewal = (agreement: Agreement) => {
    setScopedCreate(false);
    setEditSection("details");
    const details = readAgreementContractDetails(agreement.contract_details);
    setEditing(null);
    setRenewingFrom(agreement);
    setForm({
      propertyId: agreement.property_id,
      unitId: agreement.unit_id ?? "",
      tenantId: agreement.tenant_id,
      ...getRenewalLeaseDates(agreement.end_date),
      monthlyPayment: String(rentAt(agreement, getRenewalLeaseDates(agreement.end_date).startDate)),
      agreementNumber: "",
      contractCity: details.contractCity ?? "",
      signedDate: "",
      paymentDueDay:
        agreement.payment_due_day?.toString() ?? details.paymentDueDay?.toString() ?? "",
      depositAmount: details.depositAmount?.toString() ?? "",
      utilitiesTerms: details.utilitiesTerms ?? "",
      noticeDays: details.noticeDays?.toString() ?? "",
      ownerPassport: details.ownerPassport ?? "",
      ownerRegistrationAddress: details.ownerRegistrationAddress ?? "",
      tenantPassport: details.tenantPassport ?? "",
      tenantRegistrationAddress: details.tenantRegistrationAddress ?? "",
      inventoryItems: details.inventoryItems ?? [],
      file: null,
      signedFile: null,
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Нет сессии");
      if (!form.propertyId || !form.tenantId || !form.startDate || !form.endDate) {
        throw new Error("Заполните объект, арендатора и даты договора");
      }
      if (
        scopedCreate &&
        (!ownProperties.some((property) => property.id === form.propertyId) ||
          !ownTenants.some((tenant) => tenant.id === form.tenantId))
      ) {
        throw new Error("Объект или арендатор больше недоступен. Обновите страницу.");
      }
      if (form.endDate < form.startDate) throw new Error("Дата окончания раньше даты начала");
      const payment = Number(form.monthlyPayment);
      if (!Number.isFinite(payment) || payment < 0) throw new Error("Укажите корректную сумму");
      const depositAmount = form.depositAmount.trim() ? Number(form.depositAmount) : null;
      if (depositAmount !== null && (!Number.isFinite(depositAmount) || depositAmount < 0)) {
        throw new Error("Укажите корректный обеспечительный платёж");
      }
      const paymentDueDay = optionalNumber(form.paymentDueDay, "День оплаты", {
        min: 1,
        max: 31,
      });
      const noticeDays = optionalNumber(form.noticeDays, "Срок уведомления", {
        min: 1,
        max: 365,
      });
      const inventoryItems = form.inventoryItems
        .map((item) => ({
          name: item.name.trim(),
          quantity: item.quantity.trim(),
          condition: item.condition.trim(),
        }))
        .filter((item) => item.name);

      const contractDetails = {
        agreementNumber: form.agreementNumber.trim(),
        contractCity: form.contractCity.trim(),
        signedDate: form.signedDate,
        paymentDueDay,
        depositAmount,
        utilitiesTerms: form.utilitiesTerms.trim(),
        noticeDays,
        ownerPassport: form.ownerPassport.trim(),
        ownerRegistrationAddress: form.ownerRegistrationAddress.trim(),
        tenantPassport: form.tenantPassport.trim(),
        tenantRegistrationAddress: form.tenantRegistrationAddress.trim(),
        inventoryItems,
      };

      let uploadedPath: string | null = null;
      let uploadedSignedPath: string | null = null;
      try {
        if (form.file) uploadedPath = await uploadFile(LEASE_DOCUMENTS, user.id, form.file);
        if (form.signedFile) {
          uploadedSignedPath = await uploadFile(LEASE_DOCUMENTS, user.id, form.signedFile);
        }
        const values = {
          owner_id: user.id,
          property_id: form.propertyId,
          unit_id: form.unitId || null,
          tenant_id: form.tenantId,
          start_date: form.startDate,
          end_date: form.endDate,
          monthly_payment: payment,
          payment_due_day: paymentDueDay,
          contract_details: contractDetails,
          document_file: uploadedPath ?? editing?.document_file ?? null,
          ...(uploadedSignedPath ? { signed_document_file: uploadedSignedPath } : {}),
          ...(!editing ? { status: "draft" as AgreementStatus } : {}),
        };

        const { error } = editing
          ? await supabase.from("lease_agreements").update(values).eq("id", editing.id)
          : await supabase.from("lease_agreements").insert(values);
        if (error) throw new Error(error.message);

        if (uploadedPath && editing?.document_file) {
          await removeFile(LEASE_DOCUMENTS, editing.document_file).catch(() => {
            toast.warning("Старый PDF не удалось удалить из хранилища");
          });
        }
        if (uploadedSignedPath && editing?.signed_document_file) {
          await removeFile(LEASE_DOCUMENTS, editing.signed_document_file).catch(() => {
            toast.warning("Старый подписанный PDF не удалось удалить из хранилища");
          });
        }
      } catch (error) {
        if (uploadedPath) await removeFile(LEASE_DOCUMENTS, uploadedPath).catch(() => undefined);
        if (uploadedSignedPath) {
          await removeFile(LEASE_DOCUMENTS, uploadedSignedPath).catch(() => undefined);
        }
        throw error;
      }
    },
    onSuccess: () => {
      toast.success(
        editing
          ? "Договор обновлён"
          : renewingFrom
            ? "Черновик продления создан"
            : "Договор создан",
      );
      setOpen(false);
      setEditing(null);
      setRenewingFrom(null);
      setForm(createForm());
      void qc.invalidateQueries({ queryKey: ["agreements"] });
      void qc.invalidateQueries({ queryKey: ["agreement-status-events"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const changeStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: AgreementStatus }) => {
      const { error } = await supabase.from("lease_agreements").update({ status }).eq("id", id);
      if (error) throw new Error(error.message);
      return status;
    },
    onSuccess: (status) => {
      toast.success(`Договор: ${agreementStatusLabels[status].toLocaleLowerCase("ru-RU")}`);
      void qc.invalidateQueries({ queryKey: ["agreements"] });
      void qc.invalidateQueries({ queryKey: ["agreement-status-events"] });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      if (status === "active") void qc.invalidateQueries({ queryKey: ["rent-charges"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const propertyUnits = (units.data ?? []).filter((unit) => unit.property_id === form.propertyId);
  const loading = [agreements, acceptances, properties, units, tenants].some(
    (query) => query.isPending,
  );
  const failed = [agreements, acceptances, properties, units, tenants].some(
    (query) => query.isError,
  );
  const visibleAgreements = (agreements.data ?? []).filter(
    (agreement) =>
      agreement.id === agreementId || statusFilter === "all" || agreement.status === statusFilter,
  );

  return (
    <>
      <PageHeader
        title="Договоры"
        description="Сроки, суммы и документы по аренде"
        action={
          <Button
            onClick={() => openCreate()}
            disabled={
              missingProperty ||
              missingTenant ||
              (shortcutRequested && (shortcutLoading || shortcutReady))
            }
          >
            <Plus className="mr-2 h-4 w-4" /> Новый договор
          </Button>
        }
      />

      {shortcutIssue && (
        <p
          role={shortcutLoading ? "status" : "alert"}
          className="mb-4 text-sm text-muted-foreground"
        >
          {shortcutIssue}
        </p>
      )}

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
      {loading && <p className="text-sm text-muted-foreground">Загружаем договоры…</p>}
      {failed && <p className="text-sm text-destructive">Не удалось загрузить данные договоров.</p>}
      {!shortcutLoading && !shortcutFailed && (missingProperty || missingTenant) && (
        <Card className="mb-4">
          <CardContent className="space-y-3 p-5">
            <p className="text-sm text-muted-foreground">
              Чтобы создать договор, сначала добавьте{" "}
              {missingProperty && missingTenant
                ? "объект и арендатора"
                : missingProperty
                  ? "объект"
                  : "арендатора"}
              .
            </p>
            <div className="flex flex-wrap gap-2">
              {missingProperty && (
                <Button asChild size="sm" variant="outline">
                  <Link to="/properties">Добавить объект</Link>
                </Button>
              )}
              {missingTenant && (
                <Button asChild size="sm" variant="outline">
                  <Link
                    to="/tenants"
                    search={{
                      newForAgreement: true,
                      ...(shortcutRequested && newForProperty && shortcutPropertyAvailable
                        ? { newForProperty }
                        : {}),
                    }}
                  >
                    Добавить арендатора
                  </Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && (agreements.data?.length ?? 0) > 0 && (
        <div className="mb-4 max-w-xs">
          <Label className="sr-only">Фильтр по статусу</Label>
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as "all" | AgreementStatus)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Все статусы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              {Object.entries(agreementStatusLabels).map(([status, label]) => (
                <SelectItem key={status} value={status}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-3">
        {visibleAgreements.map((agreement) => {
          const property = properties.data?.find((item) => item.id === agreement.property_id);
          const unit = units.data?.find((item) => item.id === agreement.unit_id);
          const tenant = tenants.data?.find((item) => item.id === agreement.tenant_id);
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
          const canManage = agreement.owner_id === user?.id || role === "admin";
          const canGenerateDocument = canManage;
          const ownerIsCurrentUser = agreement.owner_id === user?.id;
          const preparation = getAgreementPreparation(
            agreement,
            tenant?.user_id,
            acceptances.data ?? [],
          );
          return (
            <Card
              key={agreement.id}
              id={`agreement-${agreement.id}`}
              className={cn(
                "scroll-mt-6 transition-shadow",
                agreement.status === "completed" && "opacity-70",
                agreementId === agreement.id && "border-primary/50 ring-2 ring-primary/20",
              )}
            >
              <CardContent className="p-5">
                <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
                    <FileText className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {canManage ? (
                        <Link
                          to="/properties/$propertyId"
                          params={{ propertyId: agreement.property_id }}
                          className="font-semibold hover:text-primary"
                        >
                          {property?.name ?? "Объект"}
                        </Link>
                      ) : (
                        <span className="font-semibold">{property?.name ?? "Объект"}</span>
                      )}
                      <AgreementStatusBadge status={agreement.status} />
                      {canManage && agreement.status === "draft" && agreement.team_prepared && (
                        <span className="rounded-full bg-accent px-2 py-1 text-xs font-medium text-accent-foreground">
                          Черновик от команды
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {tenant?.name ?? "Арендатор"}
                      {unit ? ` · ${unit.name}` : ""}
                    </p>
                    <p className="mt-1 text-sm">
                      {formatDate(agreement.start_date)} — {formatDate(agreement.end_date)} ·{" "}
                      {formatMoney(rentAt(agreement, localDateKey()))}/мес.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {agreement.payment_due_day
                        ? `Оплата до ${agreement.payment_due_day}-го числа`
                        : "День оплаты совпадает с датой начала аренды"}
                    </p>
                    {agreement.status !== "draft" && visibleAcceptance && (
                      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                        <BadgeCheck className="h-3.5 w-3.5" />
                        Арендатор подтвердил условия ·{" "}
                        {formatDateTime(visibleAcceptance.accepted_at)}
                      </p>
                    )}
                    {agreement.status === "pending_signature" && !currentAcceptance && (
                      <p className="mt-2 text-xs font-medium text-amber-700">
                        Ожидается подтверждение арендатора
                      </p>
                    )}
                  </div>
                  {!canManage && (
                    <p className="col-span-2 text-sm text-muted-foreground">
                      Это ваша аренда. Договор доступен для просмотра; изменениями управляет
                      собственник.
                    </p>
                  )}
                  <div className="col-span-2 flex flex-wrap gap-2 border-t pt-4">
                    {canGenerateDocument && (
                      <Button
                        variant="outline"
                        size="sm"
                        title={
                          ownerIsCurrentUser
                            ? undefined
                            : "Реквизиты собственника в предпросмотре не заполнены."
                        }
                        onClick={() => {
                          try {
                            printAgreementDocument({
                              agreementId: agreement.id,
                              propertyType: property?.type ?? "other",
                              propertyName: property?.name ?? "Объект",
                              propertyAddress: property?.address ?? "",
                              unitName: unit?.name ?? null,
                              unitArea: unit?.area ?? null,
                              tenantName: tenant?.name ?? "Арендатор",
                              tenantEmail: tenant?.email ?? "",
                              tenantPhone: tenant?.phone ?? null,
                              ownerName: ownerIsCurrentUser ? (profile?.name ?? "Собственник") : "",
                              ownerEmail: ownerIsCurrentUser
                                ? (profile?.email ?? user?.email ?? "")
                                : "",
                              ownerPhone: ownerIsCurrentUser ? (profile?.phone ?? null) : null,
                              startDate: agreement.start_date,
                              endDate: agreement.original_end_date ?? agreement.end_date,
                              monthlyPayment: agreement.monthly_payment,
                              contractDetails: readAgreementContractDetails(
                                agreement.contract_details,
                              ),
                              tenantAcceptedAt: visibleAcceptance?.accepted_at,
                              inventoryPhotoCount: acceptancePhotos.length,
                            });
                          } catch (error) {
                            toast.error(
                              error instanceof Error ? error.message : "Не удалось открыть PDF",
                            );
                          }
                        }}
                      >
                        <FileDown className="mr-2 h-4 w-4" /> Предпросмотр и PDF
                      </Button>
                    )}
                    {agreement.document_file && (
                      <Button
                        variant="outline"
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
                        <Download className="mr-2 h-4 w-4" /> Подписанный PDF
                      </Button>
                    )}
                    {canManage && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={agreement.terms_locked}
                          title={
                            agreement.terms_locked
                              ? "Условия закреплены соглашением. Используйте изменение условий."
                              : undefined
                          }
                          onClick={() => openEdit(agreement)}
                        >
                          <Pencil className="mr-2 h-4 w-4" /> Изменить
                        </Button>
                        <Button variant="outline" size="sm" asChild>
                          <Link to="/utilities" search={{ agreement: agreement.id }}>
                            Коммунальные услуги
                          </Link>
                        </Button>
                        {agreement.status === "active" && (
                          <Button variant="outline" size="sm" asChild>
                            <Link to="/lease-changes" search={{ agreement: agreement.id }}>
                              <CalendarPlus className="mr-2 h-4 w-4" />
                              Продлить / изменить условия
                            </Link>
                          </Button>
                        )}
                        {agreement.status === "completed" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openRenewal(agreement)}
                          >
                            <CalendarPlus className="mr-2 h-4 w-4" /> Новый договор
                          </Button>
                        )}
                        {agreement.status === "draft" && (
                          <Button
                            size="sm"
                            onClick={() =>
                              changeStatus.mutate({ id: agreement.id, status: "pending_signature" })
                            }
                            disabled={changeStatus.isPending}
                          >
                            <Send className="mr-2 h-4 w-4" /> На подписание
                          </Button>
                        )}
                        {agreement.status === "pending_signature" && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                changeStatus.mutate({ id: agreement.id, status: "draft" })
                              }
                              disabled={changeStatus.isPending}
                            >
                              <RotateCcw className="mr-2 h-4 w-4" /> В черновик
                            </Button>
                            <Button
                              size="sm"
                              onClick={() =>
                                changeStatus.mutate({ id: agreement.id, status: "active" })
                              }
                              disabled={
                                changeStatus.isPending ||
                                loading ||
                                failed ||
                                !preparation.canActivate
                              }
                              title={
                                failed
                                  ? "Не удалось проверить готовность договора"
                                  : !tenant?.user_id
                                    ? "Сначала подключите кабинет арендатора"
                                    : !agreement.signed_document_file
                                      ? "Сначала загрузите подписанный PDF"
                                      : !currentAcceptance
                                        ? "Сначала дождитесь подтверждения арендатора"
                                        : undefined
                              }
                            >
                              <BadgeCheck className="mr-2 h-4 w-4" /> Активировать
                            </Button>
                          </>
                        )}
                        {agreement.status === "active" && (
                          <Button variant="outline" size="sm" asChild>
                            <Link
                              to="/handover"
                              search={{ agreement: agreement.id, kind: "move_in" }}
                            >
                              <BadgeCheck className="mr-2 h-4 w-4" /> Оформить заселение
                            </Link>
                          </Button>
                        )}
                        {agreement.status === "active" && (
                          <Button variant="ghost" size="sm" asChild>
                            <Link
                              to="/handover"
                              search={{ agreement: agreement.id, kind: "move_out" }}
                            >
                              <CircleStop className="mr-2 h-4 w-4" /> Оформить выезд
                            </Link>
                          </Button>
                        )}
                        {agreement.status === "completed" && (
                          <Button variant="outline" size="sm" asChild>
                            <Link to="/lease-changes" search={{ agreement: agreement.id }}>
                              История условий
                            </Link>
                          </Button>
                        )}
                        {agreement.status === "completed" && (
                          <Button variant="outline" size="sm" asChild>
                            <Link to="/handover" search={{ agreement: agreement.id }}>
                              Акты и депозит
                            </Link>
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {canManage &&
                  !loading &&
                  !failed &&
                  (agreement.status === "draft" || agreement.status === "pending_signature") && (
                    <AgreementPreparation
                      preparation={preparation}
                      agreementId={agreement.id}
                      busy={changeStatus.isPending}
                      onSend={() =>
                        changeStatus.mutate({ id: agreement.id, status: "pending_signature" })
                      }
                      onUpload={() => openEdit(agreement, "signed-document")}
                    />
                  )}
                {acceptancePhotos.length > 0 && (
                  <div className="mt-4 border-t pt-4">
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
                <AgreementStatusHistory
                  agreementId={agreement.id}
                  ownerId={agreement.owner_id}
                  currentUserId={user?.id}
                  events={statusEvents.data ?? []}
                  isPending={statusEvents.isPending}
                  isError={statusEvents.isError}
                />
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!loading && visibleAgreements.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {statusFilter === "all" ? "Договоров пока нет." : "Договоров с таким статусом нет."}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setRenewingFrom(null);
        }}
      >
        <DialogContent
          className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
          onOpenAutoFocus={(event) => {
            if (editSection !== "signed-document") return;
            const section = document.getElementById("signed-document-section");
            if (section) {
              event.preventDefault();
              section.focus();
              section.scrollIntoView({ block: "center" });
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {editing ? "Изменить договор" : renewingFrom ? "Продление договора" : "Новый договор"}
            </DialogTitle>
          </DialogHeader>
          {renewingFrom && (
            <p className="rounded-lg bg-accent/60 p-3 text-sm text-muted-foreground">
              Создаётся новый черновик. Период начинается на следующий день после текущего договора;
              номер, дата подписания и PDF заполняются заново.
            </p>
          )}
          <div className="flex flex-col gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="lease-property">Объект</Label>
              <Select
                value={form.propertyId}
                onValueChange={(value) =>
                  setForm((current) => ({ ...current, propertyId: value, unitId: "" }))
                }
              >
                <SelectTrigger id="lease-property">
                  <SelectValue placeholder="Выберите объект" />
                </SelectTrigger>
                <SelectContent>
                  {(scopedCreate ? ownProperties : (properties.data ?? [])).map((property) => (
                    <SelectItem key={property.id} value={property.id}>
                      {property.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="order-2 border-t pt-4">
              <h3 className="font-medium">Данные для печатного договора</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Необязательные поля можно заполнить позже. Они подставляются только в договор и акт.
              </p>
            </div>
            <div className="order-2 grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="lease-number">Номер договора</Label>
                <Input
                  id="lease-number"
                  value={form.agreementNumber}
                  placeholder="Например, 12/2026"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, agreementNumber: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lease-city">Город подписания</Label>
                <Input
                  id="lease-city"
                  value={form.contractCity}
                  placeholder="Москва"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, contractCity: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lease-signed-date">Дата подписания</Label>
                <Input
                  id="lease-signed-date"
                  type="date"
                  value={form.signedDate}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, signedDate: event.target.value }))
                  }
                />
              </div>
            </div>
            <div className="order-2 grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="lease-due-day">День оплаты</Label>
                <Input
                  id="lease-due-day"
                  type="number"
                  min="1"
                  max="31"
                  value={form.paymentDueDay}
                  placeholder="До 10-го числа"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, paymentDueDay: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lease-deposit">Обеспечительный платёж, ₽</Label>
                <Input
                  id="lease-deposit"
                  type="number"
                  min="0"
                  step="1"
                  value={form.depositAmount}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, depositAmount: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lease-notice-days">Уведомление, дней</Label>
                <Input
                  id="lease-notice-days"
                  type="number"
                  min="1"
                  max="365"
                  value={form.noticeDays}
                  placeholder="30"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, noticeDays: event.target.value }))
                  }
                />
              </div>
            </div>
            <div className="order-2 space-y-1.5">
              <Label htmlFor="lease-utilities">Коммунальные и эксплуатационные платежи</Label>
              <Textarea
                id="lease-utilities"
                value={form.utilitiesTerms}
                placeholder="Например: оплачиваются арендатором по квитанциям"
                onChange={(event) =>
                  setForm((current) => ({ ...current, utilitiesTerms: event.target.value }))
                }
              />
            </div>
            <div className="order-2 grid gap-4 sm:grid-cols-2">
              <div className="space-y-3 rounded-lg border p-3">
                <p className="text-sm font-medium">Собственник</p>
                <div className="space-y-1.5">
                  <Label htmlFor="lease-owner-passport">Паспортные данные</Label>
                  <Input
                    id="lease-owner-passport"
                    value={form.ownerPassport}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, ownerPassport: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lease-owner-address">Адрес регистрации</Label>
                  <Textarea
                    id="lease-owner-address"
                    value={form.ownerRegistrationAddress}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        ownerRegistrationAddress: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="space-y-3 rounded-lg border p-3">
                <p className="text-sm font-medium">Арендатор</p>
                <div className="space-y-1.5">
                  <Label htmlFor="lease-tenant-passport">Паспортные данные</Label>
                  <Input
                    id="lease-tenant-passport"
                    value={form.tenantPassport}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, tenantPassport: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lease-tenant-address">Адрес регистрации</Label>
                  <Textarea
                    id="lease-tenant-address"
                    value={form.tenantRegistrationAddress}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        tenantRegistrationAddress: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
            </div>
            <div className="order-2 space-y-3 rounded-xl border p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="font-medium">Передаваемое имущество</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Предметы появятся в описи на последней странице договора.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={form.inventoryItems.length >= 15}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      inventoryItems: [
                        ...current.inventoryItems,
                        { name: "", quantity: "1", condition: "" },
                      ],
                    }))
                  }
                >
                  <Plus className="mr-2 h-4 w-4" /> Добавить предмет
                </Button>
              </div>
              {form.inventoryItems.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                  Список пока пуст. В печатном договоре останутся строки для заполнения вручную.
                </p>
              ) : (
                <div className="space-y-3">
                  {form.inventoryItems.map((item, index) => (
                    <div
                      key={index}
                      className="grid gap-3 rounded-lg bg-muted/40 p-3 sm:grid-cols-[minmax(0,2fr)_minmax(90px,0.7fr)_minmax(0,1.5fr)_auto] sm:items-end"
                    >
                      <div className="space-y-1.5">
                        <Label htmlFor={`inventory-name-${index}`}>Предмет {index + 1}</Label>
                        <Input
                          id={`inventory-name-${index}`}
                          value={item.name}
                          maxLength={120}
                          placeholder="Например, холодильник Samsung"
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              inventoryItems: current.inventoryItems.map(
                                (currentItem, itemIndex) =>
                                  itemIndex === index
                                    ? { ...currentItem, name: event.target.value }
                                    : currentItem,
                              ),
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`inventory-quantity-${index}`}>Количество</Label>
                        <Input
                          id={`inventory-quantity-${index}`}
                          value={item.quantity}
                          maxLength={20}
                          placeholder="1 шт."
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              inventoryItems: current.inventoryItems.map(
                                (currentItem, itemIndex) =>
                                  itemIndex === index
                                    ? { ...currentItem, quantity: event.target.value }
                                    : currentItem,
                              ),
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`inventory-condition-${index}`}>Состояние</Label>
                        <Input
                          id={`inventory-condition-${index}`}
                          value={item.condition}
                          maxLength={80}
                          placeholder="Исправное, без повреждений"
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              inventoryItems: current.inventoryItems.map(
                                (currentItem, itemIndex) =>
                                  itemIndex === index
                                    ? { ...currentItem, condition: event.target.value }
                                    : currentItem,
                              ),
                            }))
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Удалить предмет ${index + 1}`}
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            inventoryItems: current.inventoryItems.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          }))
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  {form.inventoryItems.length >= 15 && (
                    <p className="text-xs text-muted-foreground">
                      Достигнут лимит: 15 предметов на одной странице акта.
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Помещение</Label>
              <Select
                value={form.unitId || "none"}
                onValueChange={(value) =>
                  setForm((current) => ({ ...current, unitId: value === "none" ? "" : value }))
                }
                disabled={!form.propertyId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Весь объект" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Весь объект</SelectItem>
                  {propertyUnits.map((unit) => (
                    <SelectItem key={unit.id} value={unit.id}>
                      {unit.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lease-tenant">Арендатор</Label>
              <Select
                value={form.tenantId}
                onValueChange={(value) => setForm((current) => ({ ...current, tenantId: value }))}
              >
                <SelectTrigger id="lease-tenant">
                  <SelectValue placeholder="Выберите арендатора" />
                </SelectTrigger>
                <SelectContent>
                  {(scopedCreate ? ownTenants : (tenants.data ?? [])).map((tenant) => (
                    <SelectItem key={tenant.id} value={tenant.id}>
                      {tenant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="lease-start">Начало</Label>
                <Input
                  id="lease-start"
                  type="date"
                  value={form.startDate}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, startDate: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lease-end">Окончание</Label>
                <Input
                  id="lease-end"
                  type="date"
                  value={form.endDate}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, endDate: event.target.value }))
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lease-payment">Ежемесячная плата, ₽</Label>
              <Input
                id="lease-payment"
                type="number"
                min="0"
                step="1"
                value={form.monthlyPayment}
                onChange={(event) =>
                  setForm((current) => ({ ...current, monthlyPayment: event.target.value }))
                }
              />
            </div>
            <div className="order-3 space-y-1.5">
              <Label htmlFor="lease-file">
                Исходный договор PDF {editing?.document_file ? "(необязательно заменять)" : ""}
              </Label>
              <FileUploadField
                id="lease-file"
                accept="application/pdf"
                file={form.file}
                description={
                  editing?.document_file
                    ? "Исходный PDF уже загружен — выберите файл только для замены"
                    : "PDF до 20 МБ"
                }
                disabled={save.isPending}
                onFileChange={(file) => setForm((current) => ({ ...current, file }))}
              />
            </div>
            <div
              id="signed-document-section"
              tabIndex={-1}
              className="order-3 space-y-1.5 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              <Label htmlFor="lease-signed-file">
                Подписанный договор PDF{" "}
                {editing?.signed_document_file ? "(необязательно заменять)" : ""}
              </Label>
              <FileUploadField
                id="lease-signed-file"
                accept="application/pdf"
                file={form.signedFile}
                description={
                  editing?.signed_document_file
                    ? "Подписанный PDF уже загружен — выберите файл только для замены"
                    : "PDF до 20 МБ"
                }
                disabled={save.isPending}
                onFileChange={(signedFile) => setForm((current) => ({ ...current, signedFile }))}
              />
              <p className="text-xs text-muted-foreground">
                Без подписанного файла договор нельзя перевести в статус «Активен».
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Сохраняем…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
