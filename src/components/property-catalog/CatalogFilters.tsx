import { useState } from "react";
import { Search, SlidersHorizontal, LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { propertyTypeLabels } from "@/lib/domain";
import {
  catalogFilterError,
  catalogSortLabels,
  emptyCatalogSearch,
  hasCatalogFilters,
  occupancyLabels,
  type CatalogSearch,
  type CatalogScope,
} from "@/lib/property-catalog";
const selectClass = "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";
export function CatalogFilters({
  search,
  scope,
  onChange,
  pending = false,
}: {
  search: CatalogSearch;
  scope: CatalogScope;
  onChange: (v: CatalogSearch) => void;
  pending?: boolean;
}) {
  const [draft, setDraft] = useState(search);
  const [error, setError] = useState("");
  const input = (key: "price_min" | "price_max" | "area_min" | "area_max", label: string) => (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={`catalog-${key}`}>{label}</Label>
      <Input
        id={`catalog-${key}`}
        type="number"
        min={0}
        max={999999999}
        step="0.01"
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        placeholder="Не важно"
      />
    </div>
  );
  return (
    <fieldset
      disabled={pending}
      className="min-w-0 space-y-4 rounded-2xl border bg-card p-4 shadow-sm disabled:opacity-70 sm:p-5"
    >
      <legend className="sr-only">Параметры каталога</legend>
      <div role="group" aria-label="Категории объектов" className="flex flex-wrap gap-2">
        {Object.entries({ all: "Все объекты", ...propertyTypeLabels }).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={search.type === value ? "default" : "outline"}
            aria-pressed={search.type === value}
            onClick={() => onChange({ ...search, type: value })}
          >
            {label}
          </Button>
        ))}
      </div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const problem = catalogFilterError(draft);
          setError(problem ?? "");
          if (!problem) onChange({ ...draft, q: draft.q.trim() });
        }}
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Поиск объектов"
              className="pl-9"
              value={draft.q}
              onChange={(e) => setDraft({ ...draft, q: e.target.value })}
              placeholder={
                scope === "public" ? "Город, район или название" : "Название, адрес или описание"
              }
              maxLength={200}
            />
          </div>
          <Button type="submit">Найти</Button>
        </div>
        <details
          className="group"
          open={
            Boolean(
              search.price_min ||
              search.price_max ||
              search.area_min ||
              search.area_max ||
              search.status !== "all" ||
              search.occupancy !== "all" ||
              search.publication !== "all",
            ) || undefined
          }
        >
          <summary className="flex w-fit cursor-pointer list-none items-center gap-2 text-sm font-medium">
            <SlidersHorizontal className="h-4 w-4" />
            <span>Фильтры</span>
            <span className="text-xs text-muted-foreground">
              Цена, площадь{scope === "internal" ? ", состояние и аренда" : ""}
            </span>
          </summary>
          <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {input("price_min", "Цена от, ₽/мес.")}
            {input("price_max", "Цена до, ₽/мес.")}
            {input("area_min", "Площадь от, м²")}
            {input("area_max", "Площадь до, м²")}
            {scope === "internal" && (
              <>
                <div className="col-span-2 space-y-1.5 lg:col-span-1">
                  <Label htmlFor="catalog-status">Состояние объекта</Label>
                  <select
                    id="catalog-status"
                    className={selectClass}
                    value={draft.status}
                    onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                  >
                    <option value="all">Все состояния</option>
                    <option value="active">В работе</option>
                    <option value="archived">В архиве</option>
                  </select>
                </div>
                <div className="col-span-2 space-y-1.5 lg:col-span-1">
                  <Label htmlFor="catalog-occupancy">Аренда</Label>
                  <select
                    id="catalog-occupancy"
                    className={selectClass}
                    value={draft.occupancy}
                    onChange={(e) => setDraft({ ...draft, occupancy: e.target.value })}
                  >
                    <option value="all">Любое состояние аренды</option>
                    {Object.entries(occupancyLabels).map(([v, label]) => (
                      <option value={v} key={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 space-y-1.5 lg:col-span-1">
                  <Label htmlFor="catalog-publication">Публикация</Label>
                  <select
                    id="catalog-publication"
                    className={selectClass}
                    value={draft.publication}
                    onChange={(e) => setDraft({ ...draft, publication: e.target.value })}
                  >
                    <option value="all">Все объекты</option>
                    <option value="published">Есть публичное предложение</option>
                    <option value="unpublished">Без публичного предложения</option>
                  </select>
                </div>
              </>
            )}
          </div>
          <Button type="submit" variant="outline" className="mt-4">
            Применить фильтры
          </Button>
        </details>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
      <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-4">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="catalog-sort">Сортировка</Label>
          <select
            id="catalog-sort"
            className={selectClass}
            value={search.sort}
            onChange={(e) => onChange({ ...search, sort: e.target.value as CatalogSearch["sort"] })}
          >
            {Object.entries(catalogSortLabels).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasCatalogFilters(search) && (
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                onChange({ ...emptyCatalogSearch, view: search.view, sort: search.sort })
              }
            >
              Сбросить фильтры
            </Button>
          )}
          <div role="group" aria-label="Вид каталога" className="flex rounded-lg border p-1">
            <Button
              size="icon"
              type="button"
              variant={search.view === "grid" ? "secondary" : "ghost"}
              aria-label="Плитка"
              aria-pressed={search.view === "grid"}
              onClick={() => onChange({ ...search, view: "grid" })}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              type="button"
              variant={search.view === "list" ? "secondary" : "ghost"}
              aria-label="Список"
              aria-pressed={search.view === "list"}
              onClick={() => onChange({ ...search, view: "list" })}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </fieldset>
  );
}
