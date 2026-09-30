import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  BellRing,
  BookOpenCheck,
  Building2,
  Check,
  CircleCheck,
  FileText,
  Inbox,
  KeyRound,
  LifeBuoy,
  ShieldCheck,
  Users,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SupportRequestForm } from "@/components/SupportRequestForm";
import { useAuth } from "@/hooks/auth-context";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SmartRent" },
      {
        name: "description",
        content:
          "SmartRent объединяет объекты, арендаторов, договоры, платежи и заявки в одном цифровом кабинете.",
      },
      { property: "og:title", content: "SmartRent — аренда под контролем" },
      {
        property: "og:description",
        content: "Единая платформа для управления жилой, складской и коммерческой недвижимостью.",
      },
    ],
  }),
  component: Landing,
});

const capabilities = [
  {
    icon: Building2,
    title: "Объекты и помещения",
    text: "Вся недвижимость, фотографии, площади и занятость — в понятной структуре.",
    label: "Портфель",
  },
  {
    icon: Users,
    title: "Арендаторы",
    text: "Контакты, привязка к объектам и отдельный кабинет для каждого арендатора.",
    label: "Отношения",
  },
  {
    icon: FileText,
    title: "Договоры и платежи",
    text: "Сроки, документы, начисления и история оплат без разрозненных таблиц.",
    label: "Финансы",
  },
  {
    icon: Inbox,
    title: "Заявки",
    text: "Проблема, фото, обсуждение и статус решения сохраняются в одном месте.",
    label: "Сервис",
  },
];

const workflow = [
  {
    number: "01",
    title: "Добавьте недвижимость",
    text: "Создайте объекты и помещения, загрузите фотографии и укажите основные параметры.",
  },
  {
    number: "02",
    title: "Свяжите арендатора и договор",
    text: "Контакты, условия аренды и документы образуют единую актуальную карточку.",
  },
  {
    number: "03",
    title: "Управляйте из одного кабинета",
    text: "Следите за платежами, сроками и заявками, не переключаясь между чатами и файлами.",
  },
];

function BrandMark({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        className={`grid h-9 w-9 place-items-center rounded-xl ${
          inverse ? "bg-[#62cbd0] text-[#101517]" : "bg-[#121719] text-white"
        }`}
      >
        <Building2 className="h-4 w-4" />
      </span>
      <span
        className={`font-display text-lg font-bold tracking-tight ${inverse ? "text-white" : ""}`}
      >
        SmartRent
      </span>
    </span>
  );
}

