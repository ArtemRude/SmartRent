import { useState } from "react";
import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { PropertyCatalog } from "@/components/property-catalog/PropertyCatalog";
import { readCatalogSearch, type CatalogSearch } from "@/lib/property-catalog";
import { Button } from "@/components/ui/button";
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

export const Route = createFileRoute("/_authenticated/properties")({
  head: () => ({
    meta: [
      { title: "Объекты — SmartRent" },
      { name: "description", content: "Квартиры, склады и коммерческие помещения собственника." },
      { property: "og:title", content: "Объекты — SmartRent" },
      { property: "og:description", content: "Управление объектами и помещениями." },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): Partial<CatalogSearch> => readCatalogSearch(s),
  component: PropertiesRoute,
});

function PropertiesRoute() {
  const pathname = useLocation({ select: (location) => location.pathname });
  return pathname.replace(/\/+$/, "").startsWith("/properties/") ? <Outlet /> : <PropertiesPage />;
}

function PropertiesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const search = readCatalogSearch(Route.useSearch());

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
      void qc.invalidateQueries({ queryKey: ["property-catalog"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("properties")
        .delete()
        .eq("id", id)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Объект недоступен или уже удалён. Обновите каталог.");
    },
    onSuccess: () => {
      toast.success("Объект удалён");
      setDeleteId(null);
      void qc.invalidateQueries({ queryKey: ["properties"] });
      void qc.invalidateQueries({ queryKey: ["property-catalog"] });
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
      void qc.invalidateQueries({ queryKey: ["property-catalog"] });
      void qc.invalidateQueries({ queryKey: ["property-hub"] });
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

      <PropertyCatalog
        scope="internal"
        search={search}
        onSearch={(s) => void navigate({ to: "/properties", search: s })}
        onAddUnit={(id) => {
          setUnitName("");
          setUnitArea("");
          setUnitProperty(id);
        }}
        onDelete={(id) => setDeleteId(id)}
      />
      <Dialog
        open={Boolean(unitProperty)}
        onOpenChange={(v) => {
          if (!v && !addUnit.isPending) setUnitProperty(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Добавить помещение</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              addUnit.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="unit-name">Название помещения</Label>
              <Input
                id="unit-name"
                value={unitName}
                onChange={(e) => setUnitName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unit-area">Площадь, м²</Label>
              <Input
                id="unit-area"
                type="number"
                min="0.01"
                step="0.01"
                value={unitArea}
                onChange={(e) => setUnitArea(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setUnitProperty(null)}
                disabled={addUnit.isPending}
              >
                Отмена
              </Button>
              <Button disabled={addUnit.isPending || !unitName.trim()}>Добавить</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
