// src/lib/conflict-engine/types.ts
// Pure TypeScript types for the AlterSched Conflict Engine.
// Do not import database or React dependencies here.

export type SessionType = 'lecture' | 'lab';

export type ScheduleEntryInput = {
  id: string;
  offeringId: string;
  blockId: string;
  subjectId: string;
  instructorId: string;
  roomId: string | null;
  dayOfWeek: number; // 0 (Sun) to 6 (Sat)
  startTime: string; // "HH:MM" or "HH:MM:SS"
  endTime: string;   // "HH:MM" or "HH:MM:SS"
  sessionType: SessionType;
  notes?: string | null;
};

export type RoomInfo = {
  id: string;
  name?: string;
  roomType: 'lecture' | 'laboratory';
  capacity: number;
  isShared: boolean;
};

export type SubjectInfo = {
  id: string;
  code?: string;
  title?: string;
  requiresLab: boolean;
  facilityType?: 'lecture' | 'lab' | 'unspecified';
  lectureHours: number;
  labHours: number;
};

export type AvailabilityWindow = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

export type InstructorInfo = {
  id: string;
  name?: string;
  needsLabEquipment: boolean;
  qualifications: string[]; // subjectId[]
  availability: AvailabilityWindow[];
};

export type BlockInfo = {
  id: string;
  name?: string;
  studentCount: number;
};

export type ConstraintSource = 'high_school' | 'non_bsit' | 'other';

export type FixedConstraintInfo = {
  id: string;
  termId?: string;
  roomId: string | null;
  label: string;
  source: ConstraintSource;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

export type ViolationSeverity = 'hard' | 'soft';

export type Violation = {
  severity: ViolationSeverity;
  rule: string;
  message: string;
  entryIds: string[];
};

export type ScheduleContext = {
  rooms: RoomInfo[];
  subjects: SubjectInfo[];
  instructors: InstructorInfo[];
  blocks: BlockInfo[];
  fixedConstraints: FixedConstraintInfo[];
};
