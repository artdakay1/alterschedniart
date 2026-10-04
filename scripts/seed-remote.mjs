// scripts/seed-remote.mjs
// Comprehensive seed script for hosted Supabase Cloud project.
// Uses SUPABASE_SERVICE_ROLE_KEY to bypass RLS and create auth users via Admin API.
// Run with: npm run seed

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Parse .env.local if present
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [key, ...vals] = trimmed.split('=');
      process.env[key.trim()] = vals.join('=').trim();
    }
  }
}

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseUrl = rawUrl ? rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '') : '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey || supabaseUrl.includes('dummy')) {
  console.error('❌ Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to your hosted Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const SEED_USERS = [
  {
    email: 'admin@altersched.edu',
    password: 'Password123!',
    fullName: 'Dr. Admin Administrator',
    role: 'admin',
    status: 'active',
  },
  {
    email: 'scheduler@altersched.edu',
    password: 'Password123!',
    fullName: 'Sarah Scheduler',
    role: 'scheduler',
    status: 'active',
  },
  {
    email: 'john.doe@altersched.edu',
    password: 'Password123!',
    fullName: 'Prof. John Doe',
    role: 'instructor',
    status: 'active',
  },
  {
    email: 'jane.smith@altersched.edu',
    password: 'Password123!',
    fullName: 'Prof. Jane Smith',
    role: 'instructor',
    status: 'active',
  },
  {
    email: 'robert.alan@altersched.edu',
    password: 'Password123!',
    fullName: 'Engr. Robert Alan',
    role: 'instructor',
    status: 'active',
  },
  {
    email: 'pending.instructor@altersched.edu',
    password: 'Password123!',
    fullName: 'Pending Applicant',
    role: 'instructor',
    status: 'pending',
  },
];

