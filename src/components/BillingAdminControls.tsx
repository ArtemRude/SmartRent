import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Rocket, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/auth-context";
import { BILLING_PLANS, type BillingPlanId } from "@/lib/billing";
import {
  billingQueryOptions,
  launchBilling,
  pauseBilling,
  setBillingSubscription,
} from "@/lib/billing-queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function BillingAdminControls() {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const status = useQuery(billingQueryOptions(role === "admin" ? user?.id : undefined));
  const [confirm, setConfirm] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const mutation = useMutation({
    mutationFn: (mode: "launch" | "pause") =>
      mode === "launch" ? launchBilling() : pauseBilling(),
    onSuccess: (_, mode) => {
      setConfirm(false);
      setConfirmation("");
      void queryClient.invalidateQueries({ queryKey: ["billing"] });
      toast.success(
        mode === "launch"
          ? "Платный режим включён. Пользователи получат переходный период."
          : "Ограничения отключены. Действует бесплатный ранний доступ.",
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });
  if (role !== "admin") return null;
  const mode = status.data?.mode;
  const available = status.data?.available && !status.isError;
  return (
    <Card className="mb-6" data-testid="billing-admin-controls">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldCheck className="h-5 w-5" /> Запуск монетизации
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {status.isPending
            ? "Проверяем режим доступа…"
            : !available
              ? "Управление платным режимом пока недоступно. Проверьте подключение и подготовку сервиса."
              : mode === "prelaunch"
                ? "Сейчас действует ранний доступ. Все возможности бесплатны, ограничения за неоплату отключены."
                : "Платный режим включён. Ограничения действуют после окончания переходного, пробного и оплаченного периодов."}
        </p>
        <p className="text-sm text-muted-foreground">
          После запуска у существующих собственников будет 30 дней с первого уведомления в кабинете.
          У новых — 30 дней пробного доступа. За окончанием оплаченного периода следуют 7 льготных
          дней. Оплата автоматически не списывается.
        </p>
        {available &&
          (mode === "prelaunch" ? (
            <Button
              onClick={() => {
                setConfirmation("");
                setConfirm(true);
              }}
              disabled={mutation.isPending || status.isFetching}
            >
              <Rocket className="mr-2 h-4 w-4" /> Запустить платный режим
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => mutation.mutate("pause")}
              disabled={mutation.isPending || status.isFetching}
            >
              Отключить ограничения
            </Button>
          ))}
      </CardContent>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Запустить платный режим?</AlertDialogTitle>
            <AlertDialogDescription>
              Тарифы начнут применяться после переходного или пробного периода. Убедитесь, что
              готовы принимать оплату и выдавать доступ. История и действия по действующей аренде
              останутся доступны. Для подтверждения введите «ЗАПУСК».
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Label htmlFor="billing-launch-confirmation">Подтверждение запуска</Label>
          <Input
            id="billing-launch-confirmation"
            autoComplete="off"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder="ЗАПУСК"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmation !== "ЗАПУСК" || mutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                mutation.mutate("launch");
              }}
            >
              Подтвердить запуск
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export function BillingSubscriptionEditor({ ownerId, name }: { ownerId: string; name: string }) {
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<BillingPlanId>("owner");
  const [until, setUntil] = useState("");
  const [validationError, setValidationError] = useState("");
  const mutation = useMutation({
    mutationFn: (paidUntil: string | null) => setBillingSubscription(ownerId, plan, paidUntil),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["billing"] });
      toast.success("Срок доступа сохранён");
      setOpen(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  if (role !== "admin") return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        setValidationError("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Тариф: ${name}`}>
          Тариф
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Доступ: {name}</DialogTitle>
          <DialogDescription>
            Выдайте согласованный тариф до указанного момента. Это изменяет доступ и не подтверждает
            получение денег. Прежний срок будет заменён.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const date = plan === "start" ? null : new Date(until);
            if (date && (!Number.isFinite(Number(date)) || Number(date) <= Date.now())) {
              setValidationError("Укажите будущую дату и время окончания доступа.");
              return;
            }
            setValidationError("");
            mutation.mutate(date?.toISOString() ?? null);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={`billing-plan-${ownerId}`}>Новый тариф</Label>
            <Select value={plan} onValueChange={(value) => setPlan(value as BillingPlanId)}>
              <SelectTrigger id={`billing-plan-${ownerId}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BILLING_PLANS.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {plan !== "start" && (
            <div className="space-y-2">
              <Label htmlFor={`billing-until-${ownerId}`}>
                Доступ до (по вашему часовому поясу)
              </Label>
              <Input
                id={`billing-until-${ownerId}`}
                type="datetime-local"
                required
                value={until}
                onChange={(event) => setUntil(event.target.value)}
              />
            </div>
          )}
          {plan === "start" && (
            <p className="text-sm text-muted-foreground">
              Бесплатный тариф заменит текущий платный срок. Не сокращайте уже оплаченный доступ без
              согласования с собственником.
            </p>
          )}
          {validationError && (
            <p role="alert" className="text-sm text-destructive">
              {validationError}
            </p>
          )}
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Сохраняем…" : "Сохранить доступ"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
