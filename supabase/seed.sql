-- AlterSched Phase 0 Seed Data
-- Database Seed Script

-- 1. Seed Auth Users (Direct SQL insertion for Supabase local development)
-- Password for all accounts: 'Password123!'
-- Password bcrypt hash: '$2a$10$Y1S.nKqGff4jCg4cE8Wq8.kL505FvRkK2d20p2sQJqYJp.m77w7sC' (standard bcrypt hash for 'Password123!')

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'admin@altersched.edu',
    crypt('Password123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Dr. Admin Administrator"}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'scheduler@altersched.edu',
    crypt('Password123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Sarah Scheduler"}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'pending.instructor@altersched.edu',
    crypt('Password123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Pending Applicant"}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'john.doe@altersched.edu',
    crypt('Password123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Prof. John Doe"}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'jane.smith@altersched.edu',
    crypt('Password123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Prof. Jane Smith"}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000006',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'robert.alan@altersched.edu',
    crypt('Password123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Engr. Robert Alan"}',
    now(),
    now()
  )
on conflict (id) do nothing;

-- 2. Update Profiles according to role assignments:
-- Admin: role=admin, status=active
update public.profiles
set role = 'admin', status = 'active', full_name = 'Dr. Admin Administrator'
where id = '00000000-0000-0000-0000-000000000001';

-- Scheduler: role=scheduler, status=active
update public.profiles
set role = 'scheduler', status = 'active', full_name = 'Sarah Scheduler'
where id = '00000000-0000-0000-0000-000000000002';

-- Pending Instructor remains: role=instructor, status=pending
update public.profiles
set role = 'instructor', status = 'pending', full_name = 'Pending Applicant'
where id = '00000000-0000-0000-0000-000000000003';

-- Active Instructors:
update public.profiles
set role = 'instructor', status = 'active', full_name = 'Prof. John Doe'
where id = '00000000-0000-0000-0000-000000000004';

update public.profiles
set role = 'instructor', status = 'active', full_name = 'Prof. Jane Smith'
where id = '00000000-0000-0000-0000-000000000005';

update public.profiles
set role = 'instructor', status = 'active', full_name = 'Engr. Robert Alan'
where id = '00000000-0000-0000-0000-000000000006';

-- 3. Academic Term (1 Current Term)
insert into public.academic_terms (id, school_year, semester, is_current)
values ('10000000-0000-0000-0000-000000000001', '2026-2027', '1st Semester', true)
on conflict (school_year, semester) do update set is_current = excluded.is_current;

-- 4. Program (BSIT)
insert into public.programs (id, code, name)
values ('20000000-0000-0000-0000-000000000001', 'BSIT', 'Bachelor of Science in Information Technology')
on conflict (code) do update set name = excluded.name;

-- 5. Blocks (4 Blocks: 1-A, 1-B, 2-A, 2-B)
insert into public.blocks (id, program_id, year_level, section, student_count)
values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 1, 'A', 40),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 1, 'B', 38),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 2, 'A', 35),
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', 2, 'B', 36)
on conflict (program_id, year_level, section) do nothing;

-- 6. Subjects (8 subjects: mix of lecture-only and lecture+lab)
insert into public.subjects (id, code, title, units, lecture_hours, lab_hours, requires_lab, is_bsit)
values
  ('40000000-0000-0000-0000-000000000001', 'IT111', 'Introduction to Computing', 3.0, 2.0, 3.0, true, true),
  ('40000000-0000-0000-0000-000000000002', 'IT112', 'Computer Programming 1', 3.0, 2.0, 3.0, true, true),
  ('40000000-0000-0000-0000-000000000003', 'GE101', 'Understanding the Self', 3.0, 3.0, 0.0, false, true),
  ('40000000-0000-0000-0000-000000000004', 'GE102', 'Purposive Communication', 3.0, 3.0, 0.0, false, true),
  ('40000000-0000-0000-0000-000000000005', 'IT211', 'Data Structures and Algorithms', 3.0, 2.0, 3.0, true, true),
  ('40000000-0000-0000-0000-000000000006', 'IT212', 'Object-Oriented Programming', 3.0, 2.0, 3.0, true, true),
  ('40000000-0000-0000-0000-000000000007', 'IT213', 'Web Systems and Technologies', 3.0, 2.0, 3.0, true, true),
  ('40000000-0000-0000-0000-000000000008', 'GE201', 'Ethics in Information Technology', 3.0, 3.0, 0.0, false, true)
on conflict (code) do nothing;

-- 7. Rooms (4 rooms: 2 lecture, 2 laboratory, one shared)
insert into public.rooms (id, name, room_type, capacity, is_shared)
values
  ('50000000-0000-0000-0000-000000000001', 'Room 301', 'lecture', 45, false),
  ('50000000-0000-0000-0000-000000000002', 'Room 302 (Shared)', 'lecture', 45, true),
  ('50000000-0000-0000-0000-000000000003', 'Computer Lab 1', 'laboratory', 40, false),
  ('50000000-0000-0000-0000-000000000004', 'Computer Lab 2', 'laboratory', 40, false)
on conflict (name) do nothing;

-- 8. Instructors (4 instructors linked to profiles or standalone)
insert into public.instructors (id, profile_id, full_name, employment_type, needs_lab_equipment)
values
  ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', 'Prof. John Doe', 'full_time', true),
  ('60000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000005', 'Prof. Jane Smith', 'full_time', true),
  ('60000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000006', 'Engr. Robert Alan', 'part_time', false),
  ('60000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', 'Pending Applicant', 'full_time', false)
on conflict (id) do nothing;

-- 9. Instructor Qualifications
insert into public.instructor_qualifications (instructor_id, subject_id)
values
  -- Prof. John Doe (IT111, IT112, IT211)
  ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002'),
  ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000005'),
  -- Prof. Jane Smith (IT112, IT212, IT213)
  ('60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002'),
  ('60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000006'),
  ('60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000007'),
  -- Engr. Robert Alan (GE101, GE102, GE201)
  ('60000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003'),
  ('60000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000004'),
  ('60000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000008'),
  -- Pending Applicant (IT111)
  ('60000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000001')
on conflict (instructor_id, subject_id) do nothing;

-- 10. Instructor Availability (Day 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday)
insert into public.instructor_availability (instructor_id, day_of_week, start_time, end_time)
values
  -- Prof. John Doe (Mon-Fri 08:00 to 17:00)
  ('60000000-0000-0000-0000-000000000001', 1, '08:00:00', '17:00:00'),
  ('60000000-0000-0000-0000-000000000001', 2, '08:00:00', '17:00:00'),
  ('60000000-0000-0000-0000-000000000001', 3, '08:00:00', '17:00:00'),
  ('60000000-0000-0000-0000-000000000001', 4, '08:00:00', '17:00:00'),
  ('60000000-0000-0000-0000-000000000001', 5, '08:00:00', '17:00:00'),

  -- Prof. Jane Smith (Mon-Fri 09:00 to 18:00)
  ('60000000-0000-0000-0000-000000000002', 1, '09:00:00', '18:00:00'),
  ('60000000-0000-0000-0000-000000000002', 2, '09:00:00', '18:00:00'),
  ('60000000-0000-0000-0000-000000000002', 3, '09:00:00', '18:00:00'),
  ('60000000-0000-0000-0000-000000000002', 4, '09:00:00', '18:00:00'),
  ('60000000-0000-0000-0000-000000000002', 5, '09:00:00', '18:00:00'),

  -- Engr. Robert Alan (Mon, Wed, Fri 08:00 to 12:00)
  ('60000000-0000-0000-0000-000000000003', 1, '08:00:00', '12:00:00'),
  ('60000000-0000-0000-0000-000000000003', 3, '08:00:00', '12:00:00'),
  ('60000000-0000-0000-0000-000000000003', 5, '08:00:00', '12:00:00'),

  -- Pending Applicant (Tue, Thu 10:00 to 16:00)
  ('60000000-0000-0000-0000-000000000004', 2, '10:00:00', '16:00:00'),
  ('60000000-0000-0000-0000-000000000004', 4, '10:00:00', '16:00:00');

-- 11. Sample Fixed Constraints (2 constraints)
insert into public.fixed_constraints (term_id, room_id, label, source, day_of_week, start_time, end_time)
values
  -- High School Department exclusive use of Room 302 (Shared)
  (
    '10000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000002',
    'High School Dept Assembly / First Period',
    'high_school',
    1, -- Monday
    '07:30:00',
    '09:30:00'
  ),
  -- Non-BSIT College examination session in Room 301
  (
    '10000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    'College of Education Midterm Exam Block',
    'non_bsit',
    3, -- Wednesday
    '13:00:00',
    '15:00:00'
  );
