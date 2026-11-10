import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, Mail, Pencil, Phone, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/auth-context";
import { formatDate } from "@/lib/domain";
import { fetchAgreements, fetchProperties, fetchTenants, type Tenant } from "@/lib/queries";
import { normalizeTenantEmail, validateTenantDetails } from "@/lib/tenant";
import {
  fetchSearchTenant,
  isSearchRecordId,
  mergeSelectedRecord,
  scrollToSearchRecord,
} from "@/lib/search-record-queries";

export const Route = createFileRoute("/_authenticated/tenants")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { tenantId?: string; newForAgreement?: true; newForProperty?: string } => ({
    ...(typeof search["tenantId"] === "string" ? { tenantId: search["tenantId"] } : {}),
    ...(search["newForAgreement"] === true ? { newForAgreement: true } : {}),
    ...(search["newForAgreement"] === true && isSearchRecordId(search["newForProperty"])
      ? { newForProperty: search["newForProperty"] }
      : {}),
  }),
  head: () => ({
    meta: [
      { title: "Арендаторы — SmartRent" },
      { name: "description", content: "Карточки арендаторов и их контактные данные." },
      { property: "og:title", content: "Арендаторы — SmartRent" },
      { property: "og:description", content: "Список арендаторов собственника." },
    ],
  }),
  component: TenantsPage,
});

