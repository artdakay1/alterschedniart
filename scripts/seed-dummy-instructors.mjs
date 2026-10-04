// scripts/seed-dummy-instructors.mjs
// Script to create dummy instructor accounts for every subject that currently has no qualified instructor.
// Run with: node scripts/seed-dummy-instructors.mjs

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Parse .env.local
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

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Curated realistic academic names for various subject codes
const NAME_MAP = {
  'PROG 2': 'Prof. Alan Turing',
  'WEB 1': 'Prof. Tim Berners-Lee',
  'DATASTRUCT 1': 'Prof. Donald Knuth',
  'IM 2': 'Prof. Edgar Codd',
  'NET 1': 'Prof. Vint Cerf',
  'IPT 1': 'Prof. James Gosling',
  'GE 1': 'Prof. Leonhard Euler',
  'ACCTG': 'Prof. Luca Pacioli',
  'GEEL 2': 'Prof. Pythagoras Samos',
  'GE 5': 'Prof. Francis Fukuyama',
  'THEO 4': 'Prof. Thomas Aquinas',
  'GE 7': 'Prof. Carl Sagan',
  'QM': 'Prof. John Nash',
  'GEEL 3': 'Prof. Leonardo Da Vinci',
  'THEO 1': 'Prof. Augustine Hippo',
  'APPSDEV 1': 'Prof. Steve Wozniak',
  'PE 2': 'Coach Michael Jordan',
  'GE 2': 'Prof. Sigmund Freud',
  'MATH PREP': 'Prof. Isaac Newton',
  'PE 1': 'Coach Kobe Bryant',
  'REED 1': 'Prof. Nicolas Tolentino',
  'PE 3': 'Coach Serena Williams',
  'DISCRETE 1': 'Prof. George Boole',
  'GE 3': 'Prof. Teodoro Agoncillo',
  'THEO 2': 'Prof. Teresa Calcutta',
  'GE 4': 'Prof. Noam Chomsky',
  'PE 4': 'Coach Usain Bolt',
  'IAS 1': 'Prof. Bruce Schneier',
  'IT PROF EL 2': 'Prof. Ferdinand Saussure',
  'MMC': 'Prof. George Lucas',
  'PRAC': 'Prof. Linus Torvalds',
  'RESEARCH 1': 'Prof. Claude Shannon',
  'WEB 2': 'Prof. Brendan Eich',
  'REED 2': 'Prof. Francis Xavier',
  'IT PROF EL 4': 'Prof. Anders Hejlsberg',
  'IM 3': 'Prof. Ralph Kimball',
  'ROBOTICS': 'Prof. Isaac Asimov',
  'IT 1': 'Prof. Ada Lovelace',
  'REED 3': 'Prof. John Paul II',
  'THEO 3': 'Prof. Ignatius Loyola',
  'GE 9': 'Prof. Ambeth Ocampo',
};

