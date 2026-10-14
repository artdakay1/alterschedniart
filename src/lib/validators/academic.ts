import { z } from 'zod';

const postgresUuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const academicTermSchema = z.object({
  school_year: z
    .string()
    .trim()
    .min(1, 'School year is required')
    .regex(/^\d{4}-\d{4}$/, 'Format must be YYYY-YYYY (e.g. 2026-2027)'),
  semester: z
    .string()
    .trim()
    .min(1, 'Semester is required'),
  is_current: z.boolean().default(false),
});

export type AcademicTermInput = z.infer<typeof academicTermSchema>;

export const programSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'Program code must be at least 2 characters')
    .max(20, 'Program code cannot exceed 20 characters'),
  name: z
    .string()
    .trim()
    .min(3, 'Program name must be at least 3 characters')
    .max(100, 'Program name cannot exceed 100 characters'),
});

export type ProgramInput = z.infer<typeof programSchema>;

export const blockSchema = z.object({
  program_id: z.string().regex(postgresUuidRegex, 'Please select a valid program'),
  year_level: z.coerce
    .number()
    .int()
    .min(1, 'Year level must be between 1 and 5')
    .max(5, 'Year level must be between 1 and 5'),
  section: z
    .string()
    .trim()
    .min(1, 'Block / Section is required')
    .max(30, 'Block / Section cannot exceed 30 characters'),
  student_count: z.coerce
    .number()
    .int()
    .min(1, 'Student count must be greater than 0'),
});

export type BlockInput = z.infer<typeof blockSchema>;

export const subjectSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2, 'Subject code must be at least 2 characters')
      .max(20, 'Subject code cannot exceed 20 characters'),
    title: z
      .string()
      .trim()
      .min(2, 'Subject title must be at least 2 characters'),
    units: z.coerce
      .number()
      .positive('Units must be greater than 0'),
    lecture_hours: z.coerce
      .number()
      .min(0, 'Lecture hours cannot be negative')
      .default(0),
    lab_hours: z.coerce
      .number()
      .min(0, 'Lab hours cannot be negative')
      .default(0),
    requires_lab: z.boolean().default(false),
    is_bsit: z.boolean().default(true),
  })
  .refine(
    (data) => data.lecture_hours + data.lab_hours > 0,
    {
      message: 'Total hours (lecture + lab) must be greater than 0',
      path: ['lecture_hours'],
    }
  );

export type SubjectInput = z.infer<typeof subjectSchema>;

export const roomSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Room name is required')
    .max(50, 'Room name cannot exceed 50 characters'),
  room_type: z.enum(['lecture', 'laboratory'], {
    message: 'Room type must be either lecture or laboratory',
  }),
  capacity: z.coerce
    .number()
    .int()
    .positive('Capacity must be greater than 0'),
  is_shared: z.boolean().default(false),
  allowed_departments: z
    .array(z.enum(['BSIT', 'High School']))
    .min(1, 'Select at least one department allowed to use this room.')
    .default(['BSIT']),
});

export type RoomInput = z.infer<typeof roomSchema>;

export const instructorProfileSchema = z.object({
  employment_type: z.enum(['full_time', 'part_time']),
  needs_lab_equipment: z.boolean().default(false),
  department: z.enum(['BSIT', 'High School', 'Both']).default('BSIT'),
});

export type InstructorProfileInput = z.infer<typeof instructorProfileSchema>;

export const instructorAvailabilitySlotSchema = z
  .object({
    day_of_week: z.coerce
      .number()
      .int()
      .min(0, 'Day must be between 0 (Sun) and 6 (Sat)')
      .max(6, 'Day must be between 0 (Sun) and 6 (Sat)'),
    start_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Invalid time format (HH:MM)'),
    end_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Invalid time format (HH:MM)'),
  })
  .refine((data) => data.end_time > data.start_time, {
    message: 'End time must be after start time',
    path: ['end_time'],
  });

export type InstructorAvailabilitySlotInput = z.infer<
  typeof instructorAvailabilitySlotSchema
>;

export const fixedConstraintSchema = z
  .object({
    term_id: z.string().regex(postgresUuidRegex, 'Please select an academic term'),
    room_id: z.string().regex(postgresUuidRegex, 'Please select a room').nullable().optional().or(z.literal('')),
    label: z
      .string()
      .trim()
      .min(2, 'Label must be at least 2 characters')
      .max(100, 'Label cannot exceed 100 characters'),
    source: z.enum(['high_school', 'non_bsit', 'other']),
    day_of_week: z.coerce
      .number()
      .int()
      .min(0, 'Day must be between 0 (Sun) and 6 (Sat)')
      .max(6, 'Day must be between 0 (Sun) and 6 (Sat)'),
    start_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Invalid start time format (HH:MM)'),
    end_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Invalid end time format (HH:MM)'),
  })
  .refine((data) => data.end_time > data.start_time, {
    message: 'End time must be after start time',
    path: ['end_time'],
  });

export type FixedConstraintInput = z.infer<typeof fixedConstraintSchema>;
