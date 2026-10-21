import { TEAM_INVITE_STORAGE_KEY } from "./team.ts";

export function invitationTokenFromHash(hash: string): string | null {
  if (!hash.startsWith("#")) return null;
  const value = new URLSearchParams(hash.replace(/^#/, "")).get("invite");
  return value && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

export function hasPendingTeamInvitation(): boolean {
  try {
    return /^[0-9a-f]{64}$/.test(sessionStorage.getItem(TEAM_INVITE_STORAGE_KEY) ?? "");
  } catch {
    return false;
  }
}
