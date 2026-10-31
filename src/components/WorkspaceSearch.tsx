import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Building2, FileText, Inbox, LoaderCircle, Users } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/auth-context";
import {
  fetchWorkspaceSearch,
  normalizeWorkspaceSearch,
  searchKinds,
  SEARCH_DEBOUNCE_MS,
  SEARCH_MAX_LENGTH,
  SEARCH_MIN_LENGTH,
  workspaceSearchHref,
  type SearchKind,
} from "@/lib/workspace-search";

const groups: Record<SearchKind, { label: string; icon: typeof Building2 }> = {
  property: { label: "Объекты", icon: Building2 },
  tenant: { label: "Арендаторы", icon: Users },
  agreement: { label: "Договоры", icon: FileText },
  request: { label: "Заявки", icon: Inbox },
};

export function WorkspaceSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [debounced, setDebounced] = useState("");
  const returnFocus = useRef<HTMLElement | null>(null);
  const query = normalizeWorkspaceSearch(input);
  const waiting = query !== debounced;
  const eligible = query.length >= SEARCH_MIN_LENGTH && query.length <= SEARCH_MAX_LENGTH;
  const changeOpen = useCallback(
    (next: boolean) => {
      if (!next) {
        setInput("");
        setDebounced("");
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [query]);
  useEffect(() => {
    if (!user) return;
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        if (!open && document.querySelector('[role="dialog"]')) return;
        event.preventDefault();
        changeOpen(!open);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [changeOpen, open, user]);
  const results = useQuery({
    queryKey: ["workspace-search", user?.id, role, debounced],
    queryFn: ({ signal }) => fetchWorkspaceSearch(debounced, signal),
    enabled: Boolean(user && role && open && eligible && !waiting),
    retry: false,
    staleTime: 0,
    gcTime: 30_000,
  });
  const loading = eligible && (waiting || results.isPending || results.isFetching);
  const items = !loading && !results.isError && eligible ? (results.data?.items ?? []) : [];
  if (!user || !role) return null;
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent
        className="w-[calc(100%_-_2rem)] max-w-xl gap-0 overflow-hidden rounded-2xl p-0"
        onOpenAutoFocus={() => {
          if (document.activeElement instanceof HTMLElement)
            returnFocus.current = document.activeElement;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocus.current?.isConnected) returnFocus.current.focus();
        }}
      >
        <div className="px-5 pb-3 pt-5 pr-12">
          <DialogTitle>Поиск по кабинету</DialogTitle>
          <DialogDescription className="mt-1 text-xs">
            Объекты, арендаторы, договоры и заявки, доступные вам.
          </DialogDescription>
        </div>
        <Command shouldFilter={false} label="Поиск по кабинету" className="rounded-none">
          <CommandInput
            aria-label="Поиск по кабинету"
            placeholder="Название, адрес, имя или номер…"
            value={input}
            onValueChange={setInput}
            maxLength={SEARCH_MAX_LENGTH}
            className="h-12"
          />
          <CommandList
            aria-label="Результаты поиска"
            className="max-h-[min(55dvh,420px)] scroll-py-2 p-2"
          >
            {!eligible && (
              <p role="status" className="px-3 py-8 text-center text-sm text-muted-foreground">
                Введите хотя бы два символа.
              </p>
            )}
            {loading && (
              <p
                role="status"
                className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground"
              >
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Ищем…
              </p>
            )}
            {eligible && !loading && results.isError && (
              <div className="space-y-3 px-3 py-7 text-center">
                <p role="alert" className="text-sm">
                  Поиск пока недоступен. Попробуйте позже.
                </p>
                <Button variant="outline" size="sm" onClick={() => void results.refetch()}>
                  Повторить поиск
                </Button>
              </div>
            )}
            {eligible &&
              !loading &&
              !results.isError &&
              results.isSuccess &&
              items.length === 0 && (
                <div role="status" className="space-y-1 px-3 py-8 text-center">
                  <p className="text-sm font-medium">Ничего не найдено</p>
                  <p className="text-xs text-muted-foreground">
                    Попробуйте другое имя, название или адрес.
                  </p>
                </div>
              )}
            {searchKinds.map((kind) => {
              const grouped = items.filter((item) => item.kind === kind);
              const { label, icon: Icon } = groups[kind];
              return grouped.length > 0 ? (
                <CommandGroup key={kind} heading={label}>
                  {grouped.map((item) => (
                    <CommandItem
                      key={`${kind}:${item.id}`}
                      value={`${kind}:${item.id}`}
                      className="gap-3 rounded-lg px-3 py-3"
                      onSelect={() => {
                        changeOpen(false);
                        void navigate({ to: workspaceSearchHref(item, role) });
                      }}
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm font-medium">{item.title}</span>
                        {item.subtitle && (
                          <span className="mt-0.5 block break-words text-xs text-muted-foreground">
                            {item.subtitle}
                          </span>
                        )}
                      </span>
                      <ArrowUpRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null;
            })}
          </CommandList>
          <div className="border-t px-5 py-3 text-xs text-muted-foreground" aria-live="polite">
            {!loading && eligible && results.data?.has_more && !results.isError
              ? "Показаны первые совпадения. Уточните запрос."
              : "↑ ↓ — выбрать · Enter — открыть · Esc — закрыть"}
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
