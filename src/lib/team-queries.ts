import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { TeamMember, TeamOverview, TeamRole, TeamWorkspace } from "./team";

export class TeamApiError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}
function fail(error: { message: string; code: string }) {
  throw new TeamApiError(error.message, error.code);
}
export async function fetchTeamOverview(signal?: AbortSignal) {
  let query = supabase.rpc("team_overview");
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error?.code === "PGRST202") return { available: false, overview: null };
  if (error) fail(error);
  const overview = data as unknown as TeamOverview;
  if (
    !overview ||
    ![
      overview.properties,
      overview.members,
      overview.assignments,
      overview.workspaces,
      overview.events,
    ].every(Array.isArray)
  )
    throw new Error("Получен неполный список команды. Обновите страницу.");
  return { available: true, overview };
}
export async function fetchTeamWorkspace(propertyId: string, signal?: AbortSignal) {
  let query = supabase.rpc("team_workspace", { p_property_id: propertyId });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) fail(error);
  const workspace = data as unknown as TeamWorkspace;
  if (
    !workspace?.property ||
    ![
      workspace.units,
      workspace.agreements,
      workspace.requests,
      workspace.comments,
      workspace.notes,
    ].every(Array.isArray)
  )
    throw new Error("Получены неполные сведения об объекте. Обновите раздел.");
  return workspace;
}
export async function inviteTeamMember(values: {
  email: string;
  role: TeamRole;
  propertyIds: string[];
}) {
  const { data, error } = await supabase.rpc("invite_team_member", {
    p_email: values.email.trim(),
    p_role: values.role,
    p_property_ids: values.propertyIds,
  });
  if (error) fail(error);
  const invitation = data as unknown as {
    membership_id: string;
    token: string;
    expires_at: string;
  };
  if (!invitation?.token || !invitation.expires_at)
    throw new Error("Ссылка не получена. Создайте приглашение повторно.");
  return invitation;
}
export async function acceptTeamInvitation(token: string) {
  const { data, error } = await supabase.rpc("accept_team_invitation", { p_token: token });
  if (error) fail(error);
  return data;
}
export async function manageTeamMember(
  member: TeamMember,
  values: { role: TeamRole; propertyIds: string[]; revoke?: boolean },
) {
  const { data, error } = await supabase.rpc("manage_team_member", {
    p_membership_id: member.id,
    p_revision: member.revision,
    p_role: values.role,
    p_property_ids: values.propertyIds,
    p_revoke: Boolean(values.revoke),
  });
  if (error) fail(error);
  return data;
}
export async function setTeamResponsible(propertyId: string, membershipId: string | null) {
  const { data, error } = await supabase.rpc("set_team_responsible", {
    p_property_id: propertyId,
    p_membership_id: membershipId,
  });
  if (error) fail(error);
  return data;
}
export async function actOnTeamProperty(
  propertyId: string,
  action: "note" | "request_status" | "request_comment",
  values: Record<string, Json>,
) {
  const { data, error } = await supabase.rpc("act_on_team_property", {
    p_property_id: propertyId,
    p_action: action,
    p_values: values,
  });
  if (error) fail(error);
  return data;
}
