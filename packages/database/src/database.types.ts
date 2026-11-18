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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      affiliation_requests: {
        Row: {
          created_at: string
          decision_code: string | null
          id: string
          institution: string
          member_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          decision_code?: string | null
          id: string
          institution: string
          member_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          decision_code?: string | null
          id?: string
          institution?: string
          member_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliation_requests_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliation_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_members: {
        Row: {
          conversation_id: string
          granted_at: string
          member_id: string
          revoked_at: string | null
          role: string
        }
        Insert: {
          conversation_id: string
          granted_at?: string
          member_id: string
          revoked_at?: string | null
          role: string
        }
        Update: {
          conversation_id?: string
          granted_at?: string
          member_id?: string
          revoked_at?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_reads: {
        Row: {
          conversation_id: string
          last_sequence: number
          member_id: string
          updated_at: string
        }
        Insert: {
          conversation_id: string
          last_sequence?: number
          member_id: string
          updated_at?: string
        }
        Update: {
          conversation_id?: string
          last_sequence?: number
          member_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_reads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_reads_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          kind: string
          next_sequence: number
          requester_id: string
          status: string
          support_category: string | null
          support_escalated: boolean
          support_order_id: string | null
          support_updated_at: string | null
          support_version: number
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string
          next_sequence?: number
          requester_id: string
          status?: string
          support_category?: string | null
          support_escalated?: boolean
          support_order_id?: string | null
          support_updated_at?: string | null
          support_version?: number
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          next_sequence?: number
          requester_id?: string
          status?: string
          support_category?: string | null
          support_escalated?: boolean
          support_order_id?: string | null
          support_updated_at?: string | null
          support_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversations_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_support_order_id_fkey"
            columns: ["support_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          area: string
          bound: number
          budget: number
          capacity: number
          category: string
          created_at: string
          cutoff_at: string
          destination: string
          end_at: string
          fee: number
          id: string
          items: Json
          negotiable: boolean
          owner_id: string
          shop: string
          spending_capacity: number
          start_at: string
          status: string
          title: string
          type: string
          version: number
        }
        Insert: {
          area: string
          bound: number
          budget: number
          capacity: number
          category: string
          created_at?: string
          cutoff_at: string
          destination: string
          end_at: string
          fee: number
          id: string
          items: Json
          negotiable: boolean
          owner_id: string
          shop: string
          spending_capacity: number
          start_at: string
          status: string
          title: string
          type: string
          version?: number
        }
        Update: {
          area?: string
          bound?: number
          budget?: number
          capacity?: number
          category?: string
          created_at?: string
          cutoff_at?: string
          destination?: string
          end_at?: string
          fee?: number
          id?: string
          items?: Json
          negotiable?: boolean
          owner_id?: string
          shop?: string
          spending_capacity?: number
          start_at?: string
          status?: string
          title?: string
          type?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "listings_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          created_at: string
          display_name: string
          id: string
          status: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id: string
          status?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          status?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          body: string
          client_message_id: string | null
          conversation_id: string
          created_at: string
          id: string
          sender_id: string
          sequence: number
        }
        Insert: {
          body: string
          client_message_id?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          sender_id: string
          sequence: number
        }
        Update: {
          body?: string
          client_message_id?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          sender_id?: string
          sequence?: number
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          email_enabled: boolean
          event_type: string
          recipient_id: string
        }
        Insert: {
          email_enabled: boolean
          event_type: string
          recipient_id: string
        }
        Update: {
          email_enabled?: boolean
          event_type?: string
          recipient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          created_at: string
          event_id: string
          event_type: string
          id: string
          read_at: string | null
          recipient_id: string
          target_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_id: string
          event_type: string
          id?: string
          read_at?: string | null
          recipient_id: string
          target_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_id?: string
          event_type?: string
          id?: string
          read_at?: string | null
          recipient_id?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_revisions: {
        Row: {
          created_at: string
          fee: number
          listing_version: number
          offer_id: string
          status: string
          terms: Json
          version: number
        }
        Insert: {
          created_at?: string
          fee: number
          listing_version: number
          offer_id: string
          status: string
          terms: Json
          version: number
        }
        Update: {
          created_at?: string
          fee?: number
          listing_version?: number
          offer_id?: string
          status?: string
          terms?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "offer_revisions_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          author_id: string
          created_at: string
          fee: number
          id: string
          listing_id: string
          listing_version: number
          owner_id: string
          status: string
          version: number
        }
        Insert: {
          author_id: string
          created_at?: string
          fee: number
          id: string
          listing_id: string
          listing_version: number
          owner_id: string
          status: string
          version: number
        }
        Update: {
          author_id?: string
          created_at?: string
          fee?: number
          id?: string
          listing_id?: string
          listing_version?: number
          owner_id?: string
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "offers_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      order_terms: {
        Row: {
          created_at: string
          listing_version: number
          offer_version: number | null
          order_id: string
          terms: Json
        }
        Insert: {
          created_at?: string
          listing_version: number
          offer_version?: number | null
          order_id: string
          terms: Json
        }
        Update: {
          created_at?: string
          listing_version?: number
          offer_version?: number | null
          order_id?: string
          terms?: Json
        }
        Relationships: [
          {
            foreignKeyName: "order_terms_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          conversation_id: string
          created_at: string
          customer_id: string
          id: string
          listing_id: string
          offer_id: string | null
          provider_id: string
          request_id: string | null
          state: string
          trip_id: string | null
        }
        Insert: {
          conversation_id: string
          created_at?: string
          customer_id: string
          id?: string
          listing_id: string
          offer_id?: string | null
          provider_id: string
          request_id?: string | null
          state?: string
          trip_id?: string | null
        }
        Update: {
          conversation_id?: string
          created_at?: string
          customer_id?: string
          id?: string
          listing_id?: string
          offer_id?: string | null
          provider_id?: string
          request_id?: string | null
          state?: string
          trip_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: true
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          amount: number
          customer_id: string
          expires_at: string
          funding_verified_at: string | null
          listing_id: string
          order_id: string
          released_at: string | null
        }
        Insert: {
          amount: number
          customer_id: string
          expires_at: string
          funding_verified_at?: string | null
          listing_id: string
          order_id: string
          released_at?: string | null
        }
        Update: {
          amount?: number
          customer_id?: string
          expires_at?: string
          funding_verified_at?: string | null
          listing_id?: string
          order_id?: string
          released_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_roles: {
        Row: {
          granted_at: string
          granted_by: string | null
          member_id: string
          revoked_at: string | null
          role: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          member_id: string
          revoked_at?: string | null
          role: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          member_id?: string
          revoked_at?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_roles_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_roles_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_order: {
        Args: {
          p_listing_id: string
          p_listing_version: number
          p_offer_id?: string
          p_offer_version?: number
          p_operation_id: string
        }
        Returns: string
      }
      affiliation_command: {
        Args: {
          p_action: string
          p_operation_id: string
          p_request_id: string
          p_value: string
        }
        Returns: string
      }
      browse_listings: {
        Args: {
          p_before?: string
          p_before_id?: string
          p_category?: string
          p_day?: string
          p_id?: string
          p_search?: string
          p_type?: string
        }
        Returns: Json
      }
      browse_offers: {
        Args: { p_before?: string; p_before_id?: string; p_listing_id?: string }
        Returns: Json
      }
      browse_orders: {
        Args: { p_before?: string; p_before_id?: string }
        Returns: Json
      }
      btp08_history: {
        Args: { p_after?: number; p_before?: number; p_order: string }
        Returns: Json
      }
      btp08_read: {
        Args: { p_order: string; p_sequence: number }
        Returns: undefined
      }
      btp08_send: {
        Args: { p_body: string; p_client: string; p_order: string }
        Returns: Json
      }
      btp09_act: {
        Args: { p_action: string; p_assignee?: string; p_case: string; p_reason?: string; p_version: number }
        Returns: undefined
      }
      btp09_cases: {
        Args: { p_before?: string; p_before_id?: string }
        Returns: Json
      }
      btp09_history: {
        Args: { p_before?: number; p_case: string; p_order_history?: boolean }
        Returns: Json
      }
      btp09_open: {
        Args: { p_body: string; p_category: string; p_operation: string; p_order?: string }
        Returns: string
      }
      btp09_read: {
        Args: { p_case: string; p_sequence: number }
        Returns: undefined
      }
      btp09_send: {
        Args: { p_body: string; p_case: string; p_client: string }
        Returns: Json
      }
      notification_inbox: {
        Args: { p_before?: string; p_before_id?: string }
        Returns: Json
      }
      notification_target: { Args: { p_id: string }; Returns: string }
      offer_listing: { Args: { p_id: string }; Returns: Json }
      open_support: {
        Args: { p_body: string; p_operation_id: string }
        Returns: string
      }
      read_notification: { Args: { p_id: string }; Returns: undefined }
      read_order: { Args: { p_id: string }; Returns: Json }
      save_listing: {
        Args: {
          p_listing: Json
          p_listing_id: string
          p_operation_id: string
          p_version: number
        }
        Returns: string
      }
      save_offer: {
        Args: {
          p_action: string
          p_fee: number
          p_listing_id: string
          p_listing_version: number
          p_offer_id: string
          p_operation_id: string
          p_version: number
        }
        Returns: string
      }
      set_notification_preference: {
        Args: { p_email: boolean; p_type: string }
        Returns: undefined
      }
      set_staff_role: {
        Args: {
          p_grant: boolean
          p_member_id: string
          p_operation_id: string
          p_reason: string
          p_role: string
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
