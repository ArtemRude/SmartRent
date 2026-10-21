import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ListingPhoto } from "./ListingPhoto";
import type { PropertyHub, PropertyListing } from "@/lib/recruitment";
import { saveListing } from "@/lib/recruitment-queries";
import { LISTING_PHOTOS, uploadFile } from "@/lib/storage";
export function ListingEditor({
  hub,
  listing,
  onClose,
  onSaved,
}: {
  hub: PropertyHub;
  listing: PropertyListing | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const draft = listing?.draft;
  const [unit, setUnit] = useState(listing?.unit_id ?? "");
  const [values, setValues] = useState({
    title: draft?.title ?? "",
    location: draft?.location ?? "",
    description: draft?.description ?? "",
    monthly_rent: String(draft?.monthly_rent ?? ""),
    deposit: String(draft?.deposit ?? 0),
    area: String(draft?.area ?? 0),
    available_from: draft?.available_from ?? new Date().toLocaleDateString("en-CA"),
    contact_name: draft?.contact_name ?? "",
  });
  const [photos, setPhotos] = useState(draft?.photos ?? []);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () =>
      saveListing(
        hub.property.id,
        listing?.id ?? null,
        unit || null,
        {
          ...values,
          monthly_rent: values.monthly_rent.replace(",", "."),
          deposit: values.deposit.replace(",", "."),
          area: values.area.replace(",", "."),
          photos,
        },
        listing?.revision ?? null,
      ),
    onSuccess: () => {
      toast.success(
        listing
          ? "Черновик сохранён. Для изменения карточки нажмите «Опубликовать»."
          : "Черновик создан. Откройте его, чтобы добавить фотографии.",
      );
      onSaved();
    },
    onError: (e: Error) => setError(e.message),
  });
  const field = (key: keyof typeof values, label: string, type = "text") => (
    <div className="space-y-1.5">
      <Label htmlFor={`listing-${key}`}>{label}</Label>
      <Input
        id={`listing-${key}`}
        type={type}
        value={values[key]}
        onChange={(e) => setValues({ ...values, [key]: e.target.value })}
        required={!["contact_name"].includes(key)}
        maxLength={key === "location" ? 300 : key === "title" ? 200 : undefined}
      />
    </div>
  );
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !save.isPending && !uploading) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{listing ? "Карточка для публикации" : "Новая публикация"}</DialogTitle>
          <DialogDescription>
            Заполните сведения для посетителей. Внутреннее описание, точный адрес и фотографии
            объекта сюда автоматически не переносятся.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            save.mutate();
          }}
        >
          {!listing && (
            <div className="space-y-1.5">
              <Label htmlFor="listing-unit">Что сдаём</Label>
              <select
                id="listing-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="">Весь объект</option>
                {hub.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {field("title", "Название объявления")}
          {field("location", "Расположение для посетителей")}
          <div className="space-y-1.5">
            <Label htmlFor="listing-description">Описание для посетителей</Label>
            <Textarea
              id="listing-description"
              value={values.description}
              onChange={(e) => setValues({ ...values, description: e.target.value })}
              maxLength={4000}
              rows={5}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("monthly_rent", "Аренда в месяц, ₽")}
            {field("deposit", "Депозит, ₽")}
            {field("area", "Площадь, м²")}
            {field("available_from", "Доступно с", "date")}
          </div>
          {field("contact_name", "Как представить контактное лицо")}
          <div className="space-y-3">
            <Label htmlFor="listing-photos">Фотографии для посетителей</Label>
            {!listing ? (
              <p className="text-sm text-muted-foreground">
                Сначала сохраните черновик. После этого можно загрузить отдельные фотографии для
                публикации.
              </p>
            ) : (
              <>
                <Input
                  id="listing-photos"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  disabled={uploading || save.isPending || photos.length >= 8}
                  onChange={async (e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    if (photos.length + files.length > 8) {
                      setError("Не больше 8 фотографий");
                      return;
                    }
                    setUploading(true);
                    setError("");
                    try {
                      const added: string[] = [];
                      for (const file of files)
                        added.push(await uploadFile(LISTING_PHOTOS, listing.public_id, file));
                      setPhotos((prev) => [...prev, ...added]);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Не удалось загрузить фото");
                    } finally {
                      setUploading(false);
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  JPG, PNG, WebP, до 8 МБ. До 8 фото. Перед публикацией проверьте, что на фото нет
                  личных документов.
                </p>
              </>
            )}
            <div className="grid grid-cols-2 gap-3">
              {photos.map((path, i) => (
                <div key={path} className="space-y-1">
                  <ListingPhoto path={path} alt={`Фотография ${i + 1}`} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPhotos(photos.filter((p) => p !== path))}
                  >
                    Убрать из карточки
                  </Button>
                </div>
              ))}
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={save.isPending || uploading}
            >
              Отмена
            </Button>
            <Button disabled={save.isPending || uploading}>
              {uploading ? "Загрузка…" : save.isPending ? "Сохранение…" : "Сохранить черновик"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
