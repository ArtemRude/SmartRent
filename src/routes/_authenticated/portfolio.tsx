import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { PropertyCatalog } from "@/components/property-catalog/PropertyCatalog";
import { readCatalogSearch, type CatalogSearch } from "@/lib/property-catalog";
import { useAuth } from "@/hooks/auth-context";
export const Route = createFileRoute("/_authenticated/portfolio")({
  validateSearch: (s: Record<string, unknown>): Partial<CatalogSearch> => readCatalogSearch(s),
  component: Portfolio,
});
function Portfolio() {
  const { role } = useAuth();
  const search = readCatalogSearch(Route.useSearch());
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="Доступные объекты"
        description="Ваши объекты и объекты, переданные вам для работы в команде"
        action={
          role !== "tenant" ? (
            <Button asChild variant="outline">
              <Link to="/properties">Управление объектами</Link>
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link to="/team">Моя команда</Link>
            </Button>
          )
        }
      />
      <PropertyCatalog
        scope="internal"
        search={search}
        onSearch={(s) => void navigate({ to: "/portfolio", search: s })}
      />
    </>
  );
}
