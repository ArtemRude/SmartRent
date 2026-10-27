import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, MapPin } from "lucide-react";
import { useAuth } from "@/hooks/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { ListingPhoto } from "@/components/ListingPhoto";
import { RentalApplicationCard } from "@/components/RentalApplicationCard";
import {
  fetchPublicListing,
  fetchRecruitment,
  applyToListing,
  RecruitmentError,
} from "@/lib/recruitment-queries";
import { validListingId, LISTING_RETURN_KEY } from "@/lib/recruitment";
import { formatDate, formatMoney } from "@/lib/domain";
export const Route = createFileRoute("/listing/$listingId")({
  ssr: false,
  component: PublicListingPage,
  head: () => ({
    meta: [{ title: "Предложение аренды · SmartRent" }, { name: "robots", content: "noindex" }],
  }),
});
function PublicListingPage() {
  const { listingId } = Route.useParams();
  const { user, profile, loading } = useAuth();
  const client = useQueryClient();
  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const q = useQuery({
    queryKey: ["public-listing", listingId, user?.id],
    queryFn: ({ signal }) => fetchPublicListing(listingId, signal),
    enabled: validListingId(listingId),
    retry: false,
    refetchInterval: 15000,
  });
  const mine = useQuery({
    queryKey: ["recruitment", user?.id],
    queryFn: ({ signal }) => fetchRecruitment(signal),
    enabled: !!user,
    retry: false,
    refetchInterval: 5000,
  });
  useEffect(() => {
    if (user) {
      try {
        sessionStorage.removeItem(LISTING_RETURN_KEY);
      } catch {
        /* The current page remains usable without session storage. */
      }
    }
  }, [user]);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["recruitment"] });
  };
  const mutation = useMutation({
    mutationFn: () =>
      applyToListing(listingId, {
        name: name ?? profile?.name ?? "",
        phone: phone ?? profile?.phone ?? "",
        message,
        consent,
      }),
    onSuccess: refresh,
    onError: (e: Error) => {
      setError(e.message);
      void q.refetch();
    },
  });
  const listing = !q.isError ? q.data : undefined;
  const application = !mine.isError
    ? mine.data?.applications.find((a) => a.public_id === listingId)
    : undefined;
  const operator = mine.data?.properties.some((p) => p.id === application?.property_id) || false;
  return (
    <div className="min-h-screen bg-secondary/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-5">
          <Link to="/" className="flex items-center gap-2 font-display text-lg font-semibold">
            <Building2 className="h-6 w-6 text-primary" />
            SmartRent
          </Link>
          <Button variant="ghost" asChild>
            <Link to="/catalog">Все объявления</Link>
          </Button>
          {user ? (
            <Button variant="outline" asChild>
              <Link to="/recruitment">Мои отклики и кабинет</Link>
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">Предложение аренды</span>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 md:py-12">
        {q.isPending && validListingId(listingId) && <p>Загружаем предложение…</p>}
        {(q.isError || !validListingId(listingId)) && (
          <Card>
            <CardContent className="space-y-3 p-6">
              <p role="alert">
                {q.error instanceof RecruitmentError && q.error.code === "PGRST202"
                  ? "Объявления пока недоступны."
                  : "Не удалось открыть объявление."}
              </p>
              <Button variant="outline" onClick={() => void q.refetch()}>
                Попробовать снова
              </Button>
            </CardContent>
          </Card>
        )}
        {q.isSuccess && !listing && (
          <Card>
            <CardContent className="space-y-2 p-6">
              <h1 className="text-xl font-semibold">Объявление недоступно</h1>
              <p className="text-sm text-muted-foreground">
                Собственник снял его с публикации или набор уже завершён.
              </p>
            </CardContent>
          </Card>
        )}
        {listing && (
          <>
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-widest text-primary">
                Сдаётся в аренду
              </p>
              <h1 className="break-words font-display text-3xl font-semibold md:text-4xl">
                {listing.details.title}
              </h1>
              <p className="flex items-start gap-2 text-muted-foreground">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                {listing.details.location}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {listing.details.photos.map((path, i) => (
                <ListingPhoto
                  key={path}
                  path={path}
                  alt={`${listing.details.title}, фото ${i + 1}`}
                />
              ))}
            </div>
            <div className="grid items-start gap-6 md:grid-cols-[1.4fr_1fr]">
              <Card>
                <CardContent className="space-y-6 p-6">
                  <div className="flex flex-wrap gap-x-8 gap-y-4">
                    <div>
                      <p className="text-2xl font-semibold">
                        {formatMoney(listing.details.monthly_rent)}
                        <span className="text-sm font-normal text-muted-foreground"> / месяц</span>
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Депозит: {formatMoney(listing.details.deposit)}
                      </p>
                    </div>
                    {listing.details.area > 0 && (
                      <p className="text-xl font-semibold">{listing.details.area} м²</p>
                    )}
                  </div>
                  <p className="text-sm">Доступно с {formatDate(listing.details.available_from)}</p>
                  <div>
                    <h2 className="mb-3 font-semibold">Об объекте</h2>
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                      {listing.details.description || "Подробности можно уточнить при показе."}
                    </p>
                  </div>
                  {listing.details.contact_name && (
                    <p className="text-sm text-muted-foreground">
                      Контактное лицо: {listing.details.contact_name}
                    </p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardContent className="space-y-4 p-6">
                  <h2 className="text-xl font-semibold">Заявка на аренду</h2>
                  {loading ? (
                    <p className="text-sm">Проверяем вход…</p>
                  ) : !user ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        Войдите или зарегистрируйтесь, чтобы оставить контакты и получать информацию
                        о показе и решении собственника.
                      </p>
                      <Button asChild className="w-full">
                        <Link
                          to="/auth"
                          search={{ mode: "signin", role: undefined, email: "", name: "" }}
                          onClick={() => {
                            try {
                              sessionStorage.setItem(LISTING_RETURN_KEY, listingId);
                            } catch {
                              /* Sign-in remains available. */
                            }
                          }}
                        >
                          Войти и оставить заявку
                        </Link>
                      </Button>
                    </>
                  ) : listing.can_apply === false ? (
                    <p className="text-sm text-muted-foreground">
                      Вы состоите в команде объекта. Отклики и показы доступны в разделе «Поиск
                      арендаторов».
                    </p>
                  ) : mine.isPending ? (
                    <p className="text-sm">Проверяем ваши отклики…</p>
                  ) : mine.isError ? (
                    <p role="alert" className="text-sm text-destructive">
                      Не удалось проверить отклики. Обновите страницу.
                    </p>
                  ) : application ? (
                    <p className="text-sm text-muted-foreground">
                      Ваш отклик уже сохранён. Его состояние показано ниже.
                    </p>
                  ) : (
                    <form
                      className="space-y-4"
                      onSubmit={(e) => {
                        e.preventDefault();
                        setError("");
                        mutation.mutate();
                      }}
                    >
                      <div className="space-y-1.5">
                        <Label htmlFor="applicant-name">Ваше имя</Label>
                        <Input
                          id="applicant-name"
                          value={name ?? profile?.name ?? ""}
                          onChange={(e) => setName(e.target.value)}
                          maxLength={200}
                          required
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="applicant-phone">Телефон</Label>
                        <Input
                          id="applicant-phone"
                          type="tel"
                          value={phone ?? profile?.phone ?? ""}
                          onChange={(e) => setPhone(e.target.value)}
                          minLength={5}
                          maxLength={40}
                          required
                        />
                      </div>
                      <p className="break-all text-xs text-muted-foreground">
                        Email из аккаунта: {user.email}
                      </p>
                      <div className="space-y-1.5">
                        <Label htmlFor="applicant-message">О себе и желаемой дате заселения</Label>
                        <Textarea
                          id="applicant-message"
                          maxLength={2000}
                          value={message}
                          onChange={(e) => setMessage(e.target.value)}
                        />
                      </div>
                      <label className="flex items-start gap-2 text-xs leading-relaxed">
                        <input
                          type="checkbox"
                          checked={consent}
                          onChange={(e) => setConsent(e.target.checked)}
                          required
                          className="mt-0.5"
                        />
                        Согласен передать имя, email, телефон и сообщение собственнику и управляющим
                        этого объекта для рассмотрения заявки.
                      </label>
                      {error && (
                        <p role="alert" className="text-sm text-destructive">
                          {error}
                        </p>
                      )}
                      <Button className="w-full" disabled={!consent || mutation.isPending}>
                        {mutation.isPending ? "Отправляем…" : "Отправить заявку"}
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
        {application && !operator && (
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Ваш отклик</h2>
            <RentalApplicationCard
              key={`${application.id}:${application.revision}`}
              application={application}
              onSaved={refresh}
            />
          </section>
        )}
      </main>
    </div>
  );
}