async function seedDummyInstructors() {
  console.log('🚀 Checking subjects missing instructors on project:', supabaseUrl);

  // 1. Fetch all subjects
  const { data: subjects, error: subjErr } = await supabase
    .from('subjects')
    .select('id, code, title, requires_lab')
    .order('code', { ascending: true });

  if (subjErr) {
    console.error('❌ Failed to fetch subjects:', subjErr.message);
    process.exit(1);
  }

  // 2. Fetch existing qualifications
  const { data: quals, error: qualErr } = await supabase
    .from('instructor_qualifications')
    .select('subject_id, instructor_id');

  if (qualErr) {
    console.error('❌ Failed to fetch qualifications:', qualErr.message);
    process.exit(1);
  }

  const assignedSubjectIds = new Set((quals || []).map((q) => q.subject_id));
  const unassignedSubjects = subjects.filter((s) => !assignedSubjectIds.has(s.id));

  console.log(`\n📊 Total Subjects in System: ${subjects.length}`);
  console.log(`✅ Subjects with Qualified Instructors: ${assignedSubjectIds.size}`);
  console.log(`⚠️ Subjects WITHOUT Qualified Instructors: ${unassignedSubjects.length}\n`);

  if (unassignedSubjects.length === 0) {
    console.log('🎉 All subjects already have qualified instructors assigned!');
    return;
  }

  const createdSummary = [];

  for (const subject of unassignedSubjects) {
    const slug = subject.code.toLowerCase().replace(/[^a-z0-9]/g, '');
    const email = `inst.${slug}@altersched.edu`;
    const password = 'Password123!';
    const fullName = NAME_MAP[subject.code] || `Prof. ${subject.code} Faculty`;

    console.log(`▶ Creating dummy instructor for [${subject.code}] ${subject.title}...`);
    console.log(`   Account: ${email} | Name: ${fullName}`);

    // A. Create or resolve Auth user
    let userId = null;
    const { data: createData, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (createError) {
      if (createError.message.includes('already registered') || createError.message.includes('already exists')) {
        console.log(`   ℹ User ${email} already exists in Auth. Resolving user ID...`);
        const { data: listData, error: listError } = await supabase.auth.admin.listUsers();
        if (listError) {
          console.error(`   ❌ Failed to list users: ${listError.message}`);
          continue;
        }
        const existing = listData.users.find((u) => u.email === email);
        if (existing) {
          userId = existing.id;
        }
      } else {
        console.error(`   ❌ Failed to create auth user for ${email}: ${createError.message}`);
        continue;
      }
    } else {
      userId = createData.user?.id;
    }

    if (!userId) {
      console.error(`   ❌ Could not resolve user ID for ${email}`);
      continue;
    }

    // B. Ensure Profile is active instructor
    const { error: profErr } = await supabase
      .from('profiles')
      .update({
        role: 'instructor',
        status: 'active',
        full_name: fullName,
      })
      .eq('id', userId);

    if (profErr) {
      console.error(`   ❌ Profile update error: ${profErr.message}`);
    }

    // C. Create or get Instructor record
    let instructorId = null;
    const { data: existingInst } = await supabase
      .from('instructors')
      .select('id')
      .eq('profile_id', userId)
      .maybeSingle();

    if (existingInst) {
      instructorId = existingInst.id;
      // Update details
      await supabase
        .from('instructors')
        .update({
          full_name: fullName,
          needs_lab_equipment: subject.requires_lab,
          employment_type: 'full_time',
        })
        .eq('id', instructorId);
    } else {
      const { data: newInst, error: newInstErr } = await supabase
        .from('instructors')
        .insert({
          profile_id: userId,
          full_name: fullName,
          employment_type: 'full_time',
          needs_lab_equipment: subject.requires_lab,
        })
        .select('id')
        .single();

      if (newInstErr) {
        console.error(`   ❌ Instructor insert error: ${newInstErr.message}`);
        continue;
      }
      instructorId = newInst.id;
    }

    // D. Link Qualification
    const { error: qErr } = await supabase.from('instructor_qualifications').upsert(
      {
        instructor_id: instructorId,
        subject_id: subject.id,
      },
      { onConflict: 'instructor_id,subject_id' }
    );

    if (qErr) {
      console.error(`   ❌ Qualification link error: ${qErr.message}`);
    } else {
      console.log(`   ✅ Qualification linked: ${fullName} -> ${subject.code}`);
    }

    // E. Seed Availability (Monday - Saturday 07:00 - 19:00 standard schedule)
    const availabilitySlots = [
      { instructor_id: instructorId, day_of_week: 1, start_time: '07:00:00', end_time: '19:00:00' },
      { instructor_id: instructorId, day_of_week: 2, start_time: '07:00:00', end_time: '19:00:00' },
      { instructor_id: instructorId, day_of_week: 3, start_time: '07:00:00', end_time: '19:00:00' },
      { instructor_id: instructorId, day_of_week: 4, start_time: '07:00:00', end_time: '19:00:00' },
      { instructor_id: instructorId, day_of_week: 5, start_time: '07:00:00', end_time: '19:00:00' },
      { instructor_id: instructorId, day_of_week: 6, start_time: '08:00:00', end_time: '17:00:00' },
    ];

    for (const slot of availabilitySlots) {
      await supabase.from('instructor_availability').insert(slot).select();
    }

    createdSummary.push({
      subjectCode: subject.code,
      subjectTitle: subject.title,
      instructorName: fullName,
      email,
      password,
    });
  }

  console.log('\n======================================================');
  console.log(`🎉 Successfully created ${createdSummary.length} dummy instructor accounts!`);
  console.log('All subjects now have assigned qualified instructors.');
  console.log('Default password for all dummy accounts: Password123!');
  console.log('======================================================\n');
}

seedDummyInstructors().catch((err) => {
  console.error('Fatal error during seed:', err);
  process.exit(1);
});
