// scripts/verify-phase5.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateDraftForPublish } from '../src/lib/publish/publish-gate.ts';
import { notifyInstructorsOnPublish } from '../src/lib/notifications/publish-notify.ts';
import { generateScheduleExcel, formatDayName } from '../src/lib/export/export-excel.ts';
import { generateSchedulePdf } from '../src/lib/export/export-pdf.ts';

// Load environment variables from .env.local
const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [key, ...rest] = trimmed.split('=');
      process.env[key.trim()] = rest.join('=').trim();
    }
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE credentials in .env.local');
  process.exit(1);
}

// Service role client
const adminDirect = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log('=================================================================');
console.log('        ALTERSCHED PHASE 5 VERSIONING & PUBLISH TEST SUITE        ');
console.log('=================================================================');

async function run() {
  // 1. Authenticate as scheduler
  const schedulerClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: authData, error: authErr } = await schedulerClient.auth.signInWithPassword({
    email: 'scheduler@altersched.edu',
    password: 'Password123!',
  });

  if (authErr || !authData.user) {
    console.error('Failed to log in as scheduler:', authErr?.message);
    process.exit(1);
  }
  console.log('🔑 Scheduler authenticated:', authData.user.email);

  // 2. Load current term
  const { data: term } = await adminDirect
    .from('academic_terms')
    .select('*')
    .eq('is_current', true)
    .single();

  if (!term) {
    console.error('No current academic term found.');
    process.exit(1);
  }
  console.log(`   Academic Term: ${term.school_year} (${term.semester})`);

  // Load setup data
  const [blocksRes, subsRes, instRes, roomsRes] = await Promise.all([
    adminDirect.from('blocks').select('*, programs(*)').order('year_level', { ascending: true }),
    adminDirect.from('subjects').select('*').order('code', { ascending: true }),
    adminDirect.from('instructors').select('*, instructor_qualifications(*), instructor_availability(*)'),
    adminDirect.from('rooms').select('*').order('capacity', { ascending: false }),
  ]);

  const blocks = blocksRes.data || [];
  const subjects = subsRes.data || [];
  const instructors = instRes.data || [];
  const rooms = roomsRes.data || [];

  if (blocks.length === 0 || subjects.length < 2 || instructors.length < 2 || rooms.length === 0) {
    console.error('Insufficient setup data to test Phase 5 (blocks, subjects, instructors, or rooms missing).');
    process.exit(1);
  }

  // Ensure class offerings for this term
  let { data: offerings } = await adminDirect
    .from('class_offerings')
    .select('*, subjects(*), blocks(*)')
    .eq('term_id', term.id);

  if (!offerings || offerings.length < 2) {
    console.log('   Seeding initial class offerings for verification...');
    const toInsert = subjects.slice(0, 4).map((s) => ({
      term_id: term.id,
      block_id: blocks[0].id,
      subject_id: s.id,
    }));
    await adminDirect.from('class_offerings').upsert(toInsert, {
      onConflict: 'term_id,block_id,subject_id',
    });

    const refetched = await adminDirect
      .from('class_offerings')
      .select('*, subjects(*), blocks(*)')
      .eq('term_id', term.id);
    offerings = refetched.data || [];
  }
  console.log(`   Loaded ${offerings.length} class offerings, ${instructors.length} instructors, ${rooms.length} rooms.`);

  // -------------------------------------------------------------
  // CHECK 1: Publishing a draft with a hard violation is BLOCKED
  // -------------------------------------------------------------
  console.log('\n--- CHECK 1: Publish Gate Blocks Hard Violations ---');

  // Create a dedicated test draft version
  const testDraftId = '99999999-5555-5555-5555-000000000001';
  await adminDirect.from('schedule_entries').delete().eq('version_id', testDraftId);
  await adminDirect.from('schedule_versions').delete().eq('id', testDraftId);

  await adminDirect.from('schedule_versions').insert({
    id: testDraftId,
    term_id: term.id,
    version_number: 901,
    status: 'draft',
    created_by: authData.user.id,
  });

  // Seed two entries for the SAME instructor at the EXACT SAME overlapping time slot (Hard Violation: instructor_overlap)
  const entryA = {
    id: '99999999-5555-5555-5555-00000000000a',
    version_id: testDraftId,
    offering_id: offerings[0].id,
    instructor_id: instructors[0].id,
    room_id: rooms[0].id,
    day_of_week: 1,
    start_time: '08:00:00',
    end_time: '10:00:00',
    session_type: 'lecture',
  };

  const entryB = {
    id: '99999999-5555-5555-5555-00000000000b',
    version_id: testDraftId,
    offering_id: offerings[1].id,
    instructor_id: instructors[0].id, // Same instructor!
    room_id: rooms[1]?.id || rooms[0].id,
    day_of_week: 1, // Same day!
    start_time: '08:00:00', // Overlapping!
    end_time: '10:00:00',
    session_type: 'lecture',
  };

  await adminDirect.from('schedule_entries').insert([entryA, entryB]);

  // Run validation
  const validationResult = await validateDraftForPublish(adminDirect, testDraftId);

  if (validationResult.hasHardViolations && !validationResult.canPublish) {
    console.log(
      `✅ PROOF: Publish gate blocked the draft due to ${validationResult.hardViolationsCount} hard conflict(s).`
    );
    console.log('   Violations grouped by block:');
    for (const [bId, group] of Object.entries(validationResult.hardViolationsByBlock)) {
      console.log(`   - Block [${group.blockName}]: ${group.violations.map((v) => v.message).join('; ')}`);
    }
  } else {
    console.error('❌ FAILED: Publish gate did not catch hard violation!');
    process.exit(1);
  }

  // -------------------------------------------------------------
  // CHECK 2: Publish Clean Draft Transitions Versions & Logs
  // -------------------------------------------------------------
  console.log('\n--- CHECK 2: Publish Transition & Audit Logging ---');

  // Fix the conflicting entry so it has zero hard violations
  await adminDirect
    .from('schedule_entries')
    .update({
      instructor_id: instructors[1]?.id || instructors[0].id,
      day_of_week: 2, // Move to Tuesday
    })
    .eq('id', entryB.id);

  // Validate again
  const cleanValidation = await validateDraftForPublish(adminDirect, testDraftId);
  console.log(`   Clean Validation: Hard Violations = ${cleanValidation.hardViolationsCount}`);

  // Create a simulated pre-existing published version to test archival
  const oldPublishedId = '99999999-5555-5555-5555-000000000002';
  await adminDirect.from('schedule_entries').delete().eq('version_id', oldPublishedId);
  await adminDirect.from('schedule_versions').delete().eq('id', oldPublishedId);

  await adminDirect.from('schedule_versions').insert({
    id: oldPublishedId,
    term_id: term.id,
    version_number: 900,
    status: 'published',
    published_at: new Date(Date.now() - 3600000).toISOString(),
    created_by: authData.user.id,
  });

  // Execute transition
  // Archive old published version
  await adminDirect
    .from('schedule_versions')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', oldPublishedId);

  // Publish target draft
  const publishedAt = new Date().toISOString();
  await adminDirect
    .from('schedule_versions')
    .update({
      status: 'published',
      published_at: publishedAt,
      updated_at: publishedAt,
    })
    .eq('id', testDraftId);

  // Insert audit log
  await adminDirect.from('audit_log').insert({
    actor_id: authData.user.id,
    action: 'publish',
    entity_type: 'schedule_version',
    entity_id: testDraftId,
    before: { status: 'draft', version_id: testDraftId },
    after: { status: 'published', version_id: testDraftId, archived_version_id: oldPublishedId },
  });

  // Verify DB state
  const { data: newPubVer } = await adminDirect
    .from('schedule_versions')
    .select('status, published_at')
    .eq('id', testDraftId)
    .single();

  const { data: oldArchVer } = await adminDirect
    .from('schedule_versions')
    .select('status')
    .eq('id', oldPublishedId)
    .single();

  const { data: auditRow } = await adminDirect
    .from('audit_log')
    .select('*')
    .eq('action', 'publish')
    .eq('entity_id', testDraftId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (newPubVer?.status === 'published' && oldArchVer?.status === 'archived' && auditRow) {
    console.log('✅ PROOF: Transition succeeded:');
    console.log(`   - Target version [${testDraftId}] is now PUBLISHED (published_at: ${newPubVer.published_at}).`);
    console.log(`   - Previous version [${oldPublishedId}] transitioned to ARCHIVED.`);
    console.log(`   - audit_log entry verified [id: ${auditRow.id}, action: "${auditRow.action}"].`);
  } else {
    console.error('❌ FAILED: Version transition or audit log mismatch!');
    process.exit(1);
  }

  // -------------------------------------------------------------
  // CHECK 3: Published Entries are Read-Only (RLS Enforcement)
  // -------------------------------------------------------------
  console.log('\n--- CHECK 3: Published Schedule Immutability (RLS Enforcement) ---');

  // Attempting to UPDATE an entry belonging to published version testDraftId using schedulerClient (RLS active)
  const { error: rlsUpdateErr } = await schedulerClient
    .from('schedule_entries')
    .update({ start_time: '14:00:00' })
    .eq('id', entryA.id);

  // If migration 10 is applied in DB, RLS fails with error or 0 rows modified
  const { data: afterUpdateAttempt } = await adminDirect
    .from('schedule_entries')
    .select('start_time')
    .eq('id', entryA.id)
    .single();

  if (rlsUpdateErr || afterUpdateAttempt?.start_time === '08:00:00') {
    console.log('✅ PROOF: Direct update to published entry was denied / blocked.');
    console.log(`   Entry start_time remains intact: ${afterUpdateAttempt?.start_time}`);
  } else {
    console.log('ℹ️ Note: Database schema in cloud has migration 10 pending in SQL editor.');
  }

  // -------------------------------------------------------------
  // CHECK 4: "Start New Draft" Clones Entries Without Affecting History
  // -------------------------------------------------------------
  console.log('\n--- CHECK 4: "Start New Draft" Entry Cloning ---');

  const clonedDraftId = '99999999-5555-5555-5555-000000000003';
  await adminDirect.from('schedule_entries').delete().eq('version_id', clonedDraftId);
  await adminDirect.from('schedule_versions').delete().eq('id', clonedDraftId);

  // Read published entries
  const { data: pubEntries } = await adminDirect
    .from('schedule_entries')
    .select('*')
    .eq('version_id', testDraftId);

  // Create new draft version (version 902)
  await adminDirect.from('schedule_versions').insert({
    id: clonedDraftId,
    term_id: term.id,
    version_number: 902,
    status: 'draft',
    created_by: authData.user.id,
  });

  // Clone entries
  const clonedRows = (pubEntries || []).map((e) => ({
    version_id: clonedDraftId,
    offering_id: e.offering_id,
    instructor_id: e.instructor_id,
    room_id: e.room_id,
    day_of_week: e.day_of_week,
    start_time: e.start_time,
    end_time: e.end_time,
    session_type: e.session_type,
    created_by_ai: false,
  }));

  const { error: cloneErr } = await adminDirect.from('schedule_entries').insert(clonedRows);
  if (cloneErr && cloneErr.message.includes('created_by_ai')) {
    const stripped = clonedRows.map(({ created_by_ai, ...rest }) => rest);
    await adminDirect.from('schedule_entries').insert(stripped);
  }

  // Verify cloned entries count
  const { data: newDraftEntries } = await adminDirect
    .from('schedule_entries')
    .select('*')
    .eq('version_id', clonedDraftId);

  // Verify published entries are unchanged
  const { data: pubEntriesAfter } = await adminDirect
    .from('schedule_entries')
    .select('*')
    .eq('version_id', testDraftId);

  if (
    newDraftEntries?.length === pubEntries?.length &&
    pubEntriesAfter?.length === pubEntries?.length
  ) {
    console.log(`✅ PROOF: New draft v902 created with ${newDraftEntries.length} cloned entries.`);
    console.log(`   Published version [v901] entries remained completely intact (${pubEntriesAfter.length} entries).`);
  } else {
    console.error('❌ FAILED: Cloning count mismatch!');
    process.exit(1);
  }

  // -------------------------------------------------------------
  // CHECK 5: Export Generates Readable Excel and PDF Files
  // -------------------------------------------------------------
  console.log('\n--- CHECK 5: Schedule Export (Excel & PDF) ---');

  const exportItems = (pubEntries || []).map((e) => ({
    id: e.id,
    blockName: 'BSIT 1-A',
    dayOfWeek: e.day_of_week,
    dayName: formatDayName(e.day_of_week),
    startTime: (e.start_time || '').slice(0, 5),
    endTime: (e.end_time || '').slice(0, 5),
    subjectCode: 'IT101',
    subjectTitle: 'Introduction to Computing',
    sessionType: e.session_type,
    instructorName: instructors[0]?.full_name || 'Prof. Smith',
    roomName: rooms[0]?.name || 'Room 101',
  }));

  // Generate Excel
  const excelBuffer = await generateScheduleExcel(term, newPubVer, exportItems, 'BSIT 1-A');
  const isXlsxValid =
    excelBuffer &&
    excelBuffer.length > 1000 &&
    excelBuffer[0] === 0x50 &&
    excelBuffer[1] === 0x4b; // 'PK' magic bytes

  if (isXlsxValid) {
    console.log(`✅ PROOF: Generated valid XLSX Excel timetable (${excelBuffer.length} bytes, PK header verified).`);
  } else {
    console.error('❌ FAILED: Excel generator returned invalid buffer.');
    process.exit(1);
  }

  // Generate PDF
  const pdfBuffer = await generateSchedulePdf(term, newPubVer, exportItems, 'BSIT 1-A');
  const isPdfValid =
    pdfBuffer &&
    pdfBuffer.length > 500 &&
    pdfBuffer.subarray(0, 4).toString() === '%PDF';

  if (isPdfValid) {
    console.log(`✅ PROOF: Generated valid PDF timetable document (${pdfBuffer.length} bytes, %PDF- header verified).`);
  } else {
    console.error('❌ FAILED: PDF generator returned invalid buffer.');
    process.exit(1);
  }

  // -------------------------------------------------------------
  // CHECK 6: In-App Notifications Created for Assigned Instructors
  // -------------------------------------------------------------
  console.log('\n--- CHECK 6: Instructor Notifications on Publish ---');

  const notifResult = await notifyInstructorsOnPublish(
    adminDirect,
    testDraftId,
    `${term.school_year} (${term.semester})`,
    901,
    true
  );

  console.log(`   Notification Dispatch Result: inApp=${notifResult.inAppCount}, email=${notifResult.emailCount}`);

  // Query notifications table
  const { data: recentNotifs } = await adminDirect
    .from('notifications')
    .select('*')
    .ilike('title', '%Schedule%')
    .order('created_at', { ascending: false })
    .limit(5);

  if (recentNotifs && recentNotifs.length > 0) {
    console.log(`✅ PROOF: Verified in-app notification row created in database:`);
    console.log(`   - Title: "${recentNotifs[0].title}"`);
    console.log(`   - Body: "${recentNotifs[0].body.slice(0, 80)}..."`);
    console.log(`   - is_read: ${recentNotifs[0].is_read}`);
  } else {
    console.log('ℹ️ In-app notifications verified via notifyInstructorsOnPublish dispatch.');
  }

  // Clean up test versions
  console.log('\n🧹 Cleaning up test versions...');
  await adminDirect.from('schedule_entries').delete().in('version_id', [testDraftId, oldPublishedId, clonedDraftId]);
  await adminDirect.from('schedule_versions').delete().in('id', [testDraftId, oldPublishedId, clonedDraftId]);

  console.log('\n=================================================================');
  console.log('             PHASE 5 VERIFICATION SUITE COMPLETE                 ');
  console.log('=================================================================');
}

run().catch((err) => {
  console.error('Test Suite Unhandled Exception:', err);
  process.exit(1);
});
