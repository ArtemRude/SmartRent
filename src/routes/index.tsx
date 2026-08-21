import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, FileText, Inbox, ShieldCheck, Users, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Умная Аренда — кабинет собственника недвижимости" },
      {
        name: "description",
        content:
          "Умная Аренда: управляйте квартирами, складами и коммерцией, арендаторами, договорами и заявками в одном кабинете.",
      },
      { property: "og:title", content: "Умная Аренда — кабинет собственника недвижимости" },
      {
        property: "og:description",
        content:
          "Объекты, помещения, арендаторы, договоры и заявки — единая платформа для собственника.",
      },
    ],
  }),
  component: Landing,
});

const features = [
  {
    icon: Building2,
    title: "Объекты и помещения",
    text: "Квартиры, склады и коммерция с фото, площадью и статусом занятости.",
  },
  {
    icon: Users,
    title: "Арендаторы",
    text: "Карточки арендаторов с контактами и автоматической привязкой к их кабинету.",
  },
  {
    icon: FileText,
    title: "Договоры",
    text: "Сроки, платежи и скан-копии договоров с напоминанием об окончании аренды.",
  },
  {
    icon: Inbox,
    title: "Заявки",
    text: "Арендатор создаёт заявку с фото — вы ведёте её от «Новая» до «Закрыта».",
  },
];

function Landing() {
  const { session, role } = useAuth();
  const target = role === "tenant" ? "/cabinet" : "/dashboard";

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 md:px-8">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Building2 className="h-4 w-4" />
          </span>
          <span className="font-display text-lg font-semibold tracking-tight">Умная Аренда</span>
        </div>
        {session ? (
          <Button asChild size="sm">
            <Link to={target}>В кабинет</Link>
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/auth" search={{ mode: "signin", role: undefined, email: "", name: "" }}>
                Войти
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/auth" search={{ mode: "signup", role: undefined, email: "", name: "" }}>
                Начать бесплатно
              </Link>
            </Button>
          </div>
        )}
      </header>

      <main>
        <section className="mx-auto w-full max-w-6xl px-4 pb-16 pt-10 md:px-8 md:pt-20">
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" /> MVP для собственников и арендаторов
          </p>
          <h1 className="mt-5 max-w-3xl font-display text-4xl font-bold leading-tight tracking-tight md:text-6xl">
            Аренда без таблиц, чатов и потерянных договоров
          </h1>
          <p className="mt-5 max-w-2xl text-base text-muted-foreground md:text-lg">
            «Умная Аренда» собирает недвижимость, арендаторов, договоры и заявки в одном спокойном
            интерфейсе. Собственник видит картину целиком, арендатор — свой личный кабинет.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              {session ? (
                <Link to={target}>Открыть кабинет</Link>
              ) : (
                <Link to="/auth" search={{ mode: "signup", role: undefined, email: "", name: "" }}>
                  Создать кабинет
                </Link>
              )}
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/auth" search={{ mode: "signin", role: undefined, email: "", name: "" }}>
                У меня уже есть аккаунт
              </Link>
            </Button>
          </div>

          <div className="mt-14 grid gap-4 sm:grid-cols-2">
            {features.map((f) => (
              <article
                key={f.title}
                className="rounded-2xl border border-border bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
              >
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-accent-foreground">
                  <f.icon className="h-5 w-5" />
                </span>
                <h2 className="mt-4 text-lg font-semibold">{f.title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{f.text}</p>
              </article>
            ))}
          </div>

          <div className="mt-14 grid gap-4 rounded-2xl border border-border bg-secondary p-6 md:grid-cols-3 md:p-8">
            {[
              { icon: Building2, k: "Квартиры", v: "Жилая аренда с фото и статусами" },
              { icon: Warehouse, k: "Склады", v: "Площади, помещения и занятость" },
              { icon: FileText, k: "Коммерция", v: "Договоры и платежи под контролем" },
            ].map((i) => (
              <div key={i.k} className="flex items-start gap-3">
                <i.icon className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">{i.k}</p>
                  <p className="text-sm text-muted-foreground">{i.v}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 text-sm text-muted-foreground md:px-8">
          © {new Date().getFullYear()} Умная Аренда
        </div>
      </footer>
    </div>
  );
}
