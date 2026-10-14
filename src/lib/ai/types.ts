// src/lib/ai/types.ts
// Type definitions and Zod schemas for AlterSched AI Drafting Pipeline.

import { z } from 'zod';
import type {
  SubjectInfo,
  BlockInfo,
  FixedConstraintInfo,
  ScheduleEntryInput,
  Violation,
} from '@/lib/conflict-engine';

export const proposedEntrySchema = z.object({
  offeringId: z.string().min(1, 'Offering ID is required'),
  instructorId: z.string().min(1, 'Instructor ID is required'),
  roomId: z.string().nullable().optional(),
  dayOfWeek: z.coerce
    .number()
    .int()
    .min(0, 'Day must be between 0 and 6')
    .max(6, 'Day must be between 0 and 6'),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Format must be HH:MM'),
  endTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Format must be HH:MM'),
  sessionType: z.enum(['lecture', 'lab']),
});

export const proposedDraftSchema = z.array(proposedEntrySchema);

export type ProposedEntry = z.infer<typeof proposedEntrySchema>;

export type SchedulerPreferences = {
  noClassesAfter5pm?: boolean;
  preferMornings?: boolean;
  allowSaturday?: boolean;
  splitTwoDays?: boolean;
  customNotes?: string;
  isRefineMode?: boolean;
  refineScope?: 'targeted' | 'whole_block';
};

export type BlockDraftPayload = {
  termId: string;
  block: BlockInfo;
  offerings: Array<{
    id: string;
    subject: SubjectInfo;
    qualifiedInstructors: Array<{
      id: string;
      name: string;
      availability: Array<{ dayOfWeek: number; startTime: string; endTime: string }>;
    }>;
    eligibleRooms: Array<{
      id: string;
      name: string;
      roomType: 'lecture' | 'laboratory';
      capacity: number;
    }>;
  }>;
  fixedConstraints: FixedConstraintInfo[];
  existingEntries: ScheduleEntryInput[];
  preferences: SchedulerPreferences;
};

export type BlockDraftResult = {
  blockId: string;
  blockName: string;
  success: boolean;
  attemptCount: number;
  entriesWritten: ScheduleEntryInput[];
  unassigned: Array<{
    offeringId: string;
    subjectCode: string;
    remainingHours: number;
    reason: string;
  }>;
  softViolations: Violation[];
  rawOutput: unknown;
  error?: string;
};
