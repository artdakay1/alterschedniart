// scripts/seed-users.mjs
// Node.js script to create test users via Supabase Admin API using SUPABASE_SERVICE_ROLE_KEY.
// Run with: node scripts/seed-users.mjs

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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
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
    email: 'pending.instructor@altersched.edu',
    password: 'Password123!',
    fullName: 'Pending Applicant',
    role: 'instructor',
    status: 'pending',
  },
];

async function seed() {
  console.log('Seeding AlterSched auth users...');

  for (const user of SEED_USERS) {
    console.log(`Processing user: ${user.email} (${user.role}/${user.status})...`);

    // 1. Try to create user via Auth Admin API
    const { data: createData, error: createError } = await supabase.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: { full_name: user.fullName },
    });

    let userId = createData?.user?.id;

    if (createError) {
      if (createError.message.includes('already registered') || createError.message.includes('already exists')) {
        console.log(`User ${user.email} already exists. Fetching existing user id...`);
        const { data: listData, error: listError } = await supabase.auth.admin.listUsers();
        if (listError) {
          console.error(`Failed to list users: ${listError.message}`);
          continue;
        }
        const existing = listData.users.find((u) => u.email === user.email);
        if (existing) {
          userId = existing.id;
        }
      } else {
        console.error(`Failed to create ${user.email}: ${createError.message}`);
        continue;
      }
    }

    if (!userId) {
      console.error(`Could not resolve user ID for ${user.email}`);
      continue;
    }

    // 2. Ensure profile matches desired role and status (since trigger sets instructor/pending by default)
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: userId,
        full_name: user.fullName,
        email: user.email,
        role: user.role,
        status: user.status,
      });

    if (profileError) {
      console.error(`Error updating profile for ${user.email}:`, profileError.message);
    } else {
      console.log(`Successfully verified profile for ${user.email} [${user.role} | ${user.status}]`);
    }
  }

  console.log('Seeding complete!');
}

seed().catch((err) => {
  console.error('Unexpected error during seeding:', err);
  process.exit(1);
});
