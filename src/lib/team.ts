import type { Json } from "@/integrations/supabase/types";
import type { AgreementStatus, RequestCategory, RequestStatus } from "./domain";

export const TEAM_INVITE_STORAGE_KEY = "nestlink-team-invite";
export type TeamRole = "manager" | "viewer";
export type WorkspaceRole = TeamRole | "owner";
export type TeamProperty = { id: string; name: string; address: string; status: string };
export type TeamMember = {
  id: string;
  owner_id: string;
  owner_name: string;
  email: string;
  name: string | null;
  user_id: string | null;
  role: TeamRole;
  status: "invited" | "active" | "revoked";
  expires_at: string;
  revision: number;
  property_ids: string[];
  created_at: string;
  joined_at: string | null;
};
export type TeamWorkspaceSummary = TeamProperty & {
  owner_id: string;
  owner_name: string;
  membership_id: string | null;
  role: WorkspaceRole;
  responsible_name: string | null;
  unit_count: number;
  active_agreements: number;
  open_requests: number;
};
export type TeamEvent = {
  id: string;
  owner_id: string;
  property_id: string | null;
  membership_id: string | null;
  actor_name: string;
  action: string;
  detail: Json;
  created_at: string;
};
export type TeamOverview = {
  properties: TeamProperty[];
  members: TeamMember[];
  assignments: { property_id: string; membership_id: string }[];
  workspaces: TeamWorkspaceSummary[];
  events: TeamEvent[];
  events_truncated: boolean;
};
export type TeamWorkspace = {
  property: TeamProperty & {
    description: string | null;
    owner_id: string;
    owner_name: string;
    role: WorkspaceRole;
    responsible_name: string | null;
  };
  units: { id: string; name: string; area: number | null; status: string }[];
  agreements: {
    id: string;
    tenant_name: string;
    unit_name: string | null;
    start_date: string;
    end_date: string;
    monthly_payment: number;
    status: AgreementStatus;
  }[];
  requests: {
    id: string;
    title: string;
    description: string;
    category: RequestCategory;
    status: RequestStatus;
    created_at: string;
    tenant_name: string;
    unit_name: string | null;
  }[];
  comments: {
    id: string;
    request_id: string;
    user_name: string;
    text: string;
    created_at: string;
  }[];
  notes: { id: string; text: string; actor_name: string; created_at: string }[];
  notes_truncated: boolean;
  requests_truncated: boolean;
  comments_truncated: boolean;
};

export const teamRoleLabels: Record<WorkspaceRole, string> = {
  owner: "Собственник",
  manager: "Управляющий",
  viewer: "Наблюдатель",
};
export const teamRoleDescriptions: Record<TeamRole, string> = {
  manager:
    "Объекты, помещения, краткие условия аренды и заявки. Ведёт заявки и заметки, готовит сметы и отчёты о ремонте. Видит контакты кандидатов, назначает показы и ведёт отбор. Публикацию, бюджет ремонта и выбор арендатора согласует собственник.",
  viewer:
    "Сведения об объекте, краткие условия аренды, заявки, заметки и ремонты — только просмотр. Контакты кандидатов скрыты.",
};
export function teamMemberStatus(member: TeamMember, now = Date.now()) {
  if (member.status === "active") return "Активен";
  if (member.status === "revoked") return "Доступ отозван";
  return Date.parse(member.expires_at) <= now ? "Приглашение истекло" : "Приглашён";
}
export function teamEventLabel(action: string) {
  const labels: Record<string, string> = {
    invitation_created: "Создано приглашение",
    invitation_accepted: "Приглашение принято",
    member_updated: "Изменён доступ участника",
    member_revoked: "Доступ участника отозван",
    responsible_changed: "Изменён ответственный",
    property_note: "Заметка по объекту",
    request_status: "Изменён статус заявки",
    request_comment: "Комментарий к заявке",
  };
  return labels[action] ?? "Действие команды";
}
