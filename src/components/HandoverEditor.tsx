import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/auth-context";
import { localDateKey } from "@/lib/domain";
import { saveHandover } from "@/lib/handover-queries";
import {
  calculateDeposit,
  handoverChecks,
  parseHandoverMoney,
  type HandoverCheck,
  type HandoverKind,
  type LeaseHandover,
} from "@/lib/handovers";
import { HANDOVER_PHOTOS, uploadFile, removeFile } from "@/lib/storage";

export function HandoverEditor({
  agreementId,
  kind,
  initial,
  deposit,
  startDate,
  onClose,
  onSaved,
}: {
  agreementId: string;
  kind: HandoverKind;
  initial: LeaseHandover | null;
  deposit: number;
  startDate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [date, setDate] = useState(initial?.inspection_date ?? localDateKey());
  const [keys, setKeys] = useState(String(initial?.keys_count ?? 1));
  const [checklist, setChecklist] = useState<Record<HandoverCheck, boolean>>(
    initial?.checklist ?? { condition: false, inventory: false, meters: false, keys: false },
  );
  const [condition, setCondition] = useState(initial?.condition_note ?? "");
  const [meters, setMeters] = useState(initial?.meter_readings ?? "");
  const [received, setReceived] = useState(String(initial?.deposit_received ?? deposit));
  const [deductions, setDeductions] = useState(
    (initial?.deductions ?? []).map((item) => ({
      reason: item.reason,
      amount: String(item.amount),
    })),
  );
  const [photos, setPhotos] = useState(initial?.photos ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const save = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Войдите в аккаунт");
      if (!date || date < startDate || date > localDateKey())
        throw new Error("Укажите дату осмотра от начала аренды до сегодня");
      if (!/^\d{1,3}$/.test(keys) || Number(keys) > 100)
        throw new Error("Укажите количество ключей от 0 до 100");
      const amount = parseHandoverMoney(received);
      const lines = deductions.map((item) => ({
        reason: item.reason.trim(),
        amount: parseHandoverMoney(item.amount),
      }));
      if (amount === null || lines.some((item) => item.amount === null || item.amount <= 0))
        throw new Error("Проверьте суммы депозита и удержаний");
      const validLines = lines.map((item) => ({ reason: item.reason, amount: item.amount! }));
      calculateDeposit(amount, validLines);
      if (photos.length + files.length > 12) throw new Error("Можно прикрепить до 12 фотографий");
      const uploaded: string[] = [];
      try {
        for (const file of files)
          uploaded.push(
            await uploadFile(HANDOVER_PHOTOS, `${user.id}/${agreementId}/${kind}`, file),
          );
        await saveHandover(
          agreementId,
          kind,
          {
            inspection_date: date,
            keys_count: Number(keys),
            checklist,
            condition_note: condition.trim(),
            meter_readings: meters.trim(),
            photos: [...photos, ...uploaded],
            deposit_received: amount,
            deductions: validLines,
          },
          initial?.revision ?? null,
        );
      } catch (error) {
        await Promise.allSettled(uploaded.map((path) => removeFile(HANDOVER_PHOTOS, path)));
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Черновик акта сохранён");
      onSaved();
    },
    onError: (error: Error) => {
      toast.error(error.message);
      void qc.invalidateQueries({ queryKey: ["handovers"] });
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {kind === "move_in" ? "Осмотр при заселении" : "Осмотр при выезде"}
          </DialogTitle>
        </DialogHeader>
        <fieldset disabled={save.isPending} className="min-w-0 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="handover-date">Дата осмотра</Label>
              <Input
                id="handover-date"
                type="date"
                min={startDate}
                max={localDateKey()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="handover-keys">Количество ключей</Label>
              <Input
                id="handover-keys"
                type="number"
                min="0"
                max="100"
                value={keys}
                onChange={(e) => setKeys(e.target.value)}
              />
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <p className="mb-3 text-sm font-medium">Чек-лист осмотра</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(handoverChecks).map(([key, title]) => (
                <label key={key} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={checklist[key as HandoverCheck]}
                    onCheckedChange={(value) =>
                      setChecklist((current) => ({ ...current, [key]: value === true }))
                    }
                  />
                  {title}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="handover-condition">Состояние помещения и имущества</Label>
            <Textarea
              id="handover-condition"
              maxLength={4000}
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              placeholder="Что осмотрели, есть ли повреждения, что изменилось с заселения"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="handover-meters">Показания счётчиков</Label>
            <Textarea
              id="handover-meters"
              maxLength={2000}
              value={meters}
              onChange={(e) => setMeters(e.target.value)}
              placeholder="Например: вода 103,2 м³; электричество 1250 кВт·ч. Если счётчиков нет, укажите это."
            />
            <p className="text-xs text-muted-foreground">
              Это фиксация при осмотре. Коммунальные начисления создаются отдельно в разделе
              коммунальных услуг.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="handover-deposit">Фактически полученный депозит, ₽</Label>
            <Input
              id="handover-deposit"
              inputMode="decimal"
              value={received}
              onChange={(e) => setReceived(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Сумма подставлена из акта заселения или договора. Укажите сумму, которую собственник
              действительно получил.
            </p>
          </div>
          {kind === "move_out" && (
            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-sm font-medium">Удержания из депозита</p>
              {deductions.map((item, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_auto]">
                  <Input
                    aria-label={`Причина удержания ${index + 1}`}
                    placeholder="Причина и повреждение"
                    maxLength={500}
                    value={item.reason}
                    onChange={(e) =>
                      setDeductions((current) =>
                        current.map((value, i) =>
                          i === index ? { ...value, reason: e.target.value } : value,
                        ),
                      )
                    }
                  />
                  <Input
                    aria-label={`Сумма удержания ${index + 1}`}
                    placeholder="Сумма, ₽"
                    inputMode="decimal"
                    value={item.amount}
                    onChange={(e) =>
                      setDeductions((current) =>
                        current.map((value, i) =>
                          i === index ? { ...value, amount: e.target.value } : value,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Удалить удержание ${index + 1}`}
                    onClick={() =>
                      setDeductions((current) => current.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={deductions.length >= 20}
                onClick={() => setDeductions((current) => [...current, { reason: "", amount: "" }])}
              >
                <Plus className="mr-2 h-4 w-4" />
                Добавить удержание
              </Button>
              <p className="text-xs text-muted-foreground">
                Удержания не закрывают арендные или коммунальные долги автоматически.
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="handover-photos">Фотографии осмотра (до 12)</Label>
            <Input
              id="handover-photos"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => {
                const selectedFiles = Array.from(e.currentTarget.files ?? []);
                setFiles((current) => [...current, ...selectedFiles]);
                e.target.value = "";
              }}
            />
            {photos.map((path, i) => (
              <div key={path} className="flex items-center justify-between gap-2 text-sm">
                <span>Сохранённое фото {i + 1}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPhotos((current) => current.filter((item) => item !== path))}
                >
                  Убрать из акта
                </Button>
              </div>
            ))}
            {files.map((file, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{file.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setFiles((current) => current.filter((_, index) => index !== i))}
                >
                  Убрать
                </Button>
              </div>
            ))}
          </div>
        </fieldset>
        <DialogFooter>
          <Button variant="outline" disabled={save.isPending} onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Сохраняем…" : "Сохранить черновик"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
