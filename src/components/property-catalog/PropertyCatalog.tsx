import { useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, RefreshCw, SearchX, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/auth-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { CatalogFilters } from "./CatalogFilters";
import { CatalogCard, CatalogPhoto, CatalogFacts, CatalogObjectLink } from "./CatalogCard";
import {
  CatalogApiError,
  fetchPropertyCatalog,
  setCatalogPropertyStatus,
} from "@/lib/property-catalog-queries";
import {
  catalogFilters,
  catalogFilterError,
  emptyCatalogSearch,
  hasCatalogFilters,
  type CatalogItem,
  type CatalogSearch,
  type CatalogScope,
  type CatalogCursor,
} from "@/lib/property-catalog";
import { propertyTypeLabels } from "@/lib/domain";
import { cn } from "@/lib/utils";
export function PropertyCatalog({
  scope,
  search,
  onSearch,
  onAddUnit,
  onDelete,
}: {
  scope: CatalogScope;
  search: CatalogSearch;
  onSearch: (search: CatalogSearch) => void;
  onAddUnit?: ((id: string) => void) | undefined;
  onDelete?: ((id: string) => void) | undefined;
}) {
  const { user } = useAuth();
  const navigating = useRouterState({ select: (state) => state.isLoading });
  const client = useQueryClient();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [changing, setChanging] = useState<CatalogItem | null>(null);
  const [error, setError] = useState("");
  const problem = catalogFilterError(search);
  const q = useInfiniteQuery({
    queryKey: ["property-catalog", scope, user?.id, catalogFilters(search, scope)],
    initialPageParam: null as CatalogCursor | null,
    queryFn: ({ pageParam, signal }) => fetchPropertyCatalog(scope, search, pageParam, signal),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled: !problem && (scope === "public" || Boolean(user)),
    refetchInterval: scope === "internal" ? 5000 : 15000,
    retry: false,
  });
  const refresh = () => {
    for (const key of [
      "property-catalog",
      "properties",
      "property",
      "property-hub",
      "team-overview",
      "team-workspace",
      "public-listing",
      "recruitment",
    ])
      void client.invalidateQueries({ queryKey: [key] });
  };
  const action = useMutation({
    mutationFn: () =>
      setCatalogPropertyStatus(
        changing!.id,
        changing!.status,
        changing!.status === "archived" ? "active" : "archived",
      ),
    onSuccess: () => {
      toast.success(
        changing?.status === "archived" ? "Объект возвращён в работу" : "Объект перемещён в архив",
      );
      setChanging(null);
      setError("");
      refresh();
    },
    onError: (e: Error) => {
      setError(e.message);
      toast.error(e.message);
      refresh();
    },
  });
  const items =
    !q.isError && !problem
      ? [...new Map((q.data?.pages.flatMap((p) => p.items) ?? []).map((i) => [i.id, i])).values()]
      : [];
  const summary = q.data?.pages[0];
  const preview = items.find((i) => i.id === previewId);
  const canChange = changing && items.some((i) => i.id === changing.id && i.role === "owner");
  return (
    <section
      className="space-y-5"
      aria-label={scope === "public" ? "Каталог предложений аренды" : "Каталог доступных объектов"}
    >
      <CatalogFilters
        key={JSON.stringify(search)}
        search={search}
        scope={scope}
        onChange={onSearch}
        pending={navigating}
      />
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
      {!problem && q.isPending && (
        <div role="status" className="space-y-4">
          <p className="text-sm text-muted-foreground">Загружаем каталог…</p>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-80 animate-pulse rounded-2xl bg-secondary" />
            ))}
          </div>
        </div>
      )}
      {q.isError && (
        <div className="space-y-3 rounded-2xl border bg-card p-6">
          <p role="alert" className="text-sm">
            {q.error instanceof CatalogApiError && q.error.code === "PGRST202"
              ? "Каталог пока недоступен. Требуется обновление базы данных."
              : `Не удалось обновить каталог: ${q.error.message}`}
          </p>
          <Button variant="outline" onClick={() => void q.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Повторить загрузку
          </Button>
        </div>
      )}
      {q.isSuccess && !problem && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="status" className="text-sm text-muted-foreground">
              Найдено: <strong className="text-foreground">{summary?.total ?? 0}</strong>
              {scope === "internal" && summary && ` · Всего доступно: ${summary.all_total}`}
            </p>
            <Button
              variant="ghost"
              size="sm"
              disabled={q.isFetching}
              onClick={() => void q.refetch()}
            >
              <RefreshCw className={cn("mr-2 h-4 w-4", q.isFetching && "animate-spin")} />
              Обновить
            </Button>
          </div>
          {!items.length && (
            <div className="rounded-2xl border border-dashed bg-card px-5 py-12 text-center">
              {hasCatalogFilters(search) ? (
                <SearchX className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
              ) : (
                <Building2 className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
              )}
              <h2 className="text-lg font-semibold">
                {hasCatalogFilters(search)
                  ? "По этим условиям ничего не найдено"
                  : scope === "public"
                    ? "Предложений аренды пока нет"
                    : "Пока нет доступных объектов"}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                {hasCatalogFilters(search)
                  ? "Измените запрос или расширьте диапазон цены и площади."
                  : scope === "public"
                    ? "Здесь появятся предложения, которые собственники опубликуют для поиска арендаторов."
                    : "Добавьте первый объект или примите приглашение в команду собственника."}
              </p>
              {hasCatalogFilters(search) && (
                <Button
                  variant="outline"
                  className="mt-5"
                  onClick={() => onSearch({ ...emptyCatalogSearch, view: search.view })}
                >
                  Сбросить фильтры
                </Button>
              )}
            </div>
          )}
          <div
            data-testid="catalog-results"
            data-view={search.view}
            className={cn(
              "grid gap-5",
              search.view === "grid" ? "sm:grid-cols-2 xl:grid-cols-3" : "grid-cols-1",
            )}
          >
            {items.map((item) => (
              <CatalogCard
                key={item.id}
                item={item}
                view={search.view}
                onPreview={(i) => setPreviewId(i.id)}
                onStatus={(i) => {
                  setError("");
                  setChanging(i);
                }}
                onAddUnit={onAddUnit}
                onDelete={onDelete}
              />
            ))}
          </div>
          {q.hasNextPage && (
            <div className="space-y-2 py-3 text-center">
              <Button
                variant="outline"
                disabled={q.isFetching}
                onClick={() => void q.fetchNextPage()}
              >
                {q.isFetchingNextPage && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Показать
                ещё
              </Button>
              <p className="text-xs text-muted-foreground">
                Показано {items.length} из {summary?.total}
              </p>
            </div>
          )}
        </>
      )}
      {preview && (
        <CatalogPreview key={preview.id} item={preview} onClose={() => setPreviewId(null)} />
      )}
      {changing && canChange && (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!v && !action.isPending) setChanging(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {changing.status === "archived"
                  ? "Вернуть объект в работу?"
                  : "Переместить объект в архив?"}
              </DialogTitle>
              <DialogDescription>
                {changing.status === "archived"
                  ? "Объект снова появится среди объектов в работе. Предложения останутся снятыми с публикации, пока вы не опубликуете их на странице объекта."
                  : "Публичные предложения по объекту будут сняты с публикации. Договоры, начисления, обращения и история сохранятся. Архив не завершает действующую аренду."}
              </DialogDescription>
            </DialogHeader>
            <p className="break-words font-medium">{changing.title}</p>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={action.isPending}
                onClick={() => setChanging(null)}
              >
                Отмена
              </Button>
              <Button disabled={action.isPending} onClick={() => action.mutate()}>
                {action.isPending ? "Сохраняем…" : "Подтвердить"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
function CatalogPreview({ item, onClose }: { item: CatalogItem; onClose: () => void }) {
  const [photo, setPhoto] = useState(0);
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto p-0 sm:max-w-3xl">
        <div className="px-6 pt-6">
          <DialogHeader>
            <DialogTitle className="pr-7 text-xl">{item.title}</DialogTitle>
            <DialogDescription>
              {propertyTypeLabels[item.type]} · {item.location || "Адрес не указан"}
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="space-y-5 p-6 pt-0">
          <CatalogPhoto
            item={item}
            path={item.photos[photo]}
            className="aspect-[16/10] w-full rounded-xl"
          />
          {item.photos.length > 1 && (
            <div
              role="group"
              aria-label="Фотографии объекта"
              className="flex gap-2 overflow-x-auto"
            >
              {item.photos.map((path, i) => (
                <button
                  key={path}
                  type="button"
                  aria-label={`Фото ${i + 1}`}
                  aria-pressed={photo === i}
                  onClick={() => setPhoto(i)}
                  className={cn(
                    "w-20 shrink-0 overflow-hidden rounded-md border-2",
                    photo === i ? "border-primary" : "border-transparent",
                  )}
                >
                  <CatalogPhoto item={item} path={path} className="h-14 w-full" />
                </button>
              ))}
            </div>
          )}
          <CatalogFacts item={item} />
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
            {item.description || "Описание пока не добавлено."}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Закрыть
            </Button>
            <Button asChild>
              <CatalogObjectLink item={item} onClick={onClose}>
                Открыть полную страницу
              </CatalogObjectLink>
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
