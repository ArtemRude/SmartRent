import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { saveUtilityService } from "@/lib/utility-queries";
import { parseUtilityNumber, type UtilityKind, type UtilityService } from "@/lib/utilities";
import { localDateKey } from "@/lib/domain";
import type { Agreement } from "@/lib/queries";

export function UtilityServiceDialog({
  agreement,
  service,
  onClose,
}: {
  agreement: Agreement;
  service: UtilityService | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<UtilityKind>(service?.kind ?? "meter");
  const [name, setName] = useState(service?.name ?? "");
  const [unit, setUnit] = useState(service?.unit ?? "м³");
  const [rate, setRate] = useState(service ? String(service.rate) : "");
  const [initial, setInitial] = useState(service ? String(service.initial_reading) : "0");
  const [period, setPeriod] = useState(
    service?.start_period.slice(0, 7) ??
      [localDateKey().slice(0, 7), agreement.start_date.slice(0, 7)].sort().at(-1)!,
  );
  const [active, setActive] = useState(service?.active ?? true);
  const save = useMutation({
    mutationFn: async () => {
      const rateValue = parseUtilityNumber(rate);
      const initialValue = parseUtilityNumber(initial);
      if (
        rateValue === null ||
        rateValue <= 0 ||
        rateValue >= 100_000_000 ||
        rateValue !== Math.round(rateValue * 10000) / 10000
      )
        throw new Error("Укажите тариф больше нуля, до 4 знаков после запятой");
      if (kind === "fixed" && rateValue !== Math.round(rateValue * 100) / 100)
        throw new Error("Фиксированный платёж указывается с точностью до копеек");
      if (
        kind === "meter" &&
        (initialValue === null || initialValue !== Math.round(initialValue * 1000) / 1000)
      )
        throw new Error("Укажите начальные показания, до 3 знаков после запятой");
      if (!service && (!name.trim() || (kind === "meter" && !unit.trim()) || !period))
        throw new Error("Заполните название, единицу измерения и первый месяц");
      return saveUtilityService(agreement.id, {
        ...(service ? { id: service.id } : {}),
        name: name.trim(),
        kind,
        unit: kind === "fixed" ? "мес." : unit.trim(),
        rate: rateValue,
        initial_reading: kind === "meter" ? initialValue : 0,
        start_period: `${period}-01`,
        active,
      });
    },
    onSuccess: () => {
      toast.success(service ? "Тариф обновлён" : "Услуга добавлена");
      void qc.invalidateQueries({ queryKey: ["utilities"] });
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{service ? "Настройки услуги" : "Добавить коммунальную услугу"}</DialogTitle>
          <DialogDescription>
            {service
              ? "Новый тариф применяется к следующим расчётам. История сохраняет прежние тарифы и показания."
              : "Настройте счётчик или фиксированный ежемесячный платёж для этого договора."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <fieldset disabled={save.isPending} className="space-y-4">
            {!service && (
              <>
                <div className="space-y-2">
                  <Label>Тип услуги</Label>
                  <Select value={kind} onValueChange={(value) => setKind(value as UtilityKind)}>
                    <SelectTrigger aria-label="Тип услуги">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="meter">По счётчику</SelectItem>
                      <SelectItem value="fixed">Фиксированный платёж</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="utility-service-name">Название</Label>
                  <Input
                    id="utility-service-name"
                    placeholder={kind === "meter" ? "Холодная вода" : "Интернет"}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={100}
                    required
                  />
                </div>
                {kind === "meter" && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="utility-service-unit">Единица измерения</Label>
                      <Input
                        id="utility-service-unit"
                        placeholder="м³ или кВт·ч"
                        value={unit}
                        onChange={(event) => setUnit(event.target.value)}
                        maxLength={20}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="utility-service-initial">Начальные показания</Label>
                      <Input
                        id="utility-service-initial"
                        inputMode="decimal"
                        value={initial}
                        onChange={(event) => setInitial(event.target.value)}
                        required
                      />
                      <p className="text-xs text-muted-foreground">
                        Показания на начало первого расчётного месяца. Последующий расход считается
                        от утверждённых показаний.
                      </p>
                    </div>
                  </>
                )}
                <div className="space-y-2">
                  <Label htmlFor="utility-service-period">Первый расчётный месяц</Label>
                  <Input
                    id="utility-service-period"
                    type="month"
                    min={agreement.start_date.slice(0, 7)}
                    max={agreement.end_date.slice(0, 7)}
                    value={period}
                    onChange={(event) => setPeriod(event.target.value)}
                    required
                  />
                </div>
              </>
            )}
            {service && <p className="font-medium">{service.name}</p>}
            <div className="space-y-2">
              <Label htmlFor="utility-service-rate">
                {kind === "meter" ? `Тариф, ₽ за ${unit}` : "Платёж, ₽ в месяц"}
              </Label>
              <Input
                id="utility-service-rate"
                inputMode="decimal"
                value={rate}
                onChange={(event) => setRate(event.target.value)}
                required
              />
            </div>
            {service && (
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="utility-service-active">Включать в следующие расчёты</Label>
                <Switch id="utility-service-active" checked={active} onCheckedChange={setActive} />
              </div>
            )}
          </fieldset>
          {save.isError && (
            <p role="alert" className="text-sm text-destructive">
              {save.error.message}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={save.isPending}>
            {save.isPending ? "Сохраняем…" : service ? "Сохранить" : "Добавить услугу"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
