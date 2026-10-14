-- Migration: 20261008000018_full_time_instructor_default_availability.sql
-- Description: Sets default availability for full-time instructors to 08:00 to 20:30 with 12:30 to 13:00 lunch break blocked.

DO $$
DECLARE
  inst RECORD;
  d INT;
BEGIN
  FOR inst IN SELECT id FROM public.instructors WHERE employment_type = 'full_time' LOOP
    -- Remove existing availability slots
    DELETE FROM public.instructor_availability WHERE instructor_id = inst.id;

    -- Insert standard Monday (1) to Saturday (6) availability
    FOR d IN 1..6 LOOP
      -- Morning window: 08:00:00 to 12:30:00
      INSERT INTO public.instructor_availability (instructor_id, day_of_week, start_time, end_time)
      VALUES (inst.id, d, '08:00:00', '12:30:00');

      -- Afternoon/Evening window: 13:00:00 to 20:30:00 (12:30 to 13:00 is lunch break)
      INSERT INTO public.instructor_availability (instructor_id, day_of_week, start_time, end_time)
      VALUES (inst.id, d, '13:00:00', '20:30:00');
    END LOOP;
  END LOOP;
END $$;
