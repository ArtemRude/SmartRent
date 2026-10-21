import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Agreement } from "@/lib/queries";
import { localDateKey } from "@/lib/domain";
import { nextRentMonth, rentAt, type LeaseAmendment } from "@/lib/lease-changes";
import { saveLeaseChange } from "@/lib/lease-change-queries";
export function LeaseChangeEditor({
  agreement,
  initial,
  minimum,
  onClose,
  onSaved,
}: {
  agreement: Agreement;
  initial: LeaseAmendment | null;
  minimum: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [effective, setEffective] = useState(initial?.effective_from ?? minimum);
  const [endDate, setEndDate] = useState(initial?.end_date ?? agreement.end_date);
  const [rate, setRate] = useState(String(initial?.monthly_payment ?? rentAt(agreement, minimum)));
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      setError("");
      const normalized = rate.trim().replace(",", ".");
      if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(normalized) || Number(normalized) <= 0)
        throw new Error("Укажите положительную ставку с точностью до копеек");
      if (effective < nextRentMonth(localDateKey()) || !effective.endsWith("-01"))
        throw new Error("Выберите первое число будущего месяца");
      if (endDate < agreement.end_date || endDate < effective)
        throw new Error("Срок должен быть не короче текущего и включать месяц изменения");
      await saveLeaseChange(agreement.id, initial, {
        effective_from: effective,
        monthly_payment: Number(normalized),
        end_date: endDate,
        note: note.trim(),
      });
    },
    onSuccess: () => {
      toast.success("Предложение сохранено");
      onSaved();
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Изменить предложение" : "Новые условия аренды"}</DialogTitle>
          <DialogDescription>
            Черновик не меняет договор. Новые условия вступят в расчёт только после подтверждения
            арендатора.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="change-effective">Новая ставка с</Label>
            <Input
              id="change-effective"
              type="date"
              min={minimum}
              value={effective}
              required
              onChange={(e) => setEffective(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Первое число будущего месяца. Неполный месяц автоматически не пересчитывается.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="change-rate">Арендная плата, ₽/мес.</Label>
            <Input
              id="change-rate"
              inputMode="decimal"
              required
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="change-end">Новая дата окончания</Label>
            <Input
              id="change-end"
              type="date"
              min={agreement.end_date > effective ? agreement.end_date : effective}
              value={endDate}
              required
              onChange={(e) => setEndDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Для продления выберите более позднюю дату. Для изменения только ставки оставьте
              текущую.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="change-note">Комментарий к изменению</Label>
            <Textarea
              id="change-note"
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Сохраняем…" : "Сохранить предложение"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
