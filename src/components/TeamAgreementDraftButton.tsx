import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FilePlus2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/auth-context";
import { getDefaultLeaseDates } from "@/lib/domain";
import { fetchTenants } from "@/lib/queries";
import { createTeamAgreementDraft } from "@/lib/team-queries";
import { cn } from "@/lib/utils";

function newDraftFields() {
  return {
    tenantId: "",
    unitId: "",
    ...getDefaultLeaseDates(),
    monthlyPayment: "",
    paymentDueDay: "",
  };
}

const selectClassName =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

export function TeamAgreementDraftButton({
  propertyId,
  propertyName,
  units,
  mode,
  onCreated,
}: {
  propertyId: string;
  propertyName: string;
  units: { id: string; name: string }[];
  mode: "owner" | "manager";
  onCreated: () => void | Promise<void>;
}) {
  const { user, role } = useAuth();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [fields, setFields] = useState(newDraftFields);
  const tenants = useQuery({
    queryKey: ["tenants", "team-agreement-draft", user?.id],
    queryFn: async () => (await fetchTenants()).filter((tenant) => tenant.owner_id === user?.id),
    enabled: open && Boolean(user),
  });

  const save = useMutation({
    mutationFn: () => {
      if (!user || !draftId) throw new Error("Откройте форму заново.");
      if (tenants.isError || !tenants.data?.some((tenant) => tenant.id === fields.tenantId)) {
        throw new Error("Выберите доступного арендатора из своего списка.");
      }
      if (fields.unitId && !units.some((unit) => unit.id === fields.unitId)) {
        throw new Error("Выбранное помещение больше недоступно.");
      }
      if (!fields.startDate || !fields.endDate || fields.endDate < fields.startDate) {
        throw new Error("Укажите даты договора. Окончание должно быть не раньше начала.");
      }
      const monthlyPayment = Number(fields.monthlyPayment);
      if (!fields.monthlyPayment.trim() || !Number.isFinite(monthlyPayment) || monthlyPayment < 0) {
        throw new Error("Укажите корректную ежемесячную плату.");
      }
      const paymentDueDay = fields.paymentDueDay ? Number(fields.paymentDueDay) : null;
      if (
        paymentDueDay !== null &&
        (!Number.isInteger(paymentDueDay) || paymentDueDay < 1 || paymentDueDay > 31)
      ) {
        throw new Error("Укажите день оплаты от 1 до 31.");
      }

      return createTeamAgreementDraft({
        propertyId,
        draftId,
        tenantId: fields.tenantId,
        unitId: fields.unitId || null,
        startDate: fields.startDate,
        endDate: fields.endDate,
        monthlyPayment,
        paymentDueDay,
      });
    },
    onSuccess: async () => {
      setOpen(false);
      toast.success(
        mode === "owner" ? "Черновик договора создан" : "Черновик передан собственнику",
      );
      try {
        await onCreated();
      } catch {
        toast.error("Не удалось обновить данные объекта. Обновите страницу.");
      }
    },
  });

  const title = mode === "owner" ? "Добавить арендатора" : "Подготовить черновик договора";
  const setField = (field: keyof typeof fields, value: string) =>
    setFields((current) => ({ ...current, [field]: value }));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (save.isPending) return;
          if (nextOpen) {
            save.reset();
            setFields(newDraftFields());
            setDraftId(crypto.randomUUID());
          }
          setOpen(nextOpen);
        }}
      >
        <DialogTrigger asChild>
          <Button type="button" disabled={!user || save.isPending}>
            <FilePlus2 className="mr-2 size-4" /> {title}
          </Button>
        </DialogTrigger>
        <DialogContent
          className={cn(
            "max-h-[90dvh] overflow-y-auto",
            save.isPending && "[&>button:last-child]:hidden",
          )}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {mode === "owner"
                ? `Выберите арендатора из своего списка и создайте черновик договора для объекта «${propertyName}».`
                : `Подготовьте черновик для объекта «${propertyName}». Имя и email выбранного арендатора будут доступны собственнику. Собственник отправит договор на подписание и активирует его.`}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!save.isPending) save.mutate();
            }}
          >
            <fieldset className="space-y-4" disabled={save.isPending}>
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-tenant`}>Арендатор</Label>
                <select
                  id={`${fieldId}-tenant`}
                  className={selectClassName}
                  value={fields.tenantId}
                  onChange={(event) => setField("tenantId", event.target.value)}
                  disabled={tenants.isFetching || tenants.isError || !tenants.data?.length}
                  required
                >
                  <option value="" disabled>
                    Выберите арендатора
                  </option>
                  {tenants.data?.map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.email ? `${tenant.name} · ${tenant.email}` : tenant.name}
                    </option>
                  ))}
                </select>
                {tenants.isPending && (
                  <p role="status" className="text-sm text-muted-foreground">
                    Загружаем арендаторов…
                  </p>
                )}
                {tenants.isError && (
                  <div className="flex flex-wrap items-center gap-2">
                    <p role="alert" className="text-sm text-destructive">
                      Не удалось загрузить арендаторов.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void tenants.refetch()}
                    >
                      Повторить
                    </Button>
                  </div>
                )}
                {tenants.isSuccess && !tenants.data.length && (
                  <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                    <p>В вашем списке пока нет арендаторов.</p>
                    {(role === "owner" || role === "admin") && (
                      <Button asChild variant="link" size="sm" className="px-0">
                        {mode === "owner" ? (
                          <Link
                            to="/tenants"
                            search={{ newForAgreement: true, newForProperty: propertyId }}
                          >
                            Создать карточку арендатора
                          </Link>
                        ) : (
                          <Link to="/tenants">Открыть список арендаторов</Link>
                        )}
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {units.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor={`${fieldId}-unit`}>Помещение</Label>
                  <select
                    id={`${fieldId}-unit`}
                    className={selectClassName}
                    value={fields.unitId}
                    onChange={(event) => setField("unitId", event.target.value)}
                  >
                    <option value="">Весь объект</option>
                    {units.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`${fieldId}-start`}>Начало</Label>
                  <Input
                    id={`${fieldId}-start`}
                    type="date"
                    value={fields.startDate}
                    onChange={(event) => setField("startDate", event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${fieldId}-end`}>Окончание</Label>
                  <Input
                    id={`${fieldId}-end`}
                    type="date"
                    min={fields.startDate}
                    value={fields.endDate}
                    onChange={(event) => setField("endDate", event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${fieldId}-payment`}>Ежемесячная плата, ₽</Label>
                  <Input
                    id={`${fieldId}-payment`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={fields.monthlyPayment}
                    onChange={(event) => setField("monthlyPayment", event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${fieldId}-due-day`}>День оплаты</Label>
                  <Input
                    id={`${fieldId}-due-day`}
                    type="number"
                    min="1"
                    max="31"
                    placeholder="Необязательно"
                    value={fields.paymentDueDay}
                    onChange={(event) => setField("paymentDueDay", event.target.value)}
                  />
                </div>
              </div>
            </fieldset>
            {save.isError && (
              <p role="alert" className="text-sm text-destructive">
                {save.error.message}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={save.isPending}
                onClick={() => setOpen(false)}
              >
                Отмена
              </Button>
              <Button
                type="submit"
                disabled={
                  save.isPending || tenants.isFetching || tenants.isError || !fields.tenantId
                }
              >
                {save.isPending ? "Сохраняем…" : "Создать черновик"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {mode === "owner" && save.data && (
        <Button asChild variant="link">
          <Link to="/agreements" search={{ agreementId: save.data }}>
            Открыть черновик
          </Link>
        </Button>
      )}
    </div>
  );
}
