import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Download, FileText, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney, getDefaultLeaseDates } from "@/lib/domain";
import {
  type Agreement,
  fetchAgreements,
  fetchProperties,
  fetchTenants,
  fetchUnits,
} from "@/lib/queries";
import { downloadFile, LEASE_DOCUMENTS, removeFile, uploadFile } from "@/lib/storage";

export const Route = createFileRoute("/_authenticated/agreements")({
  validateSearch: (search: Record<string, unknown>): { agreementId?: string } =>
    typeof search["agreementId"] === "string" ? { agreementId: search["agreementId"] } : {},
  head: () => ({
    meta: [
      { title: "Договоры — Умная Аренда" },
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
  file: File | null;
};

const emptyForm: AgreementForm = {
  propertyId: "",
  unitId: "",
  tenantId: "",
  startDate: "",
  endDate: "",
  monthlyPayment: "",
  file: null,
};

function createForm(): AgreementForm {
  return {
    ...emptyForm,
    ...getDefaultLeaseDates(),
  };
}

function AgreementsPage() {
  const { agreementId } = Route.useSearch();
  const { user } = useAuth();
  const qc = useQueryClient();
  const agreements = useQuery({ queryKey: ["agreements"], queryFn: fetchAgreements });
  const properties = useQuery({ queryKey: ["properties"], queryFn: fetchProperties });
  const units = useQuery({ queryKey: ["units"], queryFn: fetchUnits });
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: fetchTenants });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Agreement | null>(null);
  const [form, setForm] = useState<AgreementForm>(createForm);

  const openCreate = () => {
    setEditing(null);
    setForm(createForm());
    setOpen(true);
  };

  const openEdit = (agreement: Agreement) => {
    setEditing(agreement);
    setForm({
      propertyId: agreement.property_id,
      unitId: agreement.unit_id ?? "",
      tenantId: agreement.tenant_id,
      startDate: agreement.start_date,
      endDate: agreement.end_date,
      monthlyPayment: String(agreement.monthly_payment),
      file: null,
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Нет сессии");
      if (!form.propertyId || !form.tenantId || !form.startDate || !form.endDate) {
        throw new Error("Заполните объект, арендатора и даты договора");
      }
      if (form.endDate < form.startDate) throw new Error("Дата окончания раньше даты начала");
      const payment = Number(form.monthlyPayment);
      if (!Number.isFinite(payment) || payment < 0) throw new Error("Укажите корректную сумму");

      let uploadedPath: string | null = null;
      try {
        if (form.file) uploadedPath = await uploadFile(LEASE_DOCUMENTS, user.id, form.file);
        const values = {
          owner_id: user.id,
          property_id: form.propertyId,
          unit_id: form.unitId || null,
          tenant_id: form.tenantId,
          start_date: form.startDate,
          end_date: form.endDate,
          monthly_payment: payment,
          document_file: uploadedPath ?? editing?.document_file ?? null,
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
      } catch (error) {
        if (uploadedPath) await removeFile(LEASE_DOCUMENTS, uploadedPath).catch(() => undefined);
        throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Договор обновлён" : "Договор создан");
      setOpen(false);
      setEditing(null);
      setForm(createForm());
      void qc.invalidateQueries({ queryKey: ["agreements"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const archive = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("lease_agreements")
        .update({ status: "archived" })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Договор перемещён в архив");
      void qc.invalidateQueries({ queryKey: ["agreements"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const propertyUnits = (units.data ?? []).filter((unit) => unit.property_id === form.propertyId);
  const loading = [agreements, properties, units, tenants].some((query) => query.isPending);
  const failed = [agreements, properties, units, tenants].some((query) => query.isError);

  useEffect(() => {
    if (!agreementId || !agreements.data?.some((agreement) => agreement.id === agreementId)) return;
    document.getElementById(`agreement-${agreementId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [agreementId, agreements.data]);

  return (
    <>
      <PageHeader
        title="Договоры"
        description="Сроки, суммы и документы по аренде"
        action={
          <Button onClick={openCreate} disabled={!properties.data?.length || !tenants.data?.length}>
            <Plus className="mr-2 h-4 w-4" /> Новый договор
          </Button>
        }
      />

      {loading && <p className="text-sm text-muted-foreground">Загружаем договоры…</p>}
      {failed && <p className="text-sm text-destructive">Не удалось загрузить данные договоров.</p>}
      {!loading && (!properties.data?.length || !tenants.data?.length) && (
        <Card className="mb-4">
          <CardContent className="p-5 text-sm text-muted-foreground">
            Чтобы создать договор, сначала добавьте объект и арендатора.
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {(agreements.data ?? []).map((agreement) => {
          const property = properties.data?.find((item) => item.id === agreement.property_id);
          const unit = units.data?.find((item) => item.id === agreement.unit_id);
          const tenant = tenants.data?.find((item) => item.id === agreement.tenant_id);
          return (
            <Card
              key={agreement.id}
              id={`agreement-${agreement.id}`}
              className={cn(
                "scroll-mt-6 transition-shadow",
                agreement.status === "archived" && "opacity-65",
                agreementId === agreement.id && "border-primary/50 ring-2 ring-primary/20",
              )}
            >
              <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
                  <FileText className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to="/properties/$propertyId"
                      params={{ propertyId: agreement.property_id }}
                      className="font-semibold hover:text-primary"
                    >
                      {property?.name ?? "Объект"}
                    </Link>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs",
                        agreement.status === "active"
                          ? "bg-success/12 text-success"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {agreement.status === "active" ? "Активен" : "Архив"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {tenant?.name ?? "Арендатор"}
                    {unit ? ` · ${unit.name}` : ""}
                  </p>
                  <p className="mt-1 text-sm">
                    {formatDate(agreement.start_date)} — {formatDate(agreement.end_date)} ·{" "}
                    {formatMoney(agreement.monthly_payment)}/мес.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
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
                      <Download className="mr-2 h-4 w-4" /> PDF
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => openEdit(agreement)}>
                    <Pencil className="mr-2 h-4 w-4" /> Изменить
                  </Button>
                  {agreement.status === "active" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => archive.mutate(agreement.id)}
                      disabled={archive.isPending}
                    >
                      <Archive className="mr-2 h-4 w-4" /> В архив
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!loading && (agreements.data?.length ?? 0) === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Договоров пока нет.
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Изменить договор" : "Новый договор"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Объект</Label>
              <Select
                value={form.propertyId}
                onValueChange={(value) =>
                  setForm((current) => ({ ...current, propertyId: value, unitId: "" }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите объект" />
                </SelectTrigger>
                <SelectContent>
                  {(properties.data ?? []).map((property) => (
                    <SelectItem key={property.id} value={property.id}>
                      {property.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <Label>Арендатор</Label>
              <Select
                value={form.tenantId}
                onValueChange={(value) => setForm((current) => ({ ...current, tenantId: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите арендатора" />
                </SelectTrigger>
                <SelectContent>
                  {(tenants.data ?? []).map((tenant) => (
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
            <div className="space-y-1.5">
              <Label htmlFor="lease-file">
                Договор PDF {editing?.document_file ? "(необязательно заменять)" : ""}
              </Label>
              <Input
                id="lease-file"
                type="file"
                accept="application/pdf"
                onChange={(event) =>
                  setForm((current) => ({ ...current, file: event.target.files?.[0] ?? null }))
                }
              />
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
