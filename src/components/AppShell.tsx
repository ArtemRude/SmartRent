import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  ArrowUp,
  Building2,
  CreditCard,
  CalendarClock,
  WalletCards,
  Gauge,
  ChartNoAxesCombined,
  KeyRound,
  FileText,
  Home,
  Inbox,
  LifeBuoy,
  LogOut,
  Menu,
  ShieldCheck,
  Users,
  UsersRound,
  UserRound,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/auth-context";
import { roleLabels } from "@/lib/domain";
import { useRentalUpdates } from "@/hooks/use-rental-updates";
import { notificationQueryOptions, NOTIFICATION_REFRESH_INTERVAL } from "@/lib/notification-query";
import { cn } from "@/lib/utils";
import { BillingSummaryCard } from "@/components/BillingSummaryCard";

type NavItem = { to: string; label: string; icon: typeof Home };

const ownerNav: NavItem[] = [
  { to: "/dashboard", label: "Мой кабинет", icon: Home },
  { to: "/properties", label: "Объекты", icon: Building2 },
  { to: "/tenants", label: "Арендаторы", icon: Users },
  { to: "/agreements", label: "Договоры", icon: FileText },
  { to: "/payments", label: "Платежи", icon: CreditCard },
  { to: "/finances", label: "Расходы и прибыль", icon: ChartNoAxesCombined },
  { to: "/utilities", label: "Коммунальные услуги", icon: Gauge },
  { to: "/handover", label: "Заселение и выезд", icon: KeyRound },
  { to: "/lease-changes", label: "Изменения условий", icon: CalendarClock },
  { to: "/team", label: "Команда", icon: UsersRound },
  { to: "/recruitment", label: "Поиск арендаторов", icon: UsersRound },
  { to: "/requests", label: "Заявки", icon: Inbox },
  { to: "/repairs", label: "Ремонты и подрядчики", icon: Wrench },
  { to: "/notifications", label: "Уведомления", icon: Bell },
  { to: "/billing", label: "Тариф и доступ", icon: WalletCards },
  { to: "/support", label: "Поддержка", icon: LifeBuoy },
];

const tenantNav: NavItem[] = [
  { to: "/portfolio", label: "Объекты команды", icon: Building2 },
  { to: "/cabinet", label: "Мой кабинет", icon: Home },
  { to: "/payments", label: "Платежи", icon: CreditCard },
  { to: "/utilities", label: "Коммунальные услуги", icon: Gauge },
  { to: "/handover", label: "Заселение и выезд", icon: KeyRound },
  { to: "/lease-changes", label: "Изменения условий", icon: CalendarClock },
  { to: "/team", label: "Команда", icon: UsersRound },
  { to: "/recruitment", label: "Поиск арендаторов", icon: UsersRound },
  { to: "/requests", label: "Заявки", icon: Inbox },
  { to: "/repairs", label: "Ход ремонта", icon: Wrench },
  { to: "/notifications", label: "Уведомления", icon: Bell },
  { to: "/support", label: "Поддержка", icon: LifeBuoy },
];

const adminNav: NavItem[] = [
  { to: "/admin", label: "Администрирование", icon: ShieldCheck },
  ...ownerNav,
];

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Building2 className="h-4 w-4" />
      </span>
      <span className="font-display text-lg font-semibold tracking-tight">SmartRent</span>
    </div>
  );
}

function NavList({
  items,
  unreadCount,
  onNavigate,
}: {
  items: NavItem[];
  unreadCount: number;
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const active =
          pathname === item.to ||
          pathname.startsWith(item.to + "/") ||
          (pathname.startsWith("/objects/") &&
            item.to ===
              (items.some((entry) => entry.to === "/properties") ? "/properties" : "/team"));
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
            {item.to === "/notifications" && unreadCount > 0 && (
              <span className="ml-auto min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-[11px] leading-4 text-primary-foreground">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const updateVisibility = () => setVisible(window.scrollY > 480);
    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });
    return () => window.removeEventListener("scroll", updateVisibility);
  }, []);

  if (!visible) return null;

  return (
    <Button
      type="button"
      size="icon"
      className="fixed bottom-5 right-5 z-30 h-11 w-11 rounded-full shadow-lg md:bottom-7 md:right-7"
      aria-label="Наверх страницы"
      title="Наверх"
      onClick={() =>
        window.scrollTo({
          top: 0,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        })
      }
    >
      <ArrowUp className="h-5 w-5" />
    </Button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, profile, role, signOut } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const items = role === "tenant" ? tenantNav : role === "admin" ? adminNav : ownerNav;
  const notifications = useQuery({
    ...notificationQueryOptions(user?.id),
    refetchInterval: NOTIFICATION_REFRESH_INTERVAL,
  });
  useRentalUpdates(user?.id, notifications.data);
  const unreadCount = (notifications.data ?? []).filter(
    (notification) => notification.read_at == null,
  ).length;

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/", replace: true });
  };

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 md:flex">
        <Link to="/" className="mb-6 block">
          <Brand />
        </Link>
        <NavList items={items} unreadCount={unreadCount} />
        <div className="mt-auto rounded-xl border border-sidebar-border bg-card p-3">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-accent-foreground">
              <UserRound className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{profile?.name ?? "Пользователь"}</p>
              <p className="truncate text-xs text-muted-foreground">
                {role ? roleLabels[role] : ""}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full justify-start text-muted-foreground"
            onClick={handleSignOut}
          >
            <LogOut className="mr-2 h-4 w-4" /> Выйти
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/85 px-4 py-3 backdrop-blur md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Меню">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-sidebar p-4">
              <SheetTitle className="sr-only">Навигация</SheetTitle>
              <div className="mb-6">
                <Brand />
              </div>
              <NavList items={items} unreadCount={unreadCount} onNavigate={() => setOpen(false)} />
              <Button
                variant="ghost"
                size="sm"
                className="mt-6 w-full justify-start text-muted-foreground"
                onClick={handleSignOut}
              >
                <LogOut className="mr-2 h-4 w-4" /> Выйти
              </Button>
            </SheetContent>
          </Sheet>
          <Brand />
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-10">
          {role !== "tenant" && role !== null && pathname !== "/billing" && <BillingSummaryCard />}
          {children}
        </main>
        <ScrollToTopButton />
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold md:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