function TenantsPage() {
  const { tenantId, newForAgreement, newForProperty } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const tenantList = useQuery({ queryKey: ["tenants"], queryFn: fetchTenants });
  const agreements = useQuery({ queryKey: ["agreements"], queryFn: fetchAgreements });
  const properties = useQuery({ queryKey: ["properties"], queryFn: fetchProperties });

  const selectedTenant = useQuery({
    queryKey: ["tenants", "search-record", user?.id, tenantId],
    queryFn: ({ signal }) => fetchSearchTenant(tenantId!, signal),
    enabled: Boolean(user && isSearchRecordId(tenantId)),
    retry: false,
    refetchInterval: 5000,
  });
  const exactTenant =
    selectedTenant.isSuccess && !selectedTenant.isError ? selectedTenant.data : null;
  const tenants = {
    ...tenantList,
    data: mergeSelectedRecord(tenantList.data, tenantId, exactTenant),
  };
  const exactTenantId = exactTenant?.id;
  useEffect(() => {
    if (tenantId && exactTenantId === tenantId) scrollToSearchRecord(`tenant-${tenantId}`);
  }, [tenantId, exactTenantId]);
  const [open, setOpen] = useState(Boolean(newForAgreement));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const editingTenant = tenants.data?.find((tenant) => tenant.id === editingId) ?? null;

  const resetForm = () => {
    setName("");
    setEmail("");
    setPhone("");
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setOpen(true);
  };

  const openEdit = (tenant: Tenant) => {
    setEditingId(tenant.id);
    setName(tenant.name);
    setEmail(tenant.email);
    setPhone(tenant.phone ?? "");
    setOpen(true);
  };

  const closeForm = () => {
    setOpen(false);
    resetForm();
  };

  const getInvitationUrl = (tenant: { email: string; name: string }) => {
    const url = new URL("/auth", window.location.origin);
    url.searchParams.set("mode", "signup");
    url.searchParams.set("role", "tenant");
    url.searchParams.set("email", tenant.email);
    url.searchParams.set("name", tenant.name);
    return url.toString();
  };

  const copyInvitation = async (tenant: { email: string; name: string }) => {
    try {
      await navigator.clipboard.writeText(getInvitationUrl(tenant));
      toast.success("Ссылка-приглашение скопирована");
    } catch {
      toast.error("Не удалось скопировать ссылку");
    }
  };

  const emailInvitation = (tenant: { email: string; name: string }) => {
    const subject = encodeURIComponent("Приглашение в «Умную Аренду»");
    const body = encodeURIComponent(
      `Здравствуйте, ${tenant.name}!\n\nСобственник пригласил вас в сервис SmartRent. Зарегистрируйтесь по ссылке, чтобы увидеть договор и данные аренды:\n\n${getInvitationUrl(tenant)}`,
    );
    window.location.href = `mailto:${encodeURIComponent(tenant.email)}?subject=${subject}&body=${body}`;
  };

  const saveTenant = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Нет сессии");
      const validationError = validateTenantDetails(name, email);
      if (validationError) throw new Error(validationError);
      const normalizedEmail = normalizeTenantEmail(email);
      if (editingTenant?.user_id && normalizedEmail !== normalizeTenantEmail(editingTenant.email)) {
        throw new Error("Email подключённого кабинета изменить нельзя");
      }

      let duplicateQuery = supabase.from("tenants").select("id").ilike("email", normalizedEmail);
      if (editingId) duplicateQuery = duplicateQuery.neq("id", editingId);
      const { data: existing, error: checkError } = await duplicateQuery.limit(1);
      if (checkError) throw new Error(checkError.message);
      if (existing.length) throw new Error("Арендатор с таким email уже добавлен");

      const values = {
        name: name.trim(),
        email: normalizedEmail,
        phone: phone.trim() || null,
      };
      const { data, error } = editingId
        ? await supabase
            .from("tenants")
            .update(values)
            .eq("id", editingId)
            .select("id")
            .maybeSingle()
        : await supabase
            .from("tenants")
            .insert({ owner_id: user.id, ...values })
            .select("id")
            .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Арендатор не найден или недоступен для изменения");
      return data.id;
    },
    onSuccess: async (savedTenantId) => {
      toast.success(editingId ? "Данные арендатора обновлены" : "Арендатор добавлен");
      await qc.invalidateQueries({ queryKey: ["tenants"] });
      closeForm();
      if (newForAgreement && !editingId) {
        await navigate({
          to: "/agreements",
          search: {
            newForTenant: savedTenantId,
            ...(newForProperty ? { newForProperty } : {}),
          },
          replace: true,
        });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tenants").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Арендатор удалён");
      setDeleteId(null);
      void qc.invalidateQueries({ queryKey: ["tenants"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title="Арендаторы"
        description="Добавьте арендатора с его email — он получит доступ к личному кабинету"
        action={
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> Добавить
          </Button>
        }
      />

      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (value) setOpen(true);
          else if (!saveTenant.isPending) {
            closeForm();
            if (newForAgreement) {
              void navigate({ search: tenantId ? { tenantId } : {}, replace: true });
            }
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Изменить арендатора" : "Новый арендатор"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="t-name">Имя</Label>
              <Input id="t-name" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-email">Email</Label>
              <Input
                id="t-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={Boolean(editingTenant?.user_id)}
                required
              />
              {editingTenant?.user_id && (
                <p className="text-xs text-muted-foreground">
                  Email используется для входа в подключённый кабинет.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-phone">Телефон</Label>
              <Input
                id="t-phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => saveTenant.mutate()}
              disabled={saveTenant.isPending || Boolean(validateTenantDetails(name, email))}
            >
              {saveTenant.isPending ? "Сохраняем…" : editingId ? "Сохранить изменения" : "Добавить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {tenantId && (
        <p
          role={selectedTenant.isPending && isSearchRecordId(tenantId) ? "status" : "alert"}
          className="mb-4 text-sm text-muted-foreground"
        >
          {selectedTenant.isPending && isSearchRecordId(tenantId)
            ? "Загружаем выбранного арендатора…"
            : !exactTenant
              ? "Выбранный арендатор недоступен: он удалён или доступ изменился."
              : "Найденный арендатор выделен ниже."}
        </p>
      )}
      {[tenants, agreements, properties].some((query) => query.isPending) && (
        <p className="text-sm text-muted-foreground">Загружаем арендаторов…</p>
      )}
      {[tenants, agreements, properties].some((query) => query.isError) && (
        <p className="text-sm text-destructive">Не удалось загрузить арендаторов.</p>
      )}

      {tenants.data?.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Список пуст. Добавьте арендатора, чтобы заключить договор.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(tenants.data ?? []).map((t) => {
          const activeAgreement = agreements.data?.find(
            (agreement) => agreement.tenant_id === t.id && agreement.status === "active",
          );
          const property = properties.data?.find(
            (item) => item.id === activeAgreement?.property_id,
          );
          return (
            <Card
              key={t.id}
              id={`tenant-${t.id}`}
              data-testid="tenant-card"
              className={tenantId === t.id ? "border-primary/50 ring-2 ring-primary/20" : undefined}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold">{t.name}</h2>
                  <div className="flex">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Изменить"
                      onClick={() => openEdit(t)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Удалить"
                      onClick={() => setDeleteId(t.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="h-4 w-4" /> {t.email || "—"}
                </p>
                <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                  <Phone className="h-4 w-4" /> {t.phone || "—"}
                </p>
                {t.user_id && (
                  <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-success/12 px-2.5 py-0.5 text-xs text-success">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Кабинет подключён
                  </p>
                )}
                {!t.user_id && t.email && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => void copyInvitation(t)}>
                      <Copy className="mr-2 h-4 w-4" /> Скопировать приглашение
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => emailInvitation(t)}>
                      <Send className="mr-2 h-4 w-4" /> Отправить email
                    </Button>
                  </div>
                )}
                {activeAgreement && (
                  <div className="mt-4 border-t pt-3 text-sm">
                    <p className="font-medium">{property?.name ?? "Объект"}</p>
                    <p className="text-xs text-muted-foreground">
                      Договор до {formatDate(activeAgreement.end_date)}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <AlertDialog open={Boolean(deleteId)} onOpenChange={(value) => !value && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить арендатора?</AlertDialogTitle>
            <AlertDialogDescription>
              Связанные договоры и заявки также будут удалены. Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && remove.mutate(deleteId)}
              disabled={remove.isPending}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
