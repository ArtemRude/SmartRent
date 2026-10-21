import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PropertyCatalog } from "@/components/property-catalog/PropertyCatalog";
import { readCatalogSearch, type CatalogSearch } from "@/lib/property-catalog";
import { useAuth } from "@/hooks/auth-context";
export const Route = createFileRoute("/catalog")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): Partial<CatalogSearch> => readCatalogSearch(s),
  head: () => ({
    meta: [
      { title: "Каталог недвижимости — SmartRent" },
      {
        name: "description",
        content:
          "Опубликованные предложения аренды: квартиры, склады и коммерческие помещения. Поиск, цена, площадь и подробные карточки.",
      },
    ],
  }),
  component: PublicCatalog,
});
function PublicCatalog() {
  const { user } = useAuth();
  const search = readCatalogSearch(Route.useSearch());
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-secondary/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6">
          <Link to="/" className="flex items-center gap-2 font-display text-lg font-semibold">
            <Building2 className="h-6 w-6 text-primary" />
            SmartRent
          </Link>
          <Button asChild variant="outline">
            {user ? (
              <Link to="/recruitment">Мои отклики и кабинет</Link>
            ) : (
              <Link to="/auth" search={{ mode: "signin", role: undefined, email: "", name: "" }}>
                Войти в кабинет
              </Link>
            )}
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-7 px-4 py-8 sm:px-6 lg:py-12">
        <div className="max-w-2xl space-y-3">
          <p className="text-xs font-medium uppercase tracking-widest text-primary">
            Недвижимость в аренду
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Найдите место для жизни и работы
          </h1>
          <p className="text-muted-foreground">
            Сравните предложения, посмотрите фотографии и условия. Договориться о показе можно через
            отклик на карточке объекта.
          </p>
        </div>
        <PropertyCatalog
          scope="public"
          search={search}
          onSearch={(s) => void navigate({ to: "/catalog", search: s })}
        />
      </main>
    </div>
  );
}
