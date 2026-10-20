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
import { FileUploadField } from "@/components/FileUploadField";
import { useAuth } from "@/hooks/auth-context";
import { localDateKey } from "@/lib/domain";
import {
  expenseCategories,
  parseExpenseAmount,
  type ExpenseCategory,
  type PropertyExpense,
} from "@/lib/property-finances";
import { savePropertyExpense } from "@/lib/property-finance-queries";
import { downloadFile, EXPENSE_RECEIPTS, removeFile, uploadFile } from "@/lib/storage";
import type { Property } from "@/lib/queries";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
export function PropertyExpenseEditor({
  initial,
  properties,
  propertyId,
  markPaid,
  onClose,
  onSaved,
}: {
  initial: PropertyExpense | null;
  properties: Property[];
  propertyId: string;
  markPaid: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [property, setProperty] = useState(initial?.property_id ?? propertyId);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState<ExpenseCategory>(initial?.category ?? "repair");
  const [status, setStatus] = useState<"planned" | "paid">(
    initial?.status === "paid" || markPaid ? "paid" : "planned",
  );
  const [plannedDate, setPlannedDate] = useState(initial?.planned_date ?? localDateKey());
  const [plannedAmount, setPlannedAmount] = useState(String(initial?.planned_amount ?? ""));
  const [paidDate, setPaidDate] = useState(initial?.paid_date ?? localDateKey());
  const [paidAmount, setPaidAmount] = useState(
    String(initial?.paid_amount ?? initial?.planned_amount ?? ""),
  );
  const [note, setNote] = useState(initial?.note ?? "");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const [error, setError] = useState("");
  const lockedPlan = Boolean(initial && status === "paid");
  const mutation = useMutation({
    mutationFn: async () => {
      setError("");
      const planned = parseExpenseAmount(plannedAmount),
        actual = parseExpenseAmount(paidAmount);
      if (!property || !title.trim() || planned === null)
        throw new Error(
          "Выберите объект, укажите название и положительную плановую сумму до копеек",
        );
      if (status === "paid" && (actual === null || !paidDate || paidDate > localDateKey()))
        throw new Error("Укажите положительную сумму и дату фактической оплаты не позднее сегодня");
      if (initial?.status === "paid" && !reason.trim())
        throw new Error("Укажите причину исправления оплаченного расхода");
      if (!plannedDate) throw new Error("Укажите плановую дату");
      let receipt = removeReceipt ? null : (initial?.receipt_file ?? null);
      if (status === "paid" && file) {
        receipt = uploaded ?? (await uploadFile(EXPENSE_RECEIPTS, `${user!.id}/${property}`, file));
        setUploaded(receipt);
      }
      await savePropertyExpense(
        property,
        {
          title: title.trim(),
          category,
          planned_amount: planned,
          planned_date: plannedDate,
          status,
          paid_amount: status === "paid" ? actual : null,
          paid_date: status === "paid" ? paidDate : null,
          receipt_file: status === "paid" ? receipt : null,
          note: note.trim(),
        },
        initial,
        reason,
      );
    },
    onSuccess: () => {
      toast.success("Расход сохранён");
      onSaved();
    },
    onError: (e: Error) => setError(e.message),
  });
  const close = () => {
    if (mutation.isPending) return;
    if (uploaded) void removeFile(EXPENSE_RECEIPTS, uploaded).catch(() => {});
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {initial?.status === "paid"
              ? "Исправить оплаченный расход"
              : markPaid
                ? "Оплатить расход"
                : initial
                  ? "Изменить расход"
                  : "Новый расход"}
          </DialogTitle>
          <DialogDescription>
            Сохраните план и укажите факт после оплаты. Изменения останутся в истории.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="expense-property">Объект</Label>
            <select
              id="expense-property"
              className={selectClass}
              value={property}
              disabled={Boolean(initial) || mutation.isPending || Boolean(uploaded)}
              onChange={(e) => setProperty(e.target.value)}
              required
            >
              <option value="" disabled>
                Выберите объект
              </option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="expense-title">Название расхода</Label>
            <Input
              id="expense-title"
              value={title}
              maxLength={200}
              required
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="expense-category">Категория</Label>
              <select
                id="expense-category"
                className={selectClass}
                value={category}
                onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
              >
                {Object.entries(expenseCategories).map(([id, label]) => (
                  <option value={id} key={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="expense-status">Состояние</Label>
              <select
                id="expense-status"
                className={selectClass}
                value={status}
                disabled={initial?.status === "paid"}
                onChange={(e) => setStatus(e.target.value as "paid" | "planned")}
              >
                <option value="planned">Запланирован</option>
                <option value="paid">Оплачен</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="expense-plan-date">Плановая дата</Label>
              <Input
                id="expense-plan-date"
                type="date"
                min="2000-01-01"
                max="2100-12-31"
                value={plannedDate}
                disabled={lockedPlan}
                required
                onChange={(e) => setPlannedDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expense-plan-amount">Плановая сумма, ₽</Label>
              <Input
                id="expense-plan-amount"
                inputMode="decimal"
                value={plannedAmount}
                disabled={lockedPlan}
                required
                onChange={(e) => setPlannedAmount(e.target.value)}
              />
            </div>
          </div>
          {lockedPlan && (
            <p className="text-xs text-muted-foreground">
              Исходный план сохраняется для сравнения с фактом.
            </p>
          )}
          {status === "paid" && (
            <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="expense-paid-date">Дата оплаты</Label>
                  <Input
                    id="expense-paid-date"
                    type="date"
                    min="2000-01-01"
                    max={localDateKey()}
                    value={paidDate}
                    required
                    onChange={(e) => setPaidDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expense-paid-amount">Оплачено, ₽</Label>
                  <Input
                    id="expense-paid-amount"
                    inputMode="decimal"
                    value={paidAmount}
                    required
                    onChange={(e) => setPaidAmount(e.target.value)}
                  />
                </div>
              </div>
              {initial?.receipt_file && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0"
                    onClick={() =>
                      void downloadFile(
                        EXPENSE_RECEIPTS,
                        initial.receipt_file!,
                        "expense-receipt",
                      ).catch((e: Error) => toast.error(e.message))
                    }
                  >
                    Открыть приложенный чек
                  </Button>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={removeReceipt}
                      onChange={(e) => setRemoveReceipt(e.target.checked)}
                    />
                    Убрать приложенный чек
                  </label>
                </div>
              )}
              <FileUploadField
                id="expense-receipt"
                file={file}
                onFileChange={(value) => {
                  if (uploaded) void removeFile(EXPENSE_RECEIPTS, uploaded).catch(() => {});
                  setUploaded(null);
                  setFile(value);
                }}
                accept="application/pdf,image/jpeg,image/png,image/webp"
                description="Чек или документ: PDF, JPG, PNG, WebP до 10 МБ"
                buttonLabel="Приложить чек"
                disabled={mutation.isPending}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="expense-note">Примечание</Label>
            <Textarea
              id="expense-note"
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {initial?.status === "paid" && (
            <div className="space-y-2">
              <Label htmlFor="expense-reason">Причина исправления</Label>
              <Textarea
                id="expense-reason"
                maxLength={2000}
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={mutation.isPending}>
              Отмена
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Сохраняем…" : "Сохранить расход"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
