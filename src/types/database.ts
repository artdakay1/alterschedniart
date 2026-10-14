// src/types/database.ts
// Hand-crafted strict Supabase Database definitions for AlterSched Phase 0

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type DepartmentType = 'BSIT' | 'High School';
export type InstructorDepartmentType = 'BSIT' | 'High School' | 'Both';
export type UserRole = 'admin' | 'scheduler' | 'instructor';
export type UserStatus = 'pending' | 'active' | 'rejected' | 'disabled';
export type RoomType = 'lecture' | 'laboratory';
export type EmploymentType = 'full_time' | 'part_time';
export type ScheduleVersionStatus = 'draft' | 'published' | 'archived';
export type SessionType = 'lecture' | 'lab';
export type ConstraintSource = 'high_school' | 'non_bsit' | 'other';
export type AlterationStatus = 'pending' | 'approved' | 'rejected';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          email: string;
          role: UserRole;
          status: UserStatus;
          department?: DepartmentType | null;
          allowed_subjects?: string[] | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string;
          email: string;
          role?: UserRole;
          status?: UserStatus;
          department?: DepartmentType | null;
          allowed_subjects?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          email?: string;
          role?: UserRole;
          status?: UserStatus;
          department?: DepartmentType | null;
          allowed_subjects?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      academic_terms: {
        Row: {
          id: string;
          school_year: string;
          semester: string;
          is_current: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          school_year: string;
          semester: string;
          is_current?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          school_year?: string;
          semester?: string;
          is_current?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      programs: {
        Row: {
          id: string;
          code: string;
          name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          name: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          code?: string;
          name?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      blocks: {
        Row: {
          id: string;
          program_id: string;
          year_level: number;
          section: string;
          student_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          program_id: string;
          year_level: number;
          section: string;
          student_count: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          program_id?: string;
          year_level?: number;
          section?: string;
          student_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'blocks_program_id_fkey';
            columns: ['program_id'];
            referencedRelation: 'programs';
            referencedColumns: ['id'];
          }
        ];
      };
      subjects: {
        Row: {
          id: string;
          code: string;
          title: string;
          units: number;
          lecture_hours: number;
          lab_hours: number;
          requires_lab: boolean;
          is_bsit: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          title: string;
          units: number;
          lecture_hours?: number;
          lab_hours?: number;
          requires_lab?: boolean;
          is_bsit?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          code?: string;
          title?: string;
          units?: number;
          lecture_hours?: number;
          lab_hours?: number;
          requires_lab?: boolean;
          is_bsit?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      rooms: {
        Row: {
          id: string;
          name: string;
          room_type: RoomType;
          capacity: number;
          is_shared: boolean;
          allowed_departments?: DepartmentType[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          room_type: RoomType;
          capacity: number;
          is_shared?: boolean;
          allowed_departments?: DepartmentType[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          room_type?: RoomType;
          capacity?: number;
          is_shared?: boolean;
          allowed_departments?: DepartmentType[];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      instructors: {
        Row: {
          id: string;
          profile_id: string | null;
          full_name: string;
          employment_type: EmploymentType;
          needs_lab_equipment: boolean;
          department?: InstructorDepartmentType | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          profile_id?: string | null;
          full_name: string;
          employment_type: EmploymentType;
          needs_lab_equipment?: boolean;
          department?: InstructorDepartmentType | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          profile_id?: string | null;
          full_name?: string;
          employment_type?: EmploymentType;
          needs_lab_equipment?: boolean;
          department?: InstructorDepartmentType | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'instructors_profile_id_fkey';
            columns: ['profile_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      instructor_qualifications: {
        Row: {
          id: string;
          instructor_id: string;
          subject_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          instructor_id: string;
          subject_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          instructor_id?: string;
          subject_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'instructor_qualifications_instructor_id_fkey';
            columns: ['instructor_id'];
            referencedRelation: 'instructors';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'instructor_qualifications_subject_id_fkey';
            columns: ['subject_id'];
            referencedRelation: 'subjects';
            referencedColumns: ['id'];
          }
        ];
      };
      instructor_availability: {
        Row: {
          id: string;
          instructor_id: string;
          day_of_week: number;
          start_time: string;
          end_time: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          instructor_id: string;
          day_of_week: number;
          start_time: string;
          end_time: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          instructor_id?: string;
          day_of_week?: number;
          start_time?: string;
          end_time?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'instructor_availability_instructor_id_fkey';
            columns: ['instructor_id'];
            referencedRelation: 'instructors';
            referencedColumns: ['id'];
          }
        ];
      };
      class_offerings: {
        Row: {
          id: string;
          term_id: string;
          block_id: string;
          subject_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          term_id: string;
          block_id: string;
          subject_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          term_id?: string;
          block_id?: string;
          subject_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'class_offerings_term_id_fkey';
            columns: ['term_id'];
            referencedRelation: 'academic_terms';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'class_offerings_block_id_fkey';
            columns: ['block_id'];
            referencedRelation: 'blocks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'class_offerings_subject_id_fkey';
            columns: ['subject_id'];
            referencedRelation: 'subjects';
            referencedColumns: ['id'];
          }
        ];
      };
      schedule_versions: {
        Row: {
          id: string;
          term_id: string;
          version_number: number;
          status: ScheduleVersionStatus;
          created_by: string | null;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          term_id: string;
          version_number: number;
          status?: ScheduleVersionStatus;
          created_by?: string | null;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          term_id?: string;
          version_number?: number;
          status?: ScheduleVersionStatus;
          created_by?: string | null;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'schedule_versions_term_id_fkey';
            columns: ['term_id'];
            referencedRelation: 'academic_terms';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'schedule_versions_created_by_fkey';
            columns: ['created_by'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      schedule_entries: {
        Row: {
          id: string;
          version_id: string;
          offering_id: string;
          instructor_id: string;
          room_id: string | null;
          day_of_week: number;
          start_time: string;
          end_time: string;
          session_type: SessionType;
          created_by_ai?: boolean | null;
          notes?: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          version_id: string;
          offering_id: string;
          instructor_id: string;
          room_id?: string | null;
          day_of_week: number;
          start_time: string;
          end_time: string;
          session_type: SessionType;
          created_by_ai?: boolean | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          version_id?: string;
          offering_id?: string;
          instructor_id?: string;
          room_id?: string | null;
          day_of_week?: number;
          start_time?: string;
          end_time?: string;
          session_type?: SessionType;
          created_by_ai?: boolean | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'schedule_entries_version_id_fkey';
            columns: ['version_id'];
            referencedRelation: 'schedule_versions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'schedule_entries_offering_id_fkey';
            columns: ['offering_id'];
            referencedRelation: 'class_offerings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'schedule_entries_instructor_id_fkey';
            columns: ['instructor_id'];
            referencedRelation: 'instructors';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'schedule_entries_room_id_fkey';
            columns: ['room_id'];
            referencedRelation: 'rooms';
            referencedColumns: ['id'];
          }
        ];
      };
      fixed_constraints: {
        Row: {
          id: string;
          term_id: string;
          room_id: string | null;
          label: string;
          source: ConstraintSource;
          day_of_week: number;
          start_time: string;
          end_time: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          term_id: string;
          room_id?: string | null;
          label: string;
          source: ConstraintSource;
          day_of_week: number;
          start_time: string;
          end_time: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          term_id?: string;
          room_id?: string | null;
          label?: string;
          source?: ConstraintSource;
          day_of_week?: number;
          start_time?: string;
          end_time?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'fixed_constraints_term_id_fkey';
            columns: ['term_id'];
            referencedRelation: 'academic_terms';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'fixed_constraints_room_id_fkey';
            columns: ['room_id'];
            referencedRelation: 'rooms';
            referencedColumns: ['id'];
          }
        ];
      };
      alteration_requests: {
        Row: {
          id: string;
          entry_id: string;
          requested_by: string;
          proposed_changes: Json;
          reason: string;
          status: AlterationStatus;
          reviewed_by: string | null;
          reviewed_at: string | null;
          rejection_reason?: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          entry_id: string;
          requested_by: string;
          proposed_changes?: Json;
          reason: string;
          status?: AlterationStatus;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          rejection_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          entry_id?: string;
          requested_by?: string;
          proposed_changes?: Json;
          reason?: string;
          status?: AlterationStatus;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          rejection_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'alteration_requests_entry_id_fkey';
            columns: ['entry_id'];
            referencedRelation: 'schedule_entries';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'alteration_requests_requested_by_fkey';
            columns: ['requested_by'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'alteration_requests_reviewed_by_fkey';
            columns: ['reviewed_by'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      audit_log: {
        Row: {
          id: string;
          actor_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string | null;
          before: Json | null;
          after: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_id?: string | null;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          before?: Json | null;
          after?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          actor_id?: string | null;
          action?: string;
          entity_type?: string;
          entity_id?: string | null;
          before?: Json | null;
          after?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_log_actor_id_fkey';
            columns: ['actor_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          body: string;
          is_read: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          body: string;
          is_read?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          body?: string;
          is_read?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_user_id_fkey';
            columns: ['user_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      qr_tokens: {
        Row: {
          id: string;
          block_id: string;
          version_id: string;
          token: string;
          revoked_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          block_id: string;
          version_id: string;
          token: string;
          revoked_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          block_id?: string;
          version_id?: string;
          token?: string;
          revoked_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'qr_tokens_block_id_fkey';
            columns: ['block_id'];
            referencedRelation: 'blocks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'qr_tokens_version_id_fkey';
            columns: ['version_id'];
            referencedRelation: 'schedule_versions';
            referencedColumns: ['id'];
          }
        ];
      };
      scheduler_allowed_subjects: {
        Row: {
          id: string;
          profile_id: string;
          subject_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          subject_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          profile_id?: string;
          subject_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'scheduler_allowed_subjects_profile_id_fkey';
            columns: ['profile_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'scheduler_allowed_subjects_subject_id_fkey';
            columns: ['subject_id'];
            referencedRelation: 'subjects';
            referencedColumns: ['id'];
          }
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      is_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
    };
    Enums: {
      user_role: UserRole;
      user_status: UserStatus;
      room_type: RoomType;
      employment_type: EmploymentType;
      schedule_version_status: ScheduleVersionStatus;
      session_type: SessionType;
      constraint_source: ConstraintSource;
      alteration_status: AlterationStatus;
    };
  };
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type InsertTables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type UpdateTables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];

export type Profile = Tables<'profiles'> & {
  department?: DepartmentType | null;
  allowed_subjects?: string[] | null;
  allowed_subject_ids?: string[] | null;
};
export type AcademicTerm = Tables<'academic_terms'>;
export type Program = Tables<'programs'>;
export type Block = Tables<'blocks'>;
export type Subject = Tables<'subjects'>;
export type Room = Tables<'rooms'> & {
  allowed_departments?: DepartmentType[];
};
export type Instructor = Tables<'instructors'>;
export type InstructorQualification = Tables<'instructor_qualifications'>;
export type InstructorAvailability = Tables<'instructor_availability'>;
export type ClassOffering = Tables<'class_offerings'>;
export type ScheduleVersion = Tables<'schedule_versions'>;
export type ScheduleEntry = Tables<'schedule_entries'> & {
  created_by_ai?: boolean | null;
};
export type FixedConstraint = Tables<'fixed_constraints'>;
export type AlterationRequest = Tables<'alteration_requests'> & {
  rejection_reason?: string | null;
};
export type AuditLog = Tables<'audit_log'>;
export type Notification = Tables<'notifications'>;
export type QrToken = Tables<'qr_tokens'>;

export type AiGenerationLog = {
  id: string;
  term_id: string;
  block_id: string;
  input_payload: unknown;
  raw_output: unknown;
  attempt_count: number;
  entries_written: unknown;
  final_unassigned: unknown;
  created_by: string | null;
  created_at: string;
};

