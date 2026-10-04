// src/lib/validators/schedule.ts
// Zod schema for manual schedule entry management.

import { z } from 'zod';

// Matches standard PostgreSQL 32-hex formatted UUIDs including custom seeded IDs
const postgresUuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const scheduleEntrySchema = z
  .object({
    offering_id: z.string().regex(postgresUuidRegex, 'Please select a valid class offering'),
    instructor_id: z.string().regex(postgresUuidRegex, 'Please select an instructor'),
    room_id: z
      .union([
        z.string().regex(postgresUuidRegex, 'Please select a valid room'),
        z.literal(''),
        z.null(),
        z.undefined(),
      ])
      .transform((val) => (val && val.trim().length > 0 ? val : null)),
    day_of_week: z.coerce
      .number()
      .int()
      .min(0, 'Day must be between 0 (Sun) and 6 (Sat)')
      .max(6, 'Day must be between 0 (Sun) and 6 (Sat)'),
    days_of_week: z.array(z.coerce.number().int().min(0).max(6)).optional(),
    start_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Invalid start time format (HH:MM)'),
    end_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Invalid end time format (HH:MM)'),
    session_type: z.enum(['lecture', 'lab'], {
      message: 'Session type must be lecture or lab',
    }),
    notes: z.string().optional().nullable(),
  })
  .refine((data) => data.end_time > data.start_time, {
    message: 'End time must be after start time',
    path: ['end_time'],
  });

export type ScheduleEntryFormInput = z.infer<typeof scheduleEntrySchema>;
