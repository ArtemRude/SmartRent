import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Camera, CalendarClock, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatMonth, getRentChargeBalance, localDateKey } from "@/lib/domain";
import { getSignedUrl, UTILITY_READING_PHOTOS } from "@/lib/storage";
import { reviewUtilityBill } from "@/lib/utility-queries";
import {
  formatUtilityMoney,
  formatUtilityValue,
  utilityStatusLabels,
  type UtilityBill,
  type UtilityBillItem,
} from "@/lib/utilities";
import type { RentCharge } from "@/lib/queries";

export function UtilityBillCard({
  bill,
  items,
  canReview,
  charge,
}: {
  bill: UtilityBill;
  items: UtilityBillItem[];
  canReview: boolean;
  charge?: RentCharge | undefined;
}) {
  const qc = useQueryClient();
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [dueDate, setDueDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    return localDateKey(date);
  });
  const review = useMutation({
    mutationFn: () => reviewUtilityBill(bill.id, decision === "approve", note, dueDate),
    onSuccess: (status) => {
      toast.success(
        status === "approved" ? "Расчёт утверждён" : "Показания возвращены на исправление",
      );
      setDecision(null);
      void qc.invalidateQueries({ queryKey: ["utilities"] });
      void qc.invalidateQueries({ queryKey: ["rent-charges"] });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const openPhoto = async (path: string) => {
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const url = await getSignedUrl(UTILITY_READING_PHOTOS, path, 120);
      if (tab) tab.location.href = url;
      else toast.error("Разрешите открытие новой вкладки для просмотра фотографии");
    } catch (error) {
      tab?.close();
      toast.error(error instanceof Error ? error.message : "Не удалось открыть фотографию");
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold capitalize">{formatMonth(bill.period_start)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Отправлено {formatDate(bill.created_at)}
            </p>
          </div>
          <Badge variant={bill.status === "rejected" ? "destructive" : "secondary"}>
            {utilityStatusLabels[bill.status]}
          </Badge>
        </div>
        <div className="divide-y rounded-xl border px-4">
          {items.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium">{item.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.kind === "meter" ? (
                    <>
                      {formatUtilityValue(Number(item.previous_reading))} →{" "}
                      {formatUtilityValue(Number(item.reading))} {item.unit}
                      <br />
                      {formatUtilityValue(
                        Number(item.reading) - Number(item.previous_reading),
                      )}{" "}
                      {item.unit} × {formatUtilityValue(Number(item.rate))} ₽
                    </>
                  ) : (
                    "Фиксированный платёж за месяц"
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {item.photo_path && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Фото счётчика ${item.name}`}
                    onClick={() => void openPhoto(item.photo_path!)}
                  >
                    <Camera className="h-4 w-4" />
                  </Button>
                )}
                <span className="whitespace-nowrap text-sm font-medium">
                  {formatUtilityMoney(Number(item.amount))}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">Коммунальные услуги, итого</span>
          <span className="text-xl font-semibold">{formatUtilityMoney(Number(bill.amount))}</span>
        </div>
        {bill.review_note && (
          <p
            className={`rounded-lg p-3 text-sm ${bill.status === "rejected" ? "bg-destructive/5 text-destructive" : "bg-muted"}`}
          >
            {bill.status === "rejected" ? "Причина возврата: " : "Комментарий: "}
            {bill.review_note}
          </p>
        )}
        {bill.status === "pending" && canReview && (
          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button
              onClick={() => {
                setNote("");
                setDecision("approve");
              }}
            >
              <Check className="mr-2 h-4 w-4" />
              Утвердить расчёт
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setNote("");
                setDecision("reject");
              }}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Вернуть на исправление
            </Button>
          </div>
        )}
        {bill.status === "approved" && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm">
            <p className="flex items-center gap-2 text-muted-foreground">
              <CalendarClock className="h-4 w-4" />
              {charge
                ? charge.paid_at
                  ? "Оплачено"
                  : `До ${formatDate(charge.due_date)} · остаток ${formatUtilityMoney(getRentChargeBalance(charge))}`
                : Number(bill.amount) === 0
                  ? "Начисление не требуется"
                  : "Начисление добавлено в платежи"}
            </p>
            {bill.charge_id && (
              <Button variant="outline" size="sm" asChild>
                <Link to={canReview ? "/payments" : "/cabinet"}>
                  {canReview ? "Открыть платежи" : "Открыть оплату"}
                </Link>
              </Button>
            )}
          </div>
        )}
      </CardContent>
      <Dialog
        open={decision !== null}
        onOpenChange={(open) => {
          if (!open && !review.isPending) setDecision(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decision === "approve"
                ? "Утвердить коммунальный расчёт"
                : "Вернуть показания на исправление"}
            </DialogTitle>
            <DialogDescription>
              {formatMonth(bill.period_start)} · {formatUtilityMoney(Number(bill.amount))}
              {decision === "approve"
                ? ". После утверждения сумма появится отдельным начислением в платежах."
                : ". Арендатор увидит причину и сможет отправить исправленный расчёт."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              review.mutate();
            }}
          >
            {decision === "approve" && (
              <div className="space-y-2">
                <Label htmlFor={`utility-due-${bill.id}`}>Оплатить до</Label>
                <Input
                  id={`utility-due-${bill.id}`}
                  type="date"
                  min={localDateKey()}
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  required
                  disabled={review.isPending}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor={`utility-note-${bill.id}`}>
                {decision === "reject" ? "Причина возврата" : "Комментарий, необязательно"}
              </Label>
              <Textarea
                id={`utility-note-${bill.id}`}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={1000}
                required={decision === "reject"}
                disabled={review.isPending}
              />
            </div>
            {review.isError && (
              <p role="alert" className="text-sm text-destructive">
                {review.error.message}
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={review.isPending || (decision === "reject" && !note.trim())}
            >
              {review.isPending
                ? "Сохраняем…"
                : decision === "approve"
                  ? "Утвердить"
                  : "Отправить на исправление"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
