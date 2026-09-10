import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  CalendarDays,
  CreditCard,
  Download,
  FileText,
  Inbox,
  MapPin,
  Ruler,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { AgreementStatusBadge } from "@/components/AgreementStatusBadge";
import { NotificationsPreview } from "@/components/NotificationsPreview";
import { PaymentStatusBadge } from "@/components/PaymentStatusBadge";
import { StorageImage } from "@/components/StorageImage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/auth-context";
import { formatDate, formatMoney, getPaymentStatus, propertyTypeLabels } from "@/lib/domain";
import {
  fetchAgreements,
  fetchMyTenantRecords,
  fetchProperties,
  fetchRentCharges,
  fetchUnits,
} from "@/lib/queries";
import { downloadFile, LEASE_DOCUMENTS, PROPERTY_PHOTOS } from "@/lib/storage";

export const Route = createFileRoute("/_authenticated/cabinet")({
  head: () => ({ meta: [{ title: "Мой кабинет — Умная Аренда" }] }),
  component: CabinetPage,
});

function CabinetPage() {
  const { user } = useAuth();
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
  const queries = [tenants, agreements, properties, units, charges];
  const loading = queries.some((query) => query.isPending);
  const failed = queries.some((query) => query.isError);
  const unpaidCharges = (charges.data ?? [])
    .filter((charge) => charge.paid_at == null)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const debt = unpaidCharges
    .filter((charge) => getPaymentStatus(charge) === "overdue")
    .reduce((sum, charge) => sum + Number(charge.amount), 0);

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
                    </div>
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
                {unpaidCharges.slice(0, 3).map((charge) => {
                  const agreement = agreements.data?.find(
                    (item) => item.id === charge.agreement_id,
                  );
                  const property = properties.data?.find(
                    (item) => item.id === agreement?.property_id,
                  );
                  return (
                    <div
                      key={charge.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                    >
                      <div>
                        <p className="font-medium">{property?.name ?? "Объект аренды"}</p>
                        <p className="text-xs text-muted-foreground">
                          Оплатить до {formatDate(charge.due_date)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{formatMoney(charge.amount)}</p>
                        <PaymentStatusBadge status={getPaymentStatus(charge)} />
                      </div>
                    </div>
                  );
                })}
                {unpaidCharges.length === 0 && (
                  <p className="text-sm text-muted-foreground">Нет ожидающих платежей.</p>
                )}
              </div>
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
    </>
  );
}
