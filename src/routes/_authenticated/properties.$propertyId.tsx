import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  CircleDollarSign,
  Clock3,
  FileText,
  Inbox,
  MapPin,
  Pencil,
  Users,
} from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  propertyTypeLabels,
  type PropertyType,
} from "@/lib/domain";
import { buildPropertyTimeline, type PropertyTimelineKind } from "@/lib/property-timeline";
import {
  fetchAgreementsForProperty,
  fetchProperty,
  fetchPropertyTimelineSources,
  fetchRequestsForProperty,
  fetchTenants,
  fetchUnitsForProperty,
} from "@/lib/queries";
import { PROPERTY_PHOTOS } from "@/lib/storage";

export const Route = createFileRoute("/_authenticated/properties/$propertyId")({
  head: () => ({ meta: [{ title: "Объект — SmartRent" }] }),
  component: PropertyDetailsPage,
});

function PropertyDetailsPage() {
  const { propertyId } = Route.useParams();
  const qc = useQueryClient();
  const property = useQuery({
    queryKey: ["property", propertyId],
    queryFn: () => fetchProperty(propertyId),
  });
  const units = useQuery({
    queryKey: ["units", "property", propertyId],
    queryFn: () => fetchUnitsForProperty(propertyId),
  });
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: fetchTenants });
  const agreements = useQuery({
    queryKey: ["agreements", "property", propertyId],
    queryFn: () => fetchAgreementsForProperty(propertyId),
  });
  const requests = useQuery({
    queryKey: ["requests", "property", propertyId],
    queryFn: () => fetchRequestsForProperty(propertyId),
  });
  const agreementIds = (agreements.data ?? []).map((agreement) => agreement.id);
  const requestIds = (requests.data ?? []).map((request) => request.id);
  const timelineSources = useQuery({
    queryKey: ["property-timeline", propertyId, agreementIds, requestIds],
    queryFn: () => fetchPropertyTimelineSources(propertyId, agreementIds, requestIds),
    enabled: agreements.isSuccess && requests.isSuccess,
  });
  const [editOpen, setEditOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<PropertyTimelineKind | "all">("all");
  const [historyLimit, setHistoryLimit] = useState(20);
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
      void qc.invalidateQueries({ queryKey: ["property-timeline", propertyId] });
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

  const propertyUnits = units.data ?? [];
  const propertyAgreements = agreements.data ?? [];
  const propertyRequests = requests.data ?? [];
  const tenantIds = new Set(propertyAgreements.map((item) => item.tenant_id));
  const propertyTenants = (tenants.data ?? []).filter((item) => tenantIds.has(item.id));
  const timeline = timelineSources.data
    ? buildPropertyTimeline({
        ...timelineSources.data,
        agreements: propertyAgreements,
        requests: propertyRequests,
        tenants: tenants.data ?? [],
        units: propertyUnits,
      })
    : [];
  const filteredTimeline =
    historyFilter === "all" ? timeline : timeline.filter((event) => event.kind === historyFilter);
  const visibleTimeline = filteredTimeline.slice(0, historyLimit);

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

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Обзор</TabsTrigger>
          <TabsTrigger value="history">
            <Clock3 className="mr-2 h-4 w-4" /> История
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-0 space-y-6">
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

          <div className="grid gap-6 lg:grid-cols-2">
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

          <Card>
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

          <Card>
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
                    <p className="text-xs text-muted-foreground">
                      {formatDate(request.created_at)}
                    </p>
                  </div>
                  <StatusBadge status={request.status} />
                </div>
              ))}
              {!propertyRequests.length && (
                <p className="text-sm text-muted-foreground">Заявок пока нет.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-0">
          <Card>
            <CardHeader className="gap-4">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clock3 className="h-4 w-4" /> История объекта
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Изменения объекта, договоры, оплаты и заявки в одной ленте.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["all", "Все"],
                    ["property", "Объект"],
                    ["agreement", "Договоры"],
                    ["payment", "Платежи"],
                    ["request", "Заявки"],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={historyFilter === value ? "default" : "outline"}
                    onClick={() => {
                      setHistoryFilter(value);
                      setHistoryLimit(20);
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {timelineSources.isPending ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Загружаем историю…</p>
              ) : timelineSources.isError ? (
                <p className="py-8 text-center text-sm text-destructive">
                  Не удалось загрузить историю объекта.
                </p>
              ) : visibleTimeline.length === 0 ? (
                <div className="py-10 text-center">
                  <Clock3 className="mx-auto h-8 w-8 text-muted-foreground/60" />
                  <p className="mt-3 text-sm font-medium">Событий пока нет</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Здесь появятся изменения объекта и связанные операции.
                  </p>
                </div>
              ) : (
                <div>
                  {visibleTimeline.map((event, index) => {
                    const EventIcon =
                      event.kind === "property"
                        ? Building2
                        : event.kind === "agreement"
                          ? FileText
                          : event.kind === "payment"
                            ? CircleDollarSign
                            : Inbox;
                    const content = (
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                          <p className="text-sm font-medium">{event.title}</p>
                          <time className="shrink-0 text-xs text-muted-foreground">
                            {formatDateTime(event.occurredAt)}
                          </time>
                        </div>
                        {event.description && (
                          <p className="mt-1 text-sm text-muted-foreground">{event.description}</p>
                        )}
                      </div>
                    );
                    return (
                      <div key={event.id} className="relative flex gap-3 pb-6 last:pb-0">
                        {index < visibleTimeline.length - 1 && (
                          <span className="absolute top-9 bottom-0 left-4 w-px bg-border" />
                        )}
                        <span className="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border bg-background text-primary">
                          <EventIcon className="h-4 w-4" />
                        </span>
                        {event.href ? (
                          <Link
                            to={event.href}
                            className="min-w-0 flex-1 rounded-lg p-1 -m-1 transition-colors hover:bg-muted/60"
                          >
                            {content}
                          </Link>
                        ) : (
                          content
                        )}
                      </div>
                    );
                  })}
                  {visibleTimeline.length < filteredTimeline.length && (
                    <div className="mt-5 border-t pt-5 text-center">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setHistoryLimit((current) => current + 20)}
                      >
                        Показать ещё
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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
