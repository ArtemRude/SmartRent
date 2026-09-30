import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { StorageImage } from "@/components/StorageImage";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DialogFooter,
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/auth-context";
import { PROPERTY_PHOTOS, removeFile, uploadFile } from "@/lib/storage";
import { propertyTypeLabels, type PropertyType } from "@/lib/domain";
import { fetchProperties, fetchUnits } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/properties")({
  head: () => ({
    meta: [
      { title: "Объекты — SmartRent" },
      { name: "description", content: "Квартиры, склады и коммерческие помещения собственника." },
      { property: "og:title", content: "Объекты — SmartRent" },
      { property: "og:description", content: "Управление объектами и помещениями." },
    ],
  }),
  component: PropertiesPage,
});

function PropertiesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const properties = useQuery({ queryKey: ["properties"], queryFn: fetchProperties });
  const units = useQuery({ queryKey: ["units"], queryFn: fetchUnits });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [type, setType] = useState<PropertyType>("apartment");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Нет сессии");
      let photos: string[] = [];
      try {
        if (file) photos = [await uploadFile(PROPERTY_PHOTOS, user.id, file)];
        const { error } = await supabase.from("properties").insert({
          owner_id: user.id,
          name,
          address,
          type,
          description: description || null,
          photos,
        });
        if (error) throw new Error(error.message);
      } catch (error) {
        if (photos[0]) await removeFile(PROPERTY_PHOTOS, photos[0]).catch(() => undefined);
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Объект добавлен");
      setOpen(false);
      setName("");
      setAddress("");
      setDescription("");
      setFile(null);
      void qc.invalidateQueries({ queryKey: ["properties"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("properties").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Объект удалён");
      setDeleteId(null);
      void qc.invalidateQueries({ queryKey: ["properties"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [unitProperty, setUnitProperty] = useState<string | null>(null);
  const [unitName, setUnitName] = useState("");
  const [unitArea, setUnitArea] = useState("");

  const addUnit = useMutation({
    mutationFn: async () => {
      if (!unitProperty) return;
      const { error } = await supabase.from("units").insert({
        property_id: unitProperty,
        name: unitName,
        area: unitArea ? Number(unitArea) : null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Помещение добавлено");
      setUnitName("");
      setUnitArea("");
      setUnitProperty(null);
      void qc.invalidateQueries({ queryKey: ["units"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title="Объекты"
        description="Квартиры, склады и коммерческие помещения"
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Добавить объект
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Новый объект</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="p-name">Название</Label>
                  <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-address">Адрес</Label>
                  <Input
                    id="p-address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-type">Тип</Label>
                  <Select value={type} onValueChange={(v) => setType(v as PropertyType)}>
                    <SelectTrigger id="p-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(propertyTypeLabels).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-desc">Описание</Label>
                  <Textarea
                    id="p-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-photo">Фото</Label>
                  <Input
                    id="p-photo"
                    type="file"
                    accept="image/*"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => create.mutate()} disabled={create.isPending || !name.trim()}>
                  Сохранить
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {properties.isPending && <p className="text-sm text-muted-foreground">Загружаем объекты…</p>}
      {properties.isError && (
        <p className="text-sm text-destructive">Не удалось загрузить объекты.</p>
      )}

      {properties.data?.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Пока нет объектов. Добавьте первый — и сможете подключить арендаторов и договоры.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(properties.data ?? []).map((p) => {
          const pUnits = (units.data ?? []).filter((u) => u.property_id === p.id);
          return (
            <Card key={p.id} className="overflow-hidden">
              <StorageImage
                bucket={PROPERTY_PHOTOS}
                path={p.photos?.[0]}
                alt={p.name}
                className="h-40 w-full"
              />
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">{p.name}</h2>
                    <p className="truncate text-sm text-muted-foreground">{p.address}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Удалить"
                    onClick={() => setDeleteId(p.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <p className="mt-2 inline-flex rounded-full bg-secondary px-2.5 py-0.5 text-xs">
                  {propertyTypeLabels[p.type]}
                </p>
                {p.description && (
                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{p.description}</p>
                )}

                <div className="mt-4 border-t border-border pt-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Помещения ({pUnits.length})
                  </p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {pUnits.map((u) => (
                      <li key={u.id} className="flex justify-between">
                        <span>{u.name}</span>
                        <span className="text-muted-foreground">
                          {u.area ? `${u.area} м²` : "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {unitProperty === p.id ? (
                    <div className="mt-3 space-y-2">
                      <Input
                        placeholder="Название помещения"
                        value={unitName}
                        onChange={(e) => setUnitName(e.target.value)}
                      />
                      <Input
                        placeholder="Площадь, м²"
                        inputMode="decimal"
                        value={unitArea}
                        onChange={(e) => setUnitArea(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => addUnit.mutate()} disabled={!unitName}>
                          Добавить
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setUnitProperty(null)}>
                          Отмена
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 px-0 text-primary"
                      onClick={() => setUnitProperty(p.id)}
                    >
                      <Plus className="mr-1 h-4 w-4" /> Помещение
                    </Button>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-4 w-full"
                  onClick={() =>
                    void navigate({
                      to: "/properties/$propertyId",
                      params: { propertyId: p.id },
                    })
                  }
                >
                  Открыть объект
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <AlertDialog open={Boolean(deleteId)} onOpenChange={(value) => !value && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить объект?</AlertDialogTitle>
            <AlertDialogDescription>
              Вместе с объектом будут удалены его помещения и договоры. Это действие нельзя
              отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && remove.mutate(deleteId)}
              disabled={remove.isPending}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
