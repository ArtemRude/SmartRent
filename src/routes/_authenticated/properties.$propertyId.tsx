import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileText, Inbox, MapPin, Pencil, Users } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { StorageImage } from "@/components/StorageImage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { formatDate, formatMoney, propertyTypeLabels, type PropertyType } from "@/lib/domain";
import {
  fetchAgreements,
  fetchProperty,
  fetchRequests,
  fetchTenants,
  fetchUnits,
} from "@/lib/queries";
import { PROPERTY_PHOTOS } from "@/lib/storage";

export const Route = createFileRoute("/_authenticated/properties/$propertyId")({
  head: () => ({ meta: [{ title: "Объект — Умная Аренда" }] }),
  component: PropertyDetailsPage,
});

function PropertyDetailsPage() {
  const { propertyId } = Route.useParams();
  const qc = useQueryClient();
  const property = useQuery({
    queryKey: ["property", propertyId],
    queryFn: () => fetchProperty(propertyId),
  });
  const units = useQuery({ queryKey: ["units"], queryFn: fetchUnits });
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: fetchTenants });
  const agreements = useQuery({ queryKey: ["agreements"], queryFn: fetchAgreements });
  const requests = useQuery({ queryKey: ["requests"], queryFn: fetchRequests });
  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [type, setType] = useState<PropertyType>("apartment");
  const [description, setDescription] = useState("");

  const openEdit = () => {
    if (!property.data) return;
    setName(property.data.name);
    setAddress(property.data.address);
    setType(property.data.type);
    setDescription(property.data.description ?? "");
    setEditOpen(true);
  };

  const update = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("properties")
        .update({
          name: name.trim(),
          address: address.trim(),
          type,
          description: description || null,
        })
        .eq("id", propertyId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Объект обновлён");
      setEditOpen(false);
      void qc.invalidateQueries({ queryKey: ["property", propertyId] });
      void qc.invalidateQueries({ queryKey: ["properties"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (property.isPending) return <p className="text-sm text-muted-foreground">Загружаем объект…</p>;
  if (property.isError)
    return <p className="text-sm text-destructive">Не удалось загрузить объект.</p>;
  if (!property.data) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="font-medium">Объект не найден</p>
          <Button asChild variant="link">
            <Link to="/properties">Вернуться к объектам</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const propertyUnits = (units.data ?? []).filter((item) => item.property_id === propertyId);
  const propertyAgreements = (agreements.data ?? []).filter(
    (item) => item.property_id === propertyId,
  );
  const propertyRequests = (requests.data ?? []).filter((item) => item.property_id === propertyId);
  const tenantIds = new Set(propertyAgreements.map((item) => item.tenant_id));
  const propertyTenants = (tenants.data ?? []).filter((item) => tenantIds.has(item.id));

  return (
    <>
      <Link
        to="/properties"
        className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-2 h-4 w-4" /> Все объекты
      </Link>
      <PageHeader
        title={property.data.name}
        description={propertyTypeLabels[property.data.type]}
        action={
          <Button variant="outline" onClick={openEdit}>
            <Pencil className="mr-2 h-4 w-4" /> Изменить
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <StorageImage
          bucket={PROPERTY_PHOTOS}
          path={property.data.photos[0]}
          alt={property.data.name}
          className="h-72 w-full rounded-2xl border"
        />
        <Card>
          <CardContent className="p-6">
            <p className="flex items-start gap-2 text-sm">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{" "}
              {property.data.address || "Адрес не указан"}
            </p>
            {property.data.description && (
              <p className="mt-4 text-sm text-muted-foreground">{property.data.description}</p>
            )}
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-secondary p-3">
                <p className="text-xs text-muted-foreground">Помещения</p>
                <p className="mt-1 text-xl font-semibold">{propertyUnits.length}</p>
              </div>
              <div className="rounded-xl bg-secondary p-3">
                <p className="text-xs text-muted-foreground">Арендаторы</p>
                <p className="mt-1 text-xl font-semibold">{propertyTenants.length}</p>
              </div>
              <div className="rounded-xl bg-secondary p-3">
                <p className="text-xs text-muted-foreground">Договоры</p>
                <p className="mt-1 text-xl font-semibold">{propertyAgreements.length}</p>
              </div>
              <div className="rounded-xl bg-secondary p-3">
                <p className="text-xs text-muted-foreground">Открытые заявки</p>
                <p className="mt-1 text-xl font-semibold">
                  {propertyRequests.filter((item) => item.status !== "closed").length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Помещения</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {propertyUnits.map((unit) => (
              <div key={unit.id} className="flex justify-between text-sm">
                <span>{unit.name}</span>
                <span className="text-muted-foreground">
                  {unit.area ? `${unit.area} м²` : "Площадь не указана"}
                </span>
              </div>
            ))}
            {!propertyUnits.length && (
              <p className="text-sm text-muted-foreground">Помещений пока нет.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" /> Арендаторы
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {propertyTenants.map((tenant) => (
              <div key={tenant.id}>
                <p className="text-sm font-medium">{tenant.name}</p>
                <p className="text-xs text-muted-foreground">
                  {tenant.email || tenant.phone || "Контакты не указаны"}
                </p>
              </div>
            ))}
            {!propertyTenants.length && (
              <p className="text-sm text-muted-foreground">
                Арендаторы появятся после создания договора.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" /> Договоры
          </CardTitle>
          <Button asChild size="sm">
            <Link to="/agreements">Управление договорами</Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {propertyAgreements.map((agreement) => {
            const tenant = tenants.data?.find((item) => item.id === agreement.tenant_id);
            return (
              <div
                key={agreement.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 last:border-0 last:pb-0"
              >
                <div>
                  <p className="text-sm font-medium">{tenant?.name ?? "Арендатор"}</p>
                  <p className="text-xs text-muted-foreground">
                    до {formatDate(agreement.end_date)}
                  </p>
                </div>
                <p className="text-sm">{formatMoney(agreement.monthly_payment)}/мес.</p>
              </div>
            );
          })}
          {!propertyAgreements.length && (
            <p className="text-sm text-muted-foreground">Договоров пока нет.</p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Inbox className="h-4 w-4" /> Последние заявки
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {propertyRequests.slice(0, 5).map((request) => (
            <div key={request.id} className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{request.title}</p>
                <p className="text-xs text-muted-foreground">{formatDate(request.created_at)}</p>
              </div>
              <StatusBadge status={request.status} />
            </div>
          ))}
          {!propertyRequests.length && (
            <p className="text-sm text-muted-foreground">Заявок пока нет.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Изменить объект</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-property-name">Название</Label>
              <Input
                id="edit-property-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-property-address">Адрес</Label>
              <Input
                id="edit-property-address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Тип</Label>
              <Select value={type} onValueChange={(value) => setType(value as PropertyType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(propertyTypeLabels).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-property-description">Описание</Label>
              <Textarea
                id="edit-property-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => update.mutate()} disabled={update.isPending || !name.trim()}>
              {update.isPending ? "Сохраняем…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
