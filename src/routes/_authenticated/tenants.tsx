import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Mail, Phone, Plus, Trash2 } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatDate } from "@/lib/domain";
import { fetchAgreements, fetchProperties, fetchTenants } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/tenants")({
  head: () => ({
    meta: [
      { title: "Арендаторы — IRentHome" },
      { name: "description", content: "Карточки арендаторов и их контактные данные." },
      { property: "og:title", content: "Арендаторы — IRentHome" },
      { property: "og:description", content: "Список арендаторов собственника." },
    ],
  }),
  component: TenantsPage,
});

function TenantsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: fetchTenants });
  const agreements = useQuery({ queryKey: ["agreements"], queryFn: fetchAgreements });
  const properties = useQuery({ queryKey: ["properties"], queryFn: fetchProperties });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Нет сессии");
      const normalizedEmail = email.trim().toLowerCase();
      if (normalizedEmail) {
        const { data: existing, error: checkError } = await supabase
          .from("tenants")
          .select("id")
          .ilike("email", normalizedEmail)
          .limit(1);
        if (checkError) throw new Error(checkError.message);
        if (existing.length) throw new Error("Арендатор с таким email уже добавлен");
      }
      const { error } = await supabase
        .from("tenants")
        .insert({ owner_id: user.id, name, email: normalizedEmail, phone: phone || null });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Арендатор добавлен");
      setOpen(false);
      setName("");
      setEmail("");
      setPhone("");
      void qc.invalidateQueries({ queryKey: ["tenants"] });
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
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Добавить
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Новый арендатор</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="t-name">Имя</Label>
                  <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="t-email">Email</Label>
                  <Input
                    id="t-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="t-phone">Телефон</Label>
                  <Input id="t-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => create.mutate()} disabled={create.isPending || !name.trim()}>
                  Сохранить
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

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
            <Card key={t.id}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold">{t.name}</h2>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Удалить"
                    onClick={() => setDeleteId(t.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
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
