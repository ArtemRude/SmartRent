import { Link } from "@tanstack/react-router";
import {
  MapPin,
  ImageIcon,
  Ellipsis,
  Eye,
  Archive,
  ArchiveRestore,
  Plus,
  Trash2,
  FileText,
  Wrench,
  ArrowUpRight,
} from "lucide-react";
import { StorageImage } from "@/components/StorageImage";
import { ListingPhoto } from "@/components/ListingPhoto";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { formatDate, formatMoney, propertyTypeLabels } from "@/lib/domain";
import { occupancyLabels, type CatalogItem } from "@/lib/property-catalog";
import { cn } from "@/lib/utils";
export function CatalogPhoto({
  item,
  path,
  className,
}: {
  item: CatalogItem;
  path?: string | undefined;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden bg-secondary [&>img]:h-full [&>img]:w-full [&>img]:rounded-none [&>div]:h-full [&>div]:rounded-none",
        className,
      )}
    >
      {!path ? (
        <div
          role="img"
          aria-label="Фото пока нет"
          className="grid min-h-40 place-items-center bg-gradient-to-br from-primary/10 via-secondary to-muted"
        >
          <ImageIcon className="h-9 w-9 text-primary/40" />
        </div>
      ) : item.photo_bucket === "listing-photos" ? (
        <ListingPhoto path={path} alt={item.title} />
      ) : (
        <StorageImage
          bucket={item.photo_bucket}
          expiresIn={120}
          refreshInterval={90000}
          path={path}
          alt={item.title}
          className="h-full w-full"
        />
      )}
    </div>
  );
}
export function CatalogObjectLink({
  item,
  children,
  className,
  onClick,
}: {
  item: CatalogItem;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return item.scope === "public" ? (
    <Link
      to="/listing/$listingId"
      params={{ listingId: item.id }}
      className={className}
      onClick={onClick}
    >
      {children}
    </Link>
  ) : (
    <Link
      to="/objects/$propertyId"
      params={{ propertyId: item.id }}
      className={className}
      onClick={onClick}
    >
      {children}
    </Link>
  );
}
export function CatalogFacts({ item }: { item: CatalogItem }) {
  return (
    <div className="space-y-2">
      <p className="text-xl font-semibold tracking-tight">
        {item.price == null
          ? "Стоимость не указана"
          : `${item.price_source === "offer" ? "от " : ""}${formatMoney(item.price)}`}{" "}
        {item.price != null && (
          <span className="text-sm font-normal text-muted-foreground">/ мес.</span>
        )}
      </p>
      {item.price_source === "contract" && (
        <p className="text-xs text-muted-foreground">Сумма аренды по действующим договорам</p>
      )}
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
        <span>{item.area == null ? "Площадь не указана" : `${item.area} м²`}</span>
        {item.unit_count !== undefined && <span>Помещений: {item.unit_count}</span>}
        {item.available_from && <span>С {formatDate(item.available_from)}</span>}
      </p>
    </div>
  );
}
export function CatalogCard({
  item,
  view,
  onPreview,
  onStatus,
  onAddUnit,
  onDelete,
}: {
  item: CatalogItem;
  view: "grid" | "list";
  onPreview: (item: CatalogItem) => void;
  onStatus: (item: CatalogItem) => void;
  onAddUnit?: ((id: string) => void) | undefined;
  onDelete?: ((id: string) => void) | undefined;
}) {
  return (
    <article
      data-testid="catalog-card"
      aria-label={item.title}
      className={cn(
        "group overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-md",
        view === "list" && "sm:grid sm:grid-cols-[240px_1fr]",
      )}
    >
      <div className="relative">
        <CatalogObjectLink
          item={item}
          className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <CatalogPhoto
            item={item}
            path={item.photos[0]}
            className={cn("aspect-[4/3] w-full", view === "list" && "sm:h-full sm:min-h-64")}
          />
        </CatalogObjectLink>
        <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-2">
          <span className="rounded-full bg-background/95 px-2.5 py-1 text-xs font-medium shadow-sm">
            {propertyTypeLabels[item.type] ?? item.type}
          </span>
          {item.scope === "internal" && item.status === "archived" && (
            <span className="rounded-full bg-foreground/85 px-2.5 py-1 text-xs text-background">
              В архиве
            </span>
          )}
        </div>
        {item.photos.length > 1 && (
          <span className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-black/60 px-2 py-1 text-xs text-white">
            {item.photos.length} фото
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col p-5">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h2 className="break-words text-lg font-semibold leading-snug">
            <CatalogObjectLink
              item={item}
              className="hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {item.title}
            </CatalogObjectLink>
          </h2>
          {item.scope === "internal" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="-mr-2 -mt-2 shrink-0"
                  aria-label={`Управление: ${item.title}`}
                >
                  <Ellipsis className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to="/objects/$propertyId" params={{ propertyId: item.id }}>
                    <ArrowUpRight className="mr-2 h-4 w-4" />
                    Страница объекта
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/repairs" search={{ property: item.id, request: "" }}>
                    <Wrench className="mr-2 h-4 w-4" />
                    Ремонты и подрядчики
                  </Link>
                </DropdownMenuItem>
                {item.role === "owner" && (
                  <>
                    <DropdownMenuItem asChild>
                      <Link to="/properties/$propertyId" params={{ propertyId: item.id }}>
                        <FileText className="mr-2 h-4 w-4" />
                        Параметры объекта
                      </Link>
                    </DropdownMenuItem>
                    {onAddUnit && (
                      <DropdownMenuItem onSelect={() => onAddUnit(item.id)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Добавить помещение
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onStatus(item)}>
                      {item.status === "archived" ? (
                        <ArchiveRestore className="mr-2 h-4 w-4" />
                      ) : (
                        <Archive className="mr-2 h-4 w-4" />
                      )}
                      {item.status === "archived" ? "Вернуть в работу" : "В архив"}
                    </DropdownMenuItem>
                    {onDelete && (
                      <DropdownMenuItem
                        className="text-destructive"
                        onSelect={() => onDelete(item.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Удалить объект
                      </DropdownMenuItem>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <p className="mb-4 flex items-start gap-1.5 break-words text-sm text-muted-foreground">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
          {item.location || "Адрес не указан"}
        </p>
        <CatalogFacts item={item} />
        {item.description && (
          <p className="mt-3 line-clamp-2 break-words text-sm leading-relaxed text-muted-foreground">
            {item.description}
          </p>
        )}
        {item.scope === "internal" && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-secondary px-2.5 py-1">
              {occupancyLabels[item.occupancy as keyof typeof occupancyLabels] ??
                "Аренда не указана"}
            </span>
            {item.published && (
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-primary">
                Есть публикация
              </span>
            )}
            {Boolean(item.open_requests) && (
              <span className="rounded-full bg-secondary px-2.5 py-1">
                Обращений: {item.open_requests}
              </span>
            )}
          </div>
        )}
        <div className="mt-auto flex flex-wrap gap-2 pt-5">
          <Button className="flex-1" asChild>
            <CatalogObjectLink item={item}>
              {item.scope === "public" ? "Подробнее" : "Открыть объект"}
            </CatalogObjectLink>
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={`Быстрый просмотр: ${item.title}`}
            onClick={() => onPreview(item)}
          >
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </article>
  );
}
