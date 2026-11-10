import type { AgreementStatus } from "@/lib/domain"
import type { UtilityService, UtilityBill, UtilityBillItem } from "@/lib/utilities"
import type { LeaseHandover, HandoverEvent } from "@/lib/handovers"

import type { PropertyExpense, ExpenseEvent } from "@/lib/property-finances"

import type { LeaseAmendment, AmendmentEvent } from "@/lib/lease-changes"

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      lease_amendments: { Row: LeaseAmendment; Insert: never; Update: never; Relationships: [] }
      lease_amendment_events: { Row: AmendmentEvent; Insert: never; Update: never; Relationships: [] }
      property_expenses: { Row: PropertyExpense; Insert: never; Update: never; Relationships: [] }
      property_expense_events: { Row: ExpenseEvent; Insert: never; Update: never; Relationships: [] }
      lease_handovers: { Row: LeaseHandover; Insert: never; Update: never; Relationships: [] }
      lease_handover_events: { Row: HandoverEvent; Insert: never; Update: never; Relationships: [] }
      utility_services: {
        Row: UtilityService
        Insert: Omit<UtilityService, "id" | "created_at"> & { id?: string; created_at?: string }
        Update: Partial<UtilityService>
        Relationships: [{ foreignKeyName: "utility_services_agreement_id_fkey"; columns: ["agreement_id"]; isOneToOne: false; referencedRelation: "lease_agreements"; referencedColumns: ["id"] }]
      }
      utility_bills: {
        Row: UtilityBill
        Insert: Omit<UtilityBill, "id" | "created_at"> & { id?: string; created_at?: string }
        Update: Partial<UtilityBill>
        Relationships: [{ foreignKeyName: "utility_bills_agreement_id_fkey"; columns: ["agreement_id"]; isOneToOne: false; referencedRelation: "lease_agreements"; referencedColumns: ["id"] }]
      }
      utility_bill_items: {
        Row: UtilityBillItem
        Insert: Omit<UtilityBillItem, "id"> & { id?: string }
        Update: Partial<UtilityBillItem>
        Relationships: [{ foreignKeyName: "utility_bill_items_bill_id_fkey"; columns: ["bill_id"]; isOneToOne: false; referencedRelation: "utility_bills"; referencedColumns: ["id"] }]
      }
      agreement_acceptances: {
        Row: {
          accepted_at: string
          accepted_by: string | null
          agreement_id: string
          agreement_version: string
          id: string
          photos: string[]
        }
        Insert: {
          accepted_at?: string
          accepted_by?: string | null
          agreement_id: string
          agreement_version: string
          id?: string
          photos?: string[]
        }
        Update: {
          accepted_at?: string
          accepted_by?: string | null
          agreement_id?: string
          agreement_version?: string
          id?: string
          photos?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "agreement_acceptances_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "lease_agreements"
            referencedColumns: ["id"]
          },
        ]
      }
      agreement_status_events: {
        Row: {
          agreement_id: string
          changed_by: string | null
          created_at: string
          from_status: AgreementStatus | null
          id: string
          to_status: AgreementStatus
        }
        Insert: {
          agreement_id: string
          changed_by?: string | null
          created_at?: string
          from_status?: AgreementStatus | null
          id?: string
          to_status: AgreementStatus
        }
        Update: {
          agreement_id?: string
          changed_by?: string | null
          created_at?: string
          from_status?: AgreementStatus | null
          id?: string
          to_status?: AgreementStatus
        }
        Relationships: [
          {
            foreignKeyName: "agreement_status_events_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "lease_agreements"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          created_at: string
          id: string
          request_id: string
          text: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          request_id: string
          text: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          request_id?: string
          text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      lease_agreements: {
        Row: {
          contract_details: Json
          created_at: string
          document_file: string | null
          end_date: string
          id: string
          monthly_payment: number
          owner_id: string
          payment_due_day: number | null
          property_id: string
          signed_at: string | null
          signed_document_file: string | null
          start_date: string
          status: AgreementStatus
          status_changed_at: string
          team_prepared: boolean
          tenant_id: string
          unit_id: string | null
        }
        Insert: {
          contract_details?: Json
          created_at?: string
          document_file?: string | null
          end_date: string
          id?: string
          monthly_payment?: number
          owner_id: string
          payment_due_day?: number | null
          property_id: string
          signed_at?: string | null
          signed_document_file?: string | null
          start_date: string
          status?: AgreementStatus
          status_changed_at?: string
          team_prepared?: boolean
          tenant_id: string
          unit_id?: string | null
        }
        Update: {
          contract_details?: Json
          created_at?: string
          document_file?: string | null
          end_date?: string
          id?: string
          monthly_payment?: number
          owner_id?: string
          payment_due_day?: number | null
          property_id?: string
          signed_at?: string | null
          signed_document_file?: string | null
          start_date?: string
          status?: AgreementStatus
          status_changed_at?: string
          team_prepared?: boolean
          tenant_id?: string
          unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lease_agreements_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lease_agreements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lease_agreements_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          dedupe_key: string | null
          entity_id: string
          entity_type: string
          href: string
          id: string
          kind: string
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          dedupe_key?: string | null
          entity_id: string
          entity_type: string
          href: string
          id?: string
          kind: string
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          dedupe_key?: string | null
          entity_id?: string
          entity_type?: string
          href?: string
          id?: string
          kind?: string
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      payment_reports: {
        Row: {
          amount: number
          cancelled_at: string | null
          charge_id: string
          created_at: string
          id: string
          note: string | null
          owner_id: string
          paid_at: string
          payment_id: string | null
          payment_method: string
          receipt_file: string | null
          reported_by: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          amount: number
          cancelled_at?: string | null
          charge_id: string
          created_at?: string
          id?: string
          note?: string | null
          owner_id: string
          paid_at: string
          payment_id?: string | null
          payment_method: string
          receipt_file?: string | null
          reported_by?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          amount?: number
          cancelled_at?: string | null
          charge_id?: string
          created_at?: string
          id?: string
          note?: string | null
          owner_id?: string
          paid_at?: string
          payment_id?: string | null
          payment_method?: string
          receipt_file?: string | null
          reported_by?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_reports_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "rent_charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reports_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "rent_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_settings: {
        Row: {
          agreement_expiring_enabled: boolean
          enabled: boolean
          notify_owner: boolean
          notify_tenant: boolean
          owner_id: string
          payment_due_enabled: boolean
          payment_overdue_enabled: boolean
          updated_at: string
        }
        Insert: {
          agreement_expiring_enabled?: boolean
          enabled?: boolean
          notify_owner?: boolean
          notify_tenant?: boolean
          owner_id: string
          payment_due_enabled?: boolean
          payment_overdue_enabled?: boolean
          updated_at?: string
        }
        Update: {
          agreement_expiring_enabled?: boolean
          enabled?: boolean
          notify_owner?: boolean
          notify_tenant?: boolean
          owner_id?: string
          payment_due_enabled?: boolean
          payment_overdue_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string
          phone: string | null
        }
        Insert: {
          created_at?: string
          email?: string
          id: string
          name?: string
          phone?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string
          phone?: string | null
        }
        Relationships: []
      }
      property_activity_events: {
        Row: {
          actor_id: string | null
          created_at: string
          details: Json
          entity_id: string
          entity_type: string
          event_type: string
          id: string
          property_id: string
          title: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity_id: string
          entity_type: string
          event_type: string
          id?: string
          property_id: string
          title: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity_id?: string
          entity_type?: string
          event_type?: string
          id?: string
          property_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_activity_events_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          address: string
          created_at: string
          description: string | null
          id: string
          name: string
          owner_id: string
          photos: string[]
          status: string
          type: Database["public"]["Enums"]["property_type"]
        }
        Insert: {
          address?: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          owner_id: string
          photos?: string[]
          status?: string
          type?: Database["public"]["Enums"]["property_type"]
        }
        Update: {
          address?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          owner_id?: string
          photos?: string[]
          status?: string
          type?: Database["public"]["Enums"]["property_type"]
        }
        Relationships: []
      }
      requests: {
        Row: {
          category: Database["public"]["Enums"]["request_category"]
          created_at: string
          description: string
          id: string
          owner_id: string
          photo: string | null
          property_id: string | null
          status: Database["public"]["Enums"]["request_status"]
          tenant_id: string
          title: string
          unit_id: string | null
        }
        Insert: {
          category?: Database["public"]["Enums"]["request_category"]
          created_at?: string
          description?: string
          id?: string
          owner_id: string
          photo?: string | null
          property_id?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          tenant_id: string
          title: string
          unit_id?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["request_category"]
          created_at?: string
          description?: string
          id?: string
          owner_id?: string
          photo?: string | null
          property_id?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          tenant_id?: string
          title?: string
          unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "requests_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      request_status_events: {
        Row: {
          changed_by: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["request_status"] | null
          id: string
          request_id: string
          to_status: Database["public"]["Enums"]["request_status"]
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["request_status"] | null
          id?: string
          request_id: string
          to_status: Database["public"]["Enums"]["request_status"]
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["request_status"] | null
          id?: string
          request_id?: string
          to_status?: Database["public"]["Enums"]["request_status"]
        }
        Relationships: [
          {
            foreignKeyName: "request_status_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      support_requests: {
        Row: {
          admin_response: string | null
          category: "question" | "access" | "billing" | "technical" | "other"
          created_at: string
          id: string
          message: string
          requester_email: string
          requester_name: string
          source: "landing" | "account"
          status: "new" | "in_progress" | "resolved"
          updated_at: string
          user_id: string | null
        }
        Insert: {
          admin_response?: string | null
          category: "question" | "access" | "billing" | "technical" | "other"
          created_at?: string
          id?: string
          message: string
          requester_email: string
          requester_name: string
          source: "landing" | "account"
          status?: "new" | "in_progress" | "resolved"
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          admin_response?: string | null
          category?: "question" | "access" | "billing" | "technical" | "other"
          created_at?: string
          id?: string
          message?: string
          requester_email?: string
          requester_name?: string
          source?: "landing" | "account"
          status?: "new" | "in_progress" | "resolved"
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      rent_charges: {
        Row: {
          adjusted_at: string | null
          adjusted_by: string | null
          adjustment_amount: number
          adjustment_reason: string | null
          agreement_id: string
          amount: number
          charge_type: "rent" | "utilities"
          created_at: string
          due_date: string
          id: string
          owner_id: string
          paid_at: string | null
          paid_amount: number
          payment_note: string | null
          period_start: string
          tenant_id: string
        }
        Insert: {
          adjusted_at?: string | null
          adjusted_by?: string | null
          adjustment_amount?: number
          adjustment_reason?: string | null
          agreement_id: string
          amount: number
          charge_type?: "rent" | "utilities"
          created_at?: string
          due_date: string
          id?: string
          owner_id: string
          paid_at?: string | null
          paid_amount?: number
          payment_note?: string | null
          period_start: string
          tenant_id: string
        }
        Update: {
          adjusted_at?: string | null
          adjusted_by?: string | null
          adjustment_amount?: number
          adjustment_reason?: string | null
          agreement_id?: string
          amount?: number
          charge_type?: "rent" | "utilities"
          created_at?: string
          due_date?: string
          id?: string
          owner_id?: string
          paid_at?: string | null
          paid_amount?: number
          payment_note?: string | null
          period_start?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rent_charges_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "lease_agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rent_charges_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rent_payments: {
        Row: {
          amount: number
          charge_id: string
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          owner_id: string
          paid_at: string
          payment_method: "bank_transfer" | "cash"
          receipt_file: string | null
          tenant_id: string
        }
        Insert: {
          amount: number
          charge_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          owner_id: string
          paid_at: string
          payment_method?: "bank_transfer" | "cash"
          receipt_file?: string | null
          tenant_id: string
        }
        Update: {
          amount?: number
          charge_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          owner_id?: string
          paid_at?: string
          payment_method?: "bank_transfer" | "cash"
          receipt_file?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rent_payments_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "rent_charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rent_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rent_charge_adjustment_events: {
        Row: {
          adjustment_amount: number
          changed_by: string | null
          charge_id: string
          created_at: string
          id: string
          previous_adjustment_amount: number
          reason: string
        }
        Insert: {
          adjustment_amount: number
          changed_by?: string | null
          charge_id: string
          created_at?: string
          id?: string
          previous_adjustment_amount: number
          reason: string
        }
        Update: {
          adjustment_amount?: number
          changed_by?: string | null
          charge_id?: string
          created_at?: string
          id?: string
          previous_adjustment_amount?: number
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "rent_charge_adjustment_events_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "rent_charges"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string
          owner_id: string
          phone: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string
          id?: string
          name: string
          owner_id: string
          phone?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string
          owner_id?: string
          phone?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      units: {
        Row: {
          area: number | null
          created_at: string
          id: string
          name: string
          property_id: string
          status: string
        }
        Insert: {
          area?: number | null
          created_at?: string
          id?: string
          name: string
          property_id: string
          status?: string
        }
        Update: {
          area?: number | null
          created_at?: string
          id?: string
          name?: string
          property_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "units_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      workspace_search: { Args: { p_query: string }; Returns: Json }
      workspace_search_team_request: { Args: { p_id: string }; Returns: Json }
      rental_calendar: { Args: { p_from: string; p_to: string; p_timezone?: string; p_property_id?: string | null; p_responsible_id?: string | null }; Returns: Json }
      rental_calendar_application: { Args: { p_id: string }; Returns: Json }
      rental_calendar_repair: { Args: { p_id: string }; Returns: Json }
      telegram_overview: { Args: Record<string, never>; Returns: Json }
      begin_telegram_link: { Args: Record<string, never>; Returns: Json }
      confirm_telegram_link: { Args: { p_id: string }; Returns: undefined }
      disconnect_telegram: { Args: Record<string, never>; Returns: undefined }
      save_telegram_preferences: { Args: { p_enabled: boolean; p_topics: string[] }; Returns: undefined }
      test_telegram_delivery: { Args: Record<string, never>; Returns: string }
      property_catalog: { Args: { p_filters: Json; p_cursor: Json }; Returns: Json }
      public_property_catalog: { Args: { p_filters: Json; p_cursor: Json }; Returns: Json }
      set_catalog_property_status: { Args: { p_id: string; p_expected: string; p_status: string }; Returns: string }
      public_listing: { Args: { p_public_id: string }; Returns: Json }
      property_hub: { Args: { p_property_id: string }; Returns: Json }
      recruitment_overview: { Args: Record<string, never>; Returns: Json }
      save_property_listing: { Args: { p_property_id: string; p_id: string | null; p_unit_id: string | null; p_values: Json; p_revision: number | null }; Returns: string }
      act_on_property_listing: { Args: { p_id: string; p_action: string; p_revision: number }; Returns: string }
      apply_to_listing: { Args: { p_public_id: string; p_values: Json }; Returns: string }
      act_on_rental_application: { Args: { p_id: string; p_action: string; p_revision: number; p_values: Json }; Returns: string }
      repairs_overview: { Args: Record<string, never>; Returns: Json }
      save_repair_contractor: { Args: { p_owner_id: string; p_id: string | null; p_values: Json; p_revision: number | null }; Returns: string }
      save_repair_job: { Args: { p_property_id: string; p_id: string | null; p_values: Json; p_revision: number | null }; Returns: string }
      act_on_repair_job: { Args: { p_id: string; p_action: string; p_revision: number; p_values: Json }; Returns: string }
      team_overview: { Args: Record<string, never>; Returns: Json }
      team_workspace: { Args: { p_property_id: string }; Returns: Json }
      invite_team_member: { Args: { p_email: string; p_role: string; p_property_ids: string[] }; Returns: Json }
      accept_team_invitation: { Args: { p_token: string }; Returns: string }
      manage_team_member: { Args: { p_membership_id: string; p_revision: number; p_role: string; p_property_ids: string[]; p_revoke?: boolean }; Returns: string }
      set_team_responsible: { Args: { p_property_id: string; p_membership_id: string | null }; Returns: string }
      create_team_agreement_draft: {
        Args: {
          p_property_id: string
          p_tenant_id: string
          p_draft_id: string
          p_start_date: string
          p_end_date: string
          p_monthly_payment: number
          p_unit_id?: string | null
          p_payment_due_day?: number | null
        }
        Returns: string
      }
      act_on_team_property: { Args: { p_property_id: string; p_action: string; p_values: Json }; Returns: string }
      save_lease_amendment: { Args: { p_agreement_id: string; p_values: Json; p_id: string | null; p_revision: number | null }; Returns: string }
      act_on_lease_amendment: { Args: { p_id: string; p_action: string; p_revision: number; p_note: string | null }; Returns: string }
      save_property_expense: { Args: { p_property_id: string; p_values: Json; p_expense_id: string | null; p_expected_revision: number | null; p_reason: string | null }; Returns: string }
      save_lease_handover: { Args: { p_agreement_id: string; p_kind: string; p_report: Json; p_expected_revision: number | null }; Returns: string }
      act_on_lease_handover: { Args: { p_handover_id: string; p_action: string; p_expected_revision: number; p_note: string | null }; Returns: string }
      save_utility_service: { Args: { p_agreement_id: string; p_service: Json }; Returns: string }
      submit_utility_readings: { Args: { p_agreement_id: string; p_period: string; p_readings: Json }; Returns: string }
      review_utility_bill: { Args: { p_bill_id: string; p_approve: boolean; p_note: string | null; p_due_date: string }; Returns: string }
      cancel_payment_report: {
        Args: { p_report_id: string }
        Returns: string
      }
      can_see_request: { Args: { _request_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_my_tenant_record: { Args: { _tenant_id: string }; Returns: boolean }
      owns_property: { Args: { _property_id: string }; Returns: boolean }
      review_payment_report: {
        Args: {
          p_approve: boolean
          p_report_id: string
          p_review_note?: string
        }
        Returns: string
      }
      send_payment_reminder: {
        Args: { p_agreement_id: string }
        Returns: string
      }
      submit_signed_agreement: {
        Args: { p_agreement_id: string; p_document_path: string }
        Returns: string
      }
      submit_tenant_agreement: {
        Args: {
          p_agreement_id: string
          p_agreement_version: string
          p_document_path: string
          p_photo_paths?: string[]
        }
        Returns: string
      }
      tenant_can_see_property: {
        Args: { _property_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "owner" | "tenant"
      property_type: "apartment" | "warehouse" | "commercial" | "other"
      request_category: "repair" | "question" | "payment" | "other"
      request_status: "new" | "in_progress" | "closed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "owner", "tenant"],
      property_type: ["apartment", "warehouse", "commercial", "other"],
      request_category: ["repair", "question", "payment", "other"],
      request_status: ["new", "in_progress", "closed"],
    },
  },
} as const
