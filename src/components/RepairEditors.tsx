import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { localDateKey } from "@/lib/domain";
import {
  buildRepairEstimate,
  repairMoney,
  type RepairJob,
  type RepairContractor,
  type RepairsOverview,
  type RepairRequest,
  type EstimateInput,
} from "@/lib/repairs";
import { saveRepairContractor, saveRepairJob } from "@/lib/repair-queries";
export const repairSelectClass =
  "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";

export function ContractorEditor({
  ownerId,
  initial,
  onClose,
  onSaved,
}: {
  ownerId: string;
  initial: RepairContractor | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? ""),
    [specialty, setSpecialty] = useState(initial?.specialty ?? ""),
    [phone, setPhone] = useState(initial?.phone ?? ""),
    [email, setEmail] = useState(initial?.email ?? ""),
    [note, setNote] = useState(initial?.note ?? ""),
    [active, setActive] = useState(initial?.active ?? true);
  const save = useMutation({
    mutationFn: () =>
      saveRepairContractor(ownerId, initial, { name, specialty, phone, email, note, active }),
    onSuccess: onSaved,
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
          <DialogTitle>{initial ? "Изменить исполнителя" : "Новый исполнитель"}</DialogTitle>
          <DialogDescription>
            Контакты для организации работ. Исполнителю не создаётся доступ в приложение.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="contractor-name">Имя или организация</Label>
            <Input
              id="contractor-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="contractor-specialty">Специализация</Label>
            <Input
              id="contractor-specialty"
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              maxLength={100}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="contractor-phone">Телефон исполнителя</Label>
              <Input
                id="contractor-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={40}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="contractor-email">Email исполнителя</Label>
              <Input
                id="contractor-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="contractor-note">Заметка в справочнике</Label>
            <Textarea
              id="contractor-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
            />
          </div>
          {initial && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Действующий исполнитель
            </label>
          )}
          {save.isError && (
            <p role="alert" className="text-sm text-destructive">
              {save.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              Отмена
            </Button>
            <Button disabled={save.isPending}>Сохранить исполнителя</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RepairJobEditor({
  overview,
  initial,
  request,
  propertyId,
  onClose,
  onSaved,
}: {
  overview: RepairsOverview;
  initial: RepairJob | null;
  request: RepairRequest | null;
  propertyId?: string | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const properties = overview.properties.filter((p) => ["owner", "manager"].includes(p.role));
  const preferredProperty =
    properties.find((p) => p.id === propertyId) ??
    properties.find((p) => p.role === "owner") ??
    properties[0];
  const [property, setProperty] = useState(
    initial?.property_id ?? request?.property_id ?? preferredProperty?.id ?? "",
  );
  const selected = properties.find((p) => p.id === property);
  const [title, setTitle] = useState(initial?.title ?? request?.title ?? ""),
    [description, setDescription] = useState(initial?.description ?? request?.description ?? "");
  const [requestId, setRequestId] = useState(initial?.request_id ?? request?.id ?? "");
  const [contractor, setContractor] = useState(initial?.contractor_id ?? "");
  const [start, setStart] = useState(initial?.scheduled_date ?? localDateKey()),
    [due, setDue] = useState(initial?.due_date ?? localDateKey());
  const [items, setItems] = useState<EstimateInput[]>(
    initial?.estimate_items.map((i) => ({
      name: i.name,
      quantity: String(i.quantity),
      unit_price: String(i.unit_price),
    })) ?? [{ name: "", quantity: "1", unit_price: "" }],
  );
  let preview: number | null = null;
  try {
    preview = buildRepairEstimate(items).total;
  } catch {
    /* Inputs are validated when saved. */
  }
  const save = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("Выберите доступный объект");
      if (start > due) throw new Error("Дата окончания не может быть раньше начала");
      return saveRepairJob(property, initial, {
        title,
        description,
        request_id: requestId || null,
        contractor_id: contractor || null,
        scheduled_date: start,
        due_date: due,
        estimate_items: buildRepairEstimate(items).items,
      });
    },
    onSuccess: onSaved,
  });
  const changeItem = (index: number, field: keyof EstimateInput, value: string) =>
    setItems((current) =>
      current.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Изменить смету" : "Новая ремонтная работа"}</DialogTitle>
          <DialogDescription>
            Сначала сохраните черновик, затем отправьте смету собственнику на согласование.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="repair-property">Объект ремонта</Label>
            <select
              id="repair-property"
              className={repairSelectClass}
              value={property}
              disabled={Boolean(initial || request)}
              onChange={(e) => {
                setProperty(e.target.value);
                setContractor("");
                setRequestId("");
              }}
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="repair-request">Связанная заявка</Label>
            <select
              id="repair-request"
              className={repairSelectClass}
              value={requestId}
              disabled={Boolean(initial || request)}
              onChange={(e) => setRequestId(e.target.value)}
            >
              <option value="">Плановое обслуживание без заявки</option>
              {initial?.request_id && (
                <option value={initial.request_id}>
                  {initial.request_title ?? "Исходная заявка"}
                </option>
              )}
              {overview.requests
                .filter((r) => r.property_id === property)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="repair-title">Название работы</Label>
            <Input
              id="repair-title"
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="repair-description">Описание работы</Label>
            <Textarea
              id="repair-description"
              value={description}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              После согласования арендатор видит название, описание, сроки и результат ремонта по
              своему обращению.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="repair-contractor">Исполнитель</Label>
            {selected?.role === "owner" ? (
              <select
                id="repair-contractor"
                className={repairSelectClass}
                value={contractor}
                onChange={(e) => setContractor(e.target.value)}
              >
                <option value="">Будет назначен позже</option>
                {overview.contractors
                  .filter(
                    (c) =>
                      c.owner_id === selected.owner_id &&
                      (c.active || c.id === initial?.contractor_id),
                  )
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {!c.active ? " (архив)" : ""}
                    </option>
                  ))}
              </select>
            ) : (
              <p className="text-sm">
                {initial?.contractor_snapshot?.name ?? "Исполнителя назначит собственник"}
              </p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="repair-start">Начало работ</Label>
              <Input
                id="repair-start"
                type="date"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="repair-due">Срок выполнения</Label>
              <Input
                id="repair-due"
                type="date"
                required
                min={start}
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </div>
          </div>
          <fieldset className="space-y-3">
            <legend className="mb-2 font-medium">Смета</legend>
            {items.map((item, index) => (
              <div key={index} className="space-y-2 rounded-xl border p-3">
                <div className="space-y-1">
                  <Label htmlFor={`estimate-name-${index}`}>
                    Строка {index + 1}: работа или материал
                  </Label>
                  <Input
                    id={`estimate-name-${index}`}
                    required
                    maxLength={120}
                    value={item.name}
                    onChange={(e) => changeItem(index, "name", e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`estimate-quantity-${index}`}>Количество {index + 1}</Label>
                    <Input
                      id={`estimate-quantity-${index}`}
                      inputMode="decimal"
                      required
                      value={item.quantity}
                      onChange={(e) => changeItem(index, "quantity", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`estimate-price-${index}`}>Цена {index + 1}, ₽</Label>
                    <Input
                      id={`estimate-price-${index}`}
                      inputMode="decimal"
                      required
                      value={item.unit_price}
                      onChange={(e) => changeItem(index, "unit_price", e.target.value)}
                    />
                  </div>
                </div>
                {items.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setItems((rows) => rows.filter((_, i) => i !== index))}
                  >
                    Удалить строку {index + 1}
                  </Button>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={items.length >= 30}
              onClick={() =>
                setItems((rows) => [...rows, { name: "", quantity: "1", unit_price: "" }])
              }
            >
              Добавить строку сметы
            </Button>
            <p className="font-medium">Итого: {repairMoney(preview)}</p>
          </fieldset>
          {save.isError && (
            <p role="alert" className="text-sm text-destructive">
              {save.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
              Отмена
            </Button>
            <Button disabled={save.isPending}>Сохранить смету</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
