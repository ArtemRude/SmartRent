export const ISOLATED_SIGN_IN_URL = "/auth?session=isolated";

const TAB_ID_KEY = "smartrent-isolated-auth-tab";

export function isolatedAuthStorageKey(supabaseUrl: string): string | undefined {
  if (typeof window === "undefined") return undefined;

  const { pathname, search } = window.location;
  let tabId = sessionStorage.getItem(TAB_ID_KEY);
  if (!tabId && pathname === "/auth" && new URLSearchParams(search).get("session") === "isolated") {
    tabId = crypto.randomUUID();
    sessionStorage.setItem(TAB_ID_KEY, tabId);
  }

  // Supabase also uses the storage key as its BroadcastChannel name.
  return tabId ? `sb-${new URL(supabaseUrl).host}-tab-${tabId}` : undefined;
}

export function isIsolatedAuthTab(): boolean {
  return typeof window !== "undefined" && sessionStorage.getItem(TAB_ID_KEY) !== null;
}
