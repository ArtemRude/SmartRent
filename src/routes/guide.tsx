import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowDown, Building2, KeyRound, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/guide")({
  head: () => ({
    meta: [
      { title: "Руководство пользователя — SmartRent" },
      {
        name: "description",
        content: "Первые шаги в кабинете SmartRent для собственника, арендатора и управляющего.",
      },
    ],
  }),
  component: GuidePage,
});

const guides = [
  {
    id: "owner",
    title: "Собственнику",
    icon: Building2,
    summary: "От первого объекта до начисления аренды.",
    steps: [
      {
        title: "Добавьте объект",
        text: "Зарегистрируйтесь с ролью «Собственник». В разделе «Объекты» нажмите «Добавить объект», укажите название, адрес и тип недвижимости. Ход настройки виден в блоке «Быстрый старт» в кабинете.",
      },
      {
        title: "Подключите арендатора",
        text: "В разделе «Арендаторы» нажмите «Добавить» и укажите email арендатора. В его карточке нажмите «Скопировать приглашение» и отправьте ссылку арендатору.",
      },
      {
        title: "Создайте и активируйте договор",
        text: "Откройте «Договоры» → «Новый договор». Выберите объект и арендатора, укажите сроки и плату, сохраните черновик и нажмите «На подписание». Когда арендатор подтвердит условия и подписанный PDF будет приложен, нажмите «Активировать».",
      },
      {
        title: "Проверьте первое начисление",
        text: "После активации откройте «Платежи» и найдите начисление по договору. Сообщения об оплате сверяйте с фактическими поступлениями. Обращения арендатора появятся в разделе «Заявки».",
      },
    ],
  },
  {
    id: "tenant",
    title: "Арендатору",
    icon: KeyRound,
    summary: "Ваш договор, начисления и обращения.",
    steps: [
      {
        title: "Подключите кабинет по приглашению",
        text: "Откройте ссылку от собственника и зарегистрируйтесь с тем же email, на который вас пригласили. Если сервис попросит подтвердить email, перейдите по ссылке из письма и войдите в кабинет.",
      },
      {
        title: "Проверьте условия договора",
        text: "В разделе «Мой кабинет» откройте свой договор. Проверьте объект, даты, размер аренды и день оплаты. Если всё верно, приложите подписанный PDF и нажмите «Подписать и отправить».",
      },
      {
        title: "Сообщите об оплате или отправьте заявку",
        text: "Выберите начисление и нажмите «Сообщить об оплате». Укажите сумму и дату, для банковского перевода приложите чек. Чтобы обратиться к собственнику по активному договору, откройте «Заявки» → «Новая заявка».",
      },
    ],
  },
  {
    id: "manager",
    title: "Управляющему",
    icon: Users,
    summary: "Доступ к объектам команды и работа с заявками.",
    steps: [
      {
        title: "Примите приглашение в команду",
        text: "Откройте ссылку от собственника и войдите с указанным в приглашении email. Если аккаунта ещё нет, зарегистрируйтесь с тем же адресом. В разделе «Команда» нажмите «Принять приглашение».",
      },
      {
        title: "Откройте нужный объект",
        text: "В разделе «Команда» найдите блок «Доступные объекты», выберите объект и нажмите «Открыть страницу объекта». Здесь собраны сведения об аренде, заявки и работы по этому объекту.",
      },
      {
        title: "Возьмите заявку в работу",
        text: "На странице объекта нажмите «Все заявки и комментарии команды». В разделе «Заявки по объекту» выберите статус «В работе», нажмите «Сохранить статус» и добавьте комментарий. В роли «Наблюдатель» доступен просмотр.",
      },
    ],
  },
];

function GuidePage() {
  return (
    <div className="min-h-screen bg-[#f5f5f1] text-[#151a1b]">
      <header className="border-b border-black/8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5 font-display text-lg font-bold">
            <span className="grid size-9 place-items-center rounded-xl bg-[#121719] text-white">
              <Building2 aria-hidden="true" className="size-4" />
            </span>
            SmartRent
          </Link>
          <Button asChild className="rounded-full bg-[#121719] px-5 text-white hover:bg-[#263032]">
            <Link to="/auth" search={{ mode: "signin", role: undefined, email: "", name: "" }}>
              Войти
            </Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6 sm:py-12">
        <div className="rounded-[28px] bg-[#dce9e7] p-5 sm:p-9">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#27666b]">Справка</p>
          <h1 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-5xl">
            Руководство пользователя
          </h1>
          <p className="mt-3 max-w-xl text-[#455553]">
            Выберите свою роль, чтобы узнать, с чего начать и где найти нужные действия в кабинете.
          </p>
          <nav aria-label="Выбор роли" className="mt-6 grid gap-2 sm:grid-cols-3">
            {guides.map(({ id, title, icon: Icon }) => (
              <a
                key={id}
                href={`#${id}`}
                className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 text-sm font-semibold hover:bg-[#f5f5f1] sm:px-4"
              >
                <Icon aria-hidden="true" className="size-4 shrink-0 text-[#27666b]" />
                {title}
                <ArrowDown aria-hidden="true" className="ml-auto size-4 shrink-0 text-[#27666b]" />
              </a>
            ))}
          </nav>
        </div>

        {guides.map(({ id, title, summary, steps }) => (
          <section
            key={id}
            id={id}
            aria-labelledby={`${id}-heading`}
            className="scroll-mt-4 rounded-[24px] border border-black/8 bg-white p-5 sm:p-8"
          >
            <h2 id={`${id}-heading`} className="font-display text-2xl font-bold tracking-tight">
              {title}
            </h2>
            <p className="mt-1 text-[#455553]">{summary}</p>
            <ol className="mt-5 space-y-4 pl-6 marker:font-semibold marker:text-[#27666b]">
              {steps.map((step) => (
                <li key={step.title} className="list-decimal pl-1">
                  <h3 className="font-semibold">{step.title}</h3>
                  <p className="mt-1 max-w-prose text-sm leading-relaxed text-[#455553]">
                    {step.text}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        ))}

        <Link
          to="/"
          hash="support"
          className="inline-flex py-2 text-sm font-semibold text-[#27666b] underline underline-offset-4"
        >
          Связаться с поддержкой
        </Link>
      </main>
    </div>
  );
}