async function seed() {
  console.log('🚀 Starting AlterSched Seed on Supabase Project:', supabaseUrl);

  const userIds = {};

  // 1. Seed Auth Users
  console.log('\n--- 1. Seeding Auth Users & Profiles ---');
  for (const user of SEED_USERS) {
    let userId = null;

    const { data: createData, error: createError } = await supabase.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: { full_name: user.fullName },
    });

    if (createError) {
      if (createError.message.includes('already registered') || createError.message.includes('already exists')) {
        const { data: listData } = await supabase.auth.admin.listUsers();
        const existing = listData?.users?.find((u) => u.email === user.email);
        userId = existing?.id;
        console.log(`ℹ️ User ${user.email} already exists (ID: ${userId})`);
      } else {
        console.error(`❌ Failed to create ${user.email}: ${createError.message}`);
        continue;
      }
    } else {
      userId = createData?.user?.id;
      console.log(`✅ Created auth user: ${user.email} (ID: ${userId})`);
    }

    if (userId) {
      userIds[user.email] = userId;

      // Update matching profile role and status
      const { error: profileError } = await supabase.from('profiles').upsert({
        id: userId,
        full_name: user.fullName,
        email: user.email,
        role: user.role,
        status: user.status,
      });

      if (profileError) {
        console.error(`❌ Failed to update profile for ${user.email}:`, profileError.message);
      } else {
        console.log(`   Updated profile: [${user.role} | ${user.status}]`);
      }
    }
  }

  // 2. Academic Term
  console.log('\n--- 2. Seeding Academic Term ---');
  const termId = '10000000-0000-0000-0000-000000000001';
  const { error: termError } = await supabase.from('academic_terms').upsert({
    id: termId,
    school_year: '2026-2027',
    semester: '1st Semester',
    is_current: true,
  });
  if (termError) console.error('❌ Term error:', termError.message);
  else console.log('✅ Current academic term created: 2026-2027 1st Semester');

  // 3. Program
  console.log('\n--- 3. Seeding Program ---');
  const programId = '20000000-0000-0000-0000-000000000001';
  const { error: progError } = await supabase.from('programs').upsert({
    id: programId,
    code: 'BSIT',
    name: 'Bachelor of Science in Information Technology',
  });
  if (progError) console.error('❌ Program error:', progError.message);
  else console.log('✅ Program created: BSIT');

  // 4. Blocks
  console.log('\n--- 4. Seeding Blocks ---');
  const blocks = [
    { id: '30000000-0000-0000-0000-000000000001', program_id: programId, year_level: 1, section: 'A', student_count: 40 },
    { id: '30000000-0000-0000-0000-000000000002', program_id: programId, year_level: 1, section: 'B', student_count: 38 },
    { id: '30000000-0000-0000-0000-000000000003', program_id: programId, year_level: 2, section: 'A', student_count: 35 },
    { id: '30000000-0000-0000-0000-000000000004', program_id: programId, year_level: 2, section: 'B', student_count: 36 },
  ];
  for (const b of blocks) {
    const { error: bErr } = await supabase.from('blocks').upsert(b);
    if (bErr) console.error(`❌ Block ${b.year_level}-${b.section} error:`, bErr.message);
  }
  console.log('✅ Blocks created: 1-A, 1-B, 2-A, 2-B');

  // 5. Subjects
  console.log('\n--- 5. Seeding Subjects ---');
  const subjects = [
    { id: '40000000-0000-0000-0000-000000000001', code: 'IT111', title: 'Introduction to Computing', units: 3, lecture_hours: 2, lab_hours: 3, requires_lab: true, is_bsit: true },
    { id: '40000000-0000-0000-0000-000000000002', code: 'IT112', title: 'Computer Programming 1', units: 3, lecture_hours: 2, lab_hours: 3, requires_lab: true, is_bsit: true },
    { id: '40000000-0000-0000-0000-000000000003', code: 'GE101', title: 'Understanding the Self', units: 3, lecture_hours: 3, lab_hours: 0, requires_lab: false, is_bsit: true },
    { id: '40000000-0000-0000-0000-000000000004', code: 'GE102', title: 'Purposive Communication', units: 3, lecture_hours: 3, lab_hours: 0, requires_lab: false, is_bsit: true },
    { id: '40000000-0000-0000-0000-000000000005', code: 'IT211', title: 'Data Structures and Algorithms', units: 3, lecture_hours: 2, lab_hours: 3, requires_lab: true, is_bsit: true },
    { id: '40000000-0000-0000-0000-000000000006', code: 'IT212', title: 'Object-Oriented Programming', units: 3, lecture_hours: 2, lab_hours: 3, requires_lab: true, is_bsit: true },
    { id: '40000000-0000-0000-0000-000000000007', code: 'IT213', title: 'Web Systems and Technologies', units: 3, lecture_hours: 2, lab_hours: 3, requires_lab: true, is_bsit: true },
    { id: '40000000-0000-0000-0000-000000000008', code: 'GE201', title: 'Ethics in Information Technology', units: 3, lecture_hours: 3, lab_hours: 0, requires_lab: false, is_bsit: true },
  ];
  for (const s of subjects) {
    const { error: sErr } = await supabase.from('subjects').upsert(s);
    if (sErr) console.error(`❌ Subject ${s.code} error:`, sErr.message);
  }
  console.log('✅ 8 Subjects created (lecture & lab mix)');

  // 6. Rooms
  console.log('\n--- 6. Seeding Rooms ---');
  const rooms = [
    { id: '50000000-0000-0000-0000-000000000001', name: 'Room 301', room_type: 'lecture', capacity: 45, is_shared: false },
    { id: '50000000-0000-0000-0000-000000000002', name: 'Room 302 (Shared)', room_type: 'lecture', capacity: 45, is_shared: true },
    { id: '50000000-0000-0000-0000-000000000003', name: 'Computer Lab 1', room_type: 'laboratory', capacity: 40, is_shared: false },
    { id: '50000000-0000-0000-0000-000000000004', name: 'Computer Lab 2', room_type: 'laboratory', capacity: 40, is_shared: false },
  ];
  for (const r of rooms) {
    const { error: rErr } = await supabase.from('rooms').upsert(r);
    if (rErr) console.error(`❌ Room ${r.name} error:`, rErr.message);
  }
  console.log('✅ 4 Rooms created (2 lecture, 2 lab)');

  // 7. Instructors
  console.log('\n--- 7. Seeding Instructors ---');
  const instructors = [
    {
      id: '60000000-0000-0000-0000-000000000001',
      profile_id: userIds['john.doe@altersched.edu'] || null,
      full_name: 'Prof. John Doe',
      employment_type: 'full_time',
      needs_lab_equipment: true,
    },
    {
      id: '60000000-0000-0000-0000-000000000002',
      profile_id: userIds['jane.smith@altersched.edu'] || null,
      full_name: 'Prof. Jane Smith',
      employment_type: 'full_time',
      needs_lab_equipment: true,
    },
    {
      id: '60000000-0000-0000-0000-000000000003',
      profile_id: userIds['robert.alan@altersched.edu'] || null,
      full_name: 'Engr. Robert Alan',
      employment_type: 'part_time',
      needs_lab_equipment: false,
    },
    {
      id: '60000000-0000-0000-0000-000000000004',
      profile_id: userIds['pending.instructor@altersched.edu'] || null,
      full_name: 'Pending Applicant',
      employment_type: 'full_time',
      needs_lab_equipment: false,
    },
  ];
  for (const inst of instructors) {
    const { error: instErr } = await supabase.from('instructors').upsert(inst);
    if (instErr) console.error(`❌ Instructor ${inst.full_name} error:`, instErr.message);
  }
  console.log('✅ 4 Instructors linked and created');

  // 8. Qualifications
  console.log('\n--- 8. Seeding Qualifications ---');
  const qualifications = [
    { instructor_id: '60000000-0000-0000-0000-000000000001', subject_id: '40000000-0000-0000-0000-000000000001' },
    { instructor_id: '60000000-0000-0000-0000-000000000001', subject_id: '40000000-0000-0000-0000-000000000002' },
    { instructor_id: '60000000-0000-0000-0000-000000000001', subject_id: '40000000-0000-0000-0000-000000000005' },
    { instructor_id: '60000000-0000-0000-0000-000000000002', subject_id: '40000000-0000-0000-0000-000000000002' },
    { instructor_id: '60000000-0000-0000-0000-000000000002', subject_id: '40000000-0000-0000-0000-000000000006' },
    { instructor_id: '60000000-0000-0000-0000-000000000002', subject_id: '40000000-0000-0000-0000-000000000007' },
    { instructor_id: '60000000-0000-0000-0000-000000000003', subject_id: '40000000-0000-0000-0000-000000000003' },
    { instructor_id: '60000000-0000-0000-0000-000000000003', subject_id: '40000000-0000-0000-0000-000000000004' },
    { instructor_id: '60000000-0000-0000-0000-000000000003', subject_id: '40000000-0000-0000-0000-000000000008' },
    { instructor_id: '60000000-0000-0000-0000-000000000004', subject_id: '40000000-0000-0000-0000-000000000001' },
  ];
  for (const q of qualifications) {
    const { error: qErr } = await supabase.from('instructor_qualifications').upsert(q, { onConflict: 'instructor_id,subject_id' });
    if (qErr) console.error('❌ Qualification error:', qErr.message);
  }
  console.log('✅ Instructor qualifications created');

  // 9. Availability
  console.log('\n--- 9. Seeding Availability ---');
  const availabilities = [
    { instructor_id: '60000000-0000-0000-0000-000000000001', day_of_week: 1, start_time: '08:00:00', end_time: '17:00:00' },
    { instructor_id: '60000000-0000-0000-0000-000000000001', day_of_week: 2, start_time: '08:00:00', end_time: '17:00:00' },
    { instructor_id: '60000000-0000-0000-0000-000000000001', day_of_week: 3, start_time: '08:00:00', end_time: '17:00:00' },
    { instructor_id: '60000000-0000-0000-0000-000000000001', day_of_week: 4, start_time: '08:00:00', end_time: '17:00:00' },
    { instructor_id: '60000000-0000-0000-0000-000000000001', day_of_week: 5, start_time: '08:00:00', end_time: '17:00:00' },
    { instructor_id: '60000000-0000-0000-0000-000000000002', day_of_week: 1, start_time: '09:00:00', end_time: '18:00:00' },
    { instructor_id: '60000000-0000-0000-0000-000000000002', day_of_week: 2, start_time: '09:00:00', end_time: '18:00:00' },
    { instructor_id: '60000000-0000-0000-0000-000000000002', day_of_week: 3, start_time: '09:00:00', end_time: '18:00:00' },
    { instructor_id: '60000000-0000-0000-0000-000000000002', day_of_week: 4, start_time: '09:00:00', end_time: '18:00:00' },
    { instructor_id: '60000000-0000-0000-0000-000000000002', day_of_week: 5, start_time: '09:00:00', end_time: '18:00:00' },
    { instructor_id: '60000000-0000-0000-0000-000000000003', day_of_week: 1, start_time: '08:00:00', end_time: '12:00:00' },
    { instructor_id: '60000000-0000-0000-0000-000000000003', day_of_week: 3, start_time: '08:00:00', end_time: '12:00:00' },
    { instructor_id: '60000000-0000-0000-0000-000000000003', day_of_week: 5, start_time: '08:00:00', end_time: '12:00:00' },
    { instructor_id: '60000000-0000-0000-0000-000000000004', day_of_week: 2, start_time: '10:00:00', end_time: '16:00:00' },
    { instructor_id: '60000000-0000-0000-0000-000000000004', day_of_week: 4, start_time: '10:00:00', end_time: '16:00:00' },
  ];
  for (const a of availabilities) {
    const { error: aErr } = await supabase.from('instructor_availability').insert(a);
    if (aErr && !aErr.message.includes('duplicate')) {
      console.error('❌ Availability error:', aErr.message);
    }
  }
  console.log('✅ Instructor availability slots created');

  // 10. Fixed Constraints
  console.log('\n--- 10. Seeding Fixed Constraints ---');
  const constraints = [
    {
      term_id: termId,
      room_id: '50000000-0000-0000-0000-000000000002',
      label: 'High School Dept Assembly / First Period',
      source: 'high_school',
      day_of_week: 1,
      start_time: '07:30:00',
      end_time: '09:30:00',
    },
    {
      term_id: termId,
      room_id: '50000000-0000-0000-0000-000000000001',
      label: 'College of Education Midterm Exam Block',
      source: 'non_bsit',
      day_of_week: 3,
      start_time: '13:00:00',
      end_time: '15:00:00',
    },
  ];
  for (const c of constraints) {
    const { error: cErr } = await supabase.from('fixed_constraints').insert(c);
    if (cErr && !cErr.message.includes('duplicate')) {
      console.error('❌ Fixed constraint error:', cErr.message);
    }
  }
  console.log('✅ 2 Fixed constraints created');

  console.log('\n🎉 ALL SEED DATA SUCCESSFULLY APPLIED TO SUPABASE CLOUD!');
}

seed().catch((err) => {
  console.error('Fatal error during seed execution:', err);
  process.exit(1);
});