function ProductPreview() {
  return (
    <div className="relative min-h-[500px] overflow-hidden bg-[#dce9e7] p-5 sm:p-8 lg:min-h-[620px]">
      <div className="absolute -right-20 -top-16 h-72 w-72 rounded-full bg-[#62cbd0]/30 blur-3xl" />
      <div className="absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-white/70 blur-3xl" />

      <div className="relative mx-auto mt-4 max-w-[580px] rounded-[28px] border border-white/80 bg-white/95 p-3 shadow-[0_35px_90px_rgba(16,25,27,0.20)] sm:mt-10 sm:p-4">
        <div className="flex items-center justify-between border-b border-[#e8eceb] px-2 pb-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#62cbd0]/45" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#62cbd0]/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#62cbd0]" />
          </div>
          <span className="rounded-full bg-[#f0f4f3] px-3 py-1 text-[10px] font-medium text-[#52605f]">
            Панель собственника
          </span>
        </div>

        <div className="grid gap-3 pt-4 sm:grid-cols-[118px_1fr]">
          <aside className="hidden rounded-2xl bg-[#13191b] p-3 text-white sm:block">
            <div className="mb-5 flex items-center gap-2 text-[10px] font-semibold">
              <span className="grid h-6 w-6 place-items-center rounded-lg bg-[#62cbd0] text-[#13191b]">
                <Building2 className="h-3 w-3" />
              </span>
              SmartRent
            </div>
            {["Обзор", "Объекты", "Арендаторы", "Договоры", "Заявки"].map((item, index) => (
              <div
                key={item}
                className={`mb-1 rounded-lg px-2 py-2 text-[9px] ${
                  index === 0 ? "bg-white/12 text-white" : "text-white/55"
                }`}
              >
                {item}
              </div>
            ))}
          </aside>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[9px] font-medium uppercase tracking-[0.18em] text-[#74817f]">
                  Обзор
                </p>
                <p className="text-sm font-bold text-[#17201f] sm:text-base">
                  Добрый день, Алексей
                </p>
              </div>
              <span className="grid h-8 w-8 place-items-center rounded-full bg-[#edf4f3] text-[#315553]">
                <BellRing className="h-3.5 w-3.5" />
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                ["12", "объектов"],
                ["9", "занято"],
                ["2", "заявки"],
              ].map(([value, label], index) => (
                <div key={label} className="rounded-xl border border-[#e7ecea] bg-white p-3">
                  <div
                    className={`mb-2 h-1 w-7 rounded-full ${index === 1 ? "bg-[#62cbd0]" : "bg-[#62cbd0]/55"}`}
                  />
                  <p className="text-lg font-bold text-[#17201f] sm:text-xl">{value}</p>
                  <p className="text-[9px] text-[#74817f]">{label}</p>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-[#e7ecea] bg-white p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-[#17201f]">Поступления</p>
                  <p className="text-[9px] text-[#74817f]">Последние 6 месяцев</p>
                </div>
                <BarChart3 className="h-4 w-4 text-[#55aeb2]" />
              </div>
              <div className="flex h-24 items-end gap-2">
                {[42, 64, 51, 78, 68, 92].map((height, index) => (
                  <div key={height} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className={`w-full rounded-t-md ${index === 5 ? "bg-[#62cbd0]" : "bg-[#d7e6e4]"}`}
                      style={{ height: `${height}%` }}
                    />
                    <span className="text-[7px] text-[#899492]">
                      {["Апр", "Май", "Июн", "Июл", "Авг", "Сен"][index]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-8 left-5 rounded-2xl border border-white/80 bg-white/95 p-4 shadow-xl sm:left-8">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-[#e4f5ef] text-[#23845f]">
            <CircleCheck className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-semibold text-[#17201f]">Платёж получен</p>
            <p className="text-[10px] text-[#74817f]">Договор № 24 · сегодня</p>
          </div>
        </div>
      </div>

      <div className="absolute right-5 top-6 rounded-2xl bg-[#13191b] px-4 py-3 text-white shadow-xl sm:right-8 sm:top-10">
        <p className="text-[9px] uppercase tracking-[0.16em] text-[#62cbd0]">Статус портфеля</p>
        <p className="mt-1 text-sm font-semibold">Всё под контролем</p>
      </div>
    </div>
  );
}

function Landing() {
  const { session, user, profile, role } = useAuth();
  const target = role === "tenant" ? "/cabinet" : role === "admin" ? "/admin" : "/dashboard";
  const authSearch = { role: undefined, email: "", name: "" } as const;

  return (
    <div className="min-h-screen bg-[#f5f5f1] text-[#151a1b]">
      <div className="bg-[#121719] px-4 py-2.5 text-center text-xs text-white/75">
        Управление арендой без таблиц и потерянных сообщений
        <a href="#product" className="ml-2 font-semibold text-[#62cbd0] hover:text-white">
          Посмотреть возможности →
        </a>
      </div>

      <header className="sticky top-0 z-40 border-b border-black/8 bg-[#f5f5f1]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="#top" aria-label="SmartRent — на главную">
            <BrandMark />
          </a>
          <nav className="hidden items-center gap-8 text-sm font-semibold md:flex">
            <a className="transition-colors hover:text-[#318f94]" href="#product">
              Возможности
            </a>
            <a className="transition-colors hover:text-[#318f94]" href="#portfolio">
              Для кого
            </a>
            <a className="transition-colors hover:text-[#318f94]" href="#workflow">
              Как работает
            </a>
            <a className="transition-colors hover:text-[#318f94]" href="#security">
              Безопасность
            </a>
            <a className="transition-colors hover:text-[#318f94]" href="#support">
              Поддержка
            </a>
          </nav>
          {session ? (
            <Button
              asChild
              className="rounded-full bg-[#121719] px-5 text-white hover:bg-[#263032]"
            >
              <Link to={target}>В кабинет</Link>
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" className="hidden rounded-full sm:inline-flex">
                <Link to="/auth" search={{ mode: "signin", ...authSearch }}>
                  Войти
                </Link>
              </Button>
              <Button
                asChild
                className="rounded-full bg-[#121719] px-5 text-white hover:bg-[#263032]"
              >
                <Link to="/auth" search={{ mode: "signup", ...authSearch }}>
                  Попробовать
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
            </div>
          )}
        </div>
      </header>

      <main id="top">
        <section className="mx-auto max-w-[1440px] px-3 py-3 sm:px-5 sm:py-5">
          <div className="grid overflow-hidden rounded-[28px] lg:grid-cols-2">
            <div className="flex min-h-[570px] flex-col justify-between bg-[#121719] px-6 py-9 text-white sm:px-12 sm:py-12 lg:min-h-[620px] lg:px-16">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#62cbd0]">
                <span className="h-2 w-2 rounded-full bg-[#62cbd0]" />
                Единый кабинет собственника
              </div>
              <div className="py-12">
                <h1 className="max-w-xl font-display text-[42px] font-bold leading-[1.02] tracking-[-0.045em] sm:text-6xl lg:text-[68px]">
                  Недвижимость.
                  <br />
                  Арендаторы.
                  <br />
                  <span className="text-[#62cbd0]">Всё связано.</span>
                </h1>
                <p className="mt-7 max-w-lg text-base leading-7 text-white/66 sm:text-lg">
                  SmartRent объединяет объекты, договоры, платежи и заявки в одном спокойном
                  интерфейсе — для собственника и арендатора.
                </p>
                <div className="mt-9 flex flex-wrap gap-3">
                  <Button
                    asChild
                    size="lg"
                    className="rounded-full bg-[#62cbd0] px-7 text-[#101617] hover:bg-[#78d8dc]"
                  >
                    {session ? (
                      <Link to={target}>Открыть кабинет</Link>
                    ) : (
                      <Link to="/auth" search={{ mode: "signup", ...authSearch }}>
                        Создать кабинет
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    )}
                  </Button>
                  <Button
                    asChild
                    size="lg"
                    variant="outline"
                    className="rounded-full border-white/25 bg-transparent px-7 text-white hover:bg-white/10 hover:text-white"
                  >
                    <a href="#product">Узнать больше</a>
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 border-t border-white/12 pt-6 text-sm text-white/62 sm:grid-cols-3">
                {["Жилая недвижимость", "Склады", "Коммерческие объекты"].map((item) => (
                  <div key={item} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-[#62cbd0]" />
                    {item}
                  </div>
                ))}
              </div>
            </div>
            <ProductPreview />
          </div>
        </section>

        <section id="product" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#318f94]">
                Возможности
              </p>
              <h2 className="mt-5 max-w-md text-4xl font-bold leading-tight sm:text-5xl">
                Один продукт вместо пяти разрозненных инструментов
              </h2>
              <p className="mt-6 max-w-md leading-7 text-[#62706e]">
                Данные не теряются между таблицами, мессенджерами и папками. Каждое действие
                остаётся рядом с объектом, договором и человеком.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {capabilities.map((item, index) => (
                <article
                  key={item.title}
                  className={`rounded-[24px] border border-black/8 p-6 transition-transform duration-300 hover:-translate-y-1 sm:p-7 ${
                    index === 0 ? "bg-[#dce9e7]" : "bg-white"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#121719] text-[#62cbd0]">
                      <item.icon className="h-5 w-5" />
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#7a8583]">
                      {item.label}
                    </span>
                  </div>
                  <h3 className="mt-8 text-xl font-bold">{item.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-[#687371]">{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="portfolio" className="bg-[#121719] py-20 text-white lg:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#62cbd0]">
                  Для любого портфеля
                </p>
                <h2 className="mt-5 max-w-2xl text-4xl font-bold leading-tight sm:text-5xl">
                  Разные объекты. Одна логика управления.
                </h2>
              </div>
              <p className="max-w-md leading-7 text-white/58">
                Начните с одной квартиры и добавляйте новые помещения по мере роста — структура
                кабинета останется понятной.
              </p>
            </div>

            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {[
                {
                  icon: Building2,
                  title: "Квартиры",
                  text: "Арендаторы, договоры, платежи и бытовые заявки.",
                },
                {
                  icon: Warehouse,
                  title: "Склады",
                  text: "Площади, помещения, занятость и сроки аренды.",
                },
                {
                  icon: FileText,
                  title: "Коммерция",
                  text: "Документы, начисления и полный контекст по объекту.",
                },
              ].map((item, index) => (
                <article
                  key={item.title}
                  className={`min-h-72 rounded-[24px] border border-white/12 p-7 ${
                    index === 1 ? "bg-[#62cbd0] text-[#101617]" : "bg-white/[0.035]"
                  }`}
                >
                  <item.icon
                    className={`h-7 w-7 ${index === 1 ? "text-[#101617]" : "text-[#62cbd0]"}`}
                  />
                  <div className="mt-24">
                    <h3 className="text-2xl font-bold">{item.title}</h3>
                    <p
                      className={`mt-3 leading-6 ${index === 1 ? "text-[#234241]" : "text-white/58"}`}
                    >
                      {item.text}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="workflow" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#318f94]">
              Как это работает
            </p>
            <h2 className="mx-auto mt-5 max-w-2xl text-4xl font-bold leading-tight sm:text-5xl">
              От объекта до полной картины — три шага
            </h2>
          </div>
          <div className="mt-14 grid gap-4 lg:grid-cols-3">
            {workflow.map((item) => (
              <article
                key={item.number}
                className="rounded-[24px] border border-black/8 bg-white p-7 sm:p-8"
              >
                <span className="font-display text-sm font-bold text-[#318f94]">{item.number}</span>
                <div className="my-7 h-px bg-black/8" />
                <h3 className="text-xl font-bold">{item.title}</h3>
                <p className="mt-3 leading-6 text-[#687371]">{item.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="security" className="mx-auto max-w-[1440px] px-3 pb-3 sm:px-5 sm:pb-5">
          <div className="grid overflow-hidden rounded-[28px] bg-[#dce9e7] lg:grid-cols-2">
            <div className="p-7 sm:p-12 lg:p-16">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#318f94]">
                Контроль доступа
              </p>
              <h2 className="mt-5 max-w-lg text-4xl font-bold leading-tight sm:text-5xl">
                Каждый видит только то, что ему нужно
              </h2>
              <p className="mt-6 max-w-lg leading-7 text-[#5c6b69]">
                Собственник управляет портфелем, а арендатор получает отдельный кабинет со своим
                договором и заявками.
              </p>
              <div className="mt-8 space-y-4">
                {[
                  "Раздельные роли собственника и арендатора",
                  "Авторизация и данные через Supabase",
                  "Документы и история действий в контексте объекта",
                  "Пошаговые рекомендации по безопасной работе",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3 text-sm font-medium">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-white text-[#318f94]">
                      <Check className="h-4 w-4" />
                    </span>
                    {item}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex min-h-[430px] items-center justify-center bg-[#cbdedb] p-8">
              <div className="relative w-full max-w-sm rounded-[28px] bg-[#121719] p-7 text-white shadow-2xl">
                <div className="flex items-center justify-between">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#62cbd0] text-[#121719]">
                    <ShieldCheck className="h-6 w-6" />
                  </span>
                  <KeyRound className="h-5 w-5 text-white/35" />
                </div>
                <p className="mt-10 text-xs font-semibold uppercase tracking-[0.18em] text-[#62cbd0]">
                  Ваш кабинет
                </p>
                <h3 className="mt-3 text-2xl font-bold">Данные доступны по роли</h3>
                <p className="mt-3 text-sm leading-6 text-white/58">
                  Вход, профиль и права доступа связаны с одной учётной записью.
                </p>
                <div className="mt-8 grid grid-cols-2 gap-3">
                  {["Собственник", "Арендатор"].map((item) => (
                    <div
                      key={item}
                      className="rounded-2xl border border-white/12 bg-white/[0.04] p-4 text-sm"
                    >
                      <Users className="mb-4 h-4 w-4 text-[#62cbd0]" />
                      {item}
                    </div>
                  ))}
                </div>
                <div
                  id="security-guide"
                  className="mt-3 rounded-2xl border border-white/12 bg-white/[0.04] p-4"
                >
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <BookOpenCheck className="h-4 w-4 text-[#62cbd0]" />
                    Правила безопасной работы
                  </div>
                  <ul className="mt-3 space-y-2 text-xs leading-5 text-white/58">
                    <li>
                      Используйте уникальный пароль и выходите из кабинета на чужих устройствах.
                    </li>
                    <li>
                      Проверяйте объект и получателя перед загрузкой документов или фотографий.
                    </li>
                    <li>
                      Подтверждайте оплату только после проверки фактического поступления средств.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="support" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="grid overflow-hidden rounded-[28px] bg-[#121719] text-white lg:grid-cols-[0.85fr_1.15fr]">
            <div className="flex flex-col justify-between border-b border-white/10 p-7 sm:p-12 lg:border-b-0 lg:border-r lg:p-14">
              <div>
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#62cbd0] text-[#121719]">
                  <LifeBuoy className="h-6 w-6" />
                </span>
                <p className="mt-10 text-xs font-bold uppercase tracking-[0.2em] text-[#62cbd0]">
                  Мы на связи
                </p>
                <h2 className="mt-5 max-w-md text-4xl font-bold leading-tight sm:text-5xl">
                  Остался вопрос? Напишите нам
                </h2>
                <p className="mt-6 max-w-md leading-7 text-white/58">
                  Расскажите, что хотите уточнить или какая проблема возникла. Обращение попадёт в
                  единый центр поддержки SmartRent.
                </p>
              </div>
              {session && (
                <Button
                  asChild
                  variant="outline"
                  className="mt-8 w-fit rounded-full border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
                >
                  <Link to="/support">Открыть историю обращений</Link>
                </Button>
              )}
            </div>
            <div className="p-7 sm:p-12 lg:p-14">
              <SupportRequestForm
                source="landing"
                userId={user?.id ?? null}
                defaultName={profile?.name ?? ""}
                defaultEmail={profile?.email ?? user?.email ?? ""}
                dark
              />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="rounded-[28px] bg-[#62cbd0] px-6 py-14 text-center sm:px-12 sm:py-20">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#245e61]">
              Начните с первого объекта
            </p>
            <h2 className="mx-auto mt-5 max-w-3xl text-4xl font-bold leading-tight sm:text-6xl">
              Наведите порядок в аренде уже сегодня
            </h2>
            <p className="mx-auto mt-5 max-w-xl leading-7 text-[#285557]">
              Создайте кабинет, добавьте недвижимость и соберите рабочие процессы в одном месте.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button
                asChild
                size="lg"
                className="rounded-full bg-[#121719] px-8 text-white hover:bg-[#263032]"
              >
                {session ? (
                  <Link to={target}>Открыть кабинет</Link>
                ) : (
                  <Link to="/auth" search={{ mode: "signup", ...authSearch }}>
                    Создать аккаунт
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                )}
              </Button>
              {!session && (
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="rounded-full border-[#254e50]/35 bg-transparent px-8 text-[#121719] hover:bg-white/25"
                >
                  <Link to="/auth" search={{ mode: "signin", ...authSearch }}>
                    Войти
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#121719] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:items-end md:justify-between lg:px-8">
          <div>
            <BrandMark inverse />
            <p className="mt-4 max-w-sm text-sm leading-6 text-white/48">
              Цифровой кабинет для управления арендной недвижимостью.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-white/58">
            <a className="hover:text-white" href="#product">
              Возможности
            </a>
            <a className="hover:text-white" href="#workflow">
              Как работает
            </a>
            <a className="hover:text-white" href="#support">
              Поддержка
            </a>
            <Link
              className="hover:text-white"
              to="/auth"
              search={{ mode: "signin", ...authSearch }}
            >
              Войти
            </Link>
          </div>
          <p className="text-xs text-white/35">© 2026 SmartRent</p>
        </div>
      </footer>
    </div>
  );
}
