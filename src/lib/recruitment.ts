import type { TeamWorkspace, WorkspaceRole } from "./team";
export const LISTING_RETURN_KEY = "nestlink-listing-return";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validListingId(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}
export function pendingListing() {
  try {
    const value = sessionStorage.getItem(LISTING_RETURN_KEY);
    return validListingId(value) ? value : null;
  } catch {
    return null;
  }
}
export type ListingDetails = {
  title: string;
  location: string;
  description: string;
  monthly_rent: number;
  deposit: number;
  area: number;
  available_from: string;
  contact_name: string;
  photos: string[];
};
export type PublicListing = {
  public_id: string;
  published_at: string;
  can_apply: boolean;
  details: ListingDetails;
};
export type PropertyListing = {
  id: string;
  public_id: string;
  property_id: string;
  unit_id: string | null;
  status: "draft" | "published" | "paused" | "filled";
  draft: ListingDetails;
  published_snapshot: ListingDetails | null;
  revision: number;
  has_changes: boolean;
  available: boolean;
};
export type ApplicationStatus =
  "new" | "showing" | "shortlisted" | "accepted" | "rejected" | "withdrawn";
export type RentalApplication = {
  id: string;
  public_id: string;
  listing_id: string;
  property_id: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  offer: ListingDetails;
  status: ApplicationStatus;
  showing_at: string | null;
  public_note: string;
  operator_note: string | null;
  agreement_id: string | null;
  revision: number;
  created_at: string;
};
export type HubProperty = {
  id: string;
  name: string;
  address: string;
  description: string | null;
  status: string;
  owner_id: string;
  role: WorkspaceRole;
};
export type PropertyHub = {
  property: HubProperty;
  workspace: TeamWorkspace | null;
  units: { id: string; name: string; area: number | null; status: string }[];
  repairs: {
    id: string;
    title: string;
    status: import("./repairs").RepairStatus;
    due_date: string;
  }[];
  repair_count: number;
  open_requests: number;
  showing_count: number;
  listings: PropertyListing[];
  applications: RentalApplication[];
  application_count: number;
  applications_truncated: boolean;
  events: { id: string; action: string; application_id: string | null; created_at: string }[];
};
export type RecruitmentOverview = {
  properties: HubProperty[];
  applications: RentalApplication[];
  properties_truncated: boolean;
  applications_truncated: boolean;
};
export const applicationLabels: Record<ApplicationStatus, string> = {
  new: "Новый отклик",
  showing: "Назначен показ",
  shortlisted: "В коротком списке",
  accepted: "Выбран собственником",
  rejected: "Отклонён",
  withdrawn: "Отозван кандидатом",
};
export const listingLabels: Record<PropertyListing["status"], string> = {
  draft: "Черновик",
  published: "Опубликовано",
  paused: "Снято с публикации",
  filled: "Кандидат выбран",
};
export const openApplication = (a: RentalApplication) =>
  ["new", "showing", "shortlisted"].includes(a.status);
export function listingUrl(id: string) {
  if (!validListingId(id)) throw new Error("Некорректная ссылка объявления");
  return `/listing/${id}`;
}
