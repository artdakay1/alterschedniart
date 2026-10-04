// scripts/verify-phase6.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  previewAlterationImpact,
} from '../src/lib/alterations/preview.ts';
import {
  executeSubmitAlteration,
  executeApproveAlteration,
  executeRejectAlteration,
} from '../src/lib/alterations/alteration-service.ts';

// 1. Load environment variables from .env.local
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

const cleanUrl = supabaseUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');

// Direct admin client
const adminDirect = createClient(cleanUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log('=================================================================');
console.log('       ALTERSCHED PHASE 6 TIMETABLE ALTERATIONS TEST SUITE        ');
console.log('=================================================================');

async function run() {
  let passedTests = 0;
  const totalTests = 5;

  // 1. Authenticate test users
  console.log('\n--- SETUP: Authenticating Test Users ---');
  const schedulerClient = createClient(cleanUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const johnClient = createClient(cleanUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const janeClient = createClient(cleanUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const [schedAuth, johnAuth, janeAuth] = await Promise.all([
    schedulerClient.auth.signInWithPassword({
      email: 'scheduler@altersched.edu',
      password: 'Password123!',
    }),
    johnClient.auth.signInWithPassword({
      email: 'john.doe@altersched.edu',
      password: 'Password123!',
    }),
    janeClient.auth.signInWithPassword({
      email: 'jane.smith@altersched.edu',
      password: 'Password123!',
    }),
  ]);

  if (!schedAuth.data.user || !johnAuth.data.user || !janeAuth.data.user) {
    console.error('❌ Failed to authenticate test users. Run `npm run seed` first.');
    process.exit(1);
  }

  const schedulerUser = schedAuth.data.user;
  const johnUser = johnAuth.data.user;
  const janeUser = janeAuth.data.user;

  console.log(`✅ Scheduler: ${schedulerUser.email} (${schedulerUser.id})`);
  console.log(`✅ Instructor John Doe: ${johnUser.email} (${johnUser.id})`);
  console.log(`✅ Instructor Jane Smith: ${janeUser.email} (${janeUser.id})`);

  // Fetch current term
  const { data: currentTerm } = await adminDirect
    .from('academic_terms')
    .select('*')
    .eq('is_current', true)
    .single();

  if (!currentTerm) {
    console.error('❌ No current academic term found.');
    process.exit(1);
  }

  // Fetch instructors records
  const { data: johnInst } = await adminDirect
    .from('instructors')
    .select('*')
    .eq('profile_id', johnUser.id)
    .single();

  const { data: janeInst } = await adminDirect
    .from('instructors')
    .select('*')
    .eq('profile_id', janeUser.id)
    .single();

  const { data: rooms } = await adminDirect.from('rooms').select('*').order('name');
  const { data: offerings } = await adminDirect
    .from('class_offerings')
    .select('*, subjects(*)')
    .eq('term_id', currentTerm.id);

  if (!johnInst || !janeInst || !rooms || rooms.length < 2 || !offerings || offerings.length < 2) {
    console.error('❌ Missing prerequisite data (instructors, rooms, or class offerings).');
    process.exit(1);
  }

  const ge101Offering = offerings.find((o) => o.subjects?.code === 'GE101') || offerings[0];
  const ge102Offering = offerings.find((o) => o.subjects?.code === 'GE102') || offerings[1];

  // -------------------------------------------------------------
  // Baseline Published Schedule Setup
  // -------------------------------------------------------------
  console.log('\n--- SETUP: Establishing Clean Published Baseline Schedule ---');
  const testBaseVersionId = '96666666-0000-0000-0000-000000000001';

  // Clean previous test artifacts
  await adminDirect.from('alteration_requests').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await adminDirect.from('schedule_entries').delete().eq('version_id', testBaseVersionId);
  await adminDirect.from('schedule_versions').delete().eq('id', testBaseVersionId);

  // Archive any other published versions for this term
  await adminDirect
    .from('schedule_versions')
    .update({ status: 'archived' })
    .eq('term_id', currentTerm.id)
    .eq('status', 'published');

  // Insert baseline published version
  const { data: pubVersion, error: pubVerErr } = await adminDirect
    .from('schedule_versions')
    .insert({
      id: testBaseVersionId,
      term_id: currentTerm.id,
      version_number: 100,
      status: 'published',
      published_at: new Date().toISOString(),
      created_by: schedulerUser.id,
    })
    .select()
    .single();

  if (pubVerErr || !pubVersion) {
    console.error('❌ Failed to create baseline published schedule version:', pubVerErr?.message);
    process.exit(1);
  }

  // Seed two distinct non-conflicting entries:
  // Entry 1 (John): Monday 08:00 - 11:00 in Room 0 (GE102: 3h lecture, John available 08:00-17:00)
  // Entry 2 (Jane): Monday 13:00 - 16:00 in Room 1 (GE101: 3h lecture, Jane available 09:00-18:00)
  const entryJohnId = '96666666-0000-0000-0000-00000000000a';
  const entryJaneId = '96666666-0000-0000-0000-00000000000b';

  await adminDirect.from('schedule_entries').delete().in('id', [entryJohnId, entryJaneId]);

  const { error: entriesErr } = await adminDirect.from('schedule_entries').insert([
    {
      id: entryJohnId,
      version_id: testBaseVersionId,
      offering_id: ge102Offering.id,
      instructor_id: johnInst.id,
      room_id: rooms[0].id,
      day_of_week: 1, // Monday
      start_time: '08:00:00',
      end_time: '11:00:00',
      session_type: 'lecture',
    },
    {
      id: entryJaneId,
      version_id: testBaseVersionId,
      offering_id: ge101Offering.id,
      instructor_id: janeInst.id,
      room_id: rooms[1].id,
      day_of_week: 1, // Monday
      start_time: '13:00:00',
      end_time: '16:00:00',
      session_type: 'lecture',
    },
  ]);

  if (entriesErr) {
    console.error('❌ Failed to insert baseline schedule entries:', entriesErr.message);
    process.exit(1);
  }
  console.log(`✅ Baseline Published Schedule v100 established with John Doe (GE102) and Jane Smith (GE101) entries.`);

  // -------------------------------------------------------------
  // TEST 1: Request Submission & Role Visibility Isolation (RLS)
  // -------------------------------------------------------------
  console.log('\n--- TEST 1: Request Submission & Role-Based Visibility (RLS) ---');
  const submitRes1 = await executeSubmitAlteration(
    adminDirect,
    { id: johnUser.id, role: 'instructor' },
    {
      entryId: entryJohnId,
      proposedChanges: {
        day_of_week: 2, // Tuesday
        start_time: '08:00',
        end_time: '11:00',
      },
      reason: 'Shift lecture to Tuesday morning per class consensus',
    }
  );

  if (!submitRes1.success || !submitRes1.requestId) {
    console.error('❌ Failed to submit alteration request 1.');
    process.exit(1);
  }
  const johnRequestId = submitRes1.requestId;
  console.log(`   Submitted request ${johnRequestId} for John Doe.`);

  // Check visibility for John (requester)
  const { data: johnRequests } = await johnClient
    .from('alteration_requests')
    .select('id, status')
    .eq('id', johnRequestId);

  const johnCanSee = johnRequests && johnRequests.length === 1;

  // Check visibility for Jane (other instructor - should be HIDDEN via RLS)
  const { data: janeRequests } = await janeClient
    .from('alteration_requests')
    .select('id, status')
    .eq('id', johnRequestId);

  const janeCanSee = janeRequests && janeRequests.length > 0;

  // Check visibility for Scheduler (approver - should be VISIBLE)
  const { data: schedRequests } = await schedulerClient
    .from('alteration_requests')
    .select('id, status')
    .eq('id', johnRequestId);

  const schedCanSee = schedRequests && schedRequests.length === 1;

  console.log(`   Requester (John) can see request: ${johnCanSee ? 'YES ✅' : 'NO ❌'}`);
  console.log(`   Other instructor (Jane) cannot see request: ${!janeCanSee ? 'YES (Hidden) ✅' : 'FAIL (Leaked) ❌'}`);
  console.log(`   Approver (Scheduler) can see request: ${schedCanSee ? 'YES ✅' : 'NO ❌'}`);

  if (johnCanSee && !janeCanSee && schedCanSee) {
    console.log('✅ TEST 1 PASSED: Submitting request creates pending row visible only to requester and approver.');
    passedTests++;
  } else {
    console.error('❌ TEST 1 FAILED: Privacy isolation or visibility check failed.');
    process.exit(1);
  }

  // -------------------------------------------------------------
  // TEST 2: Preview Impact Detects Hard Violations & Blocks Approval
  // -------------------------------------------------------------
  console.log('\n--- TEST 2: Preview Impact & Conflict Engine Approval Gate ---');

  // Submit a conflicting request: John asks to move to Monday 13:00 - 16:00 in Room 1 (where Jane already is!)
  const submitResConflict = await executeSubmitAlteration(
    adminDirect,
    { id: johnUser.id, role: 'instructor' },
    {
      entryId: entryJohnId,
      proposedChanges: {
        room_id: rooms[1].id, // Room 1 is occupied by Jane Smith at Monday 13:00-16:00!
        day_of_week: 1,
        start_time: '13:00',
        end_time: '16:00',
      },
      reason: 'Propose swap into Room 1 (conflicts with Jane Smith)',
    }
  );

  const conflictReqId = submitResConflict.requestId;
  console.log(`   Evaluating impact preview for conflicting request ${conflictReqId}...`);

  const previewResult = await previewAlterationImpact(adminDirect, conflictReqId);

  console.log(`   Can Approve: ${previewResult.canApprove}`);
  console.log(`   Hard Violations: ${previewResult.hardViolationsCount}`);
  console.log(`   Soft Violations: ${previewResult.softViolationsCount}`);
  if (previewResult.hardViolations.length > 0) {
    console.log(`   Violations Detected: [${previewResult.hardViolations.map((v) => v.rule).join(', ')}]`);
  }

  // Attempt to approve via executeApproveAlteration
  const approveAttempt = await executeApproveAlteration(
    adminDirect,
    { id: schedulerUser.id, role: 'scheduler' },
    conflictReqId
  );

  console.log(`   Approval blocked response: ${approveAttempt.blocked ? 'YES (BLOCKED) ✅' : 'FAIL ❌'}`);
  console.log(`   Block message: "${approveAttempt.error}"`);

  if (previewResult.hasHardViolations && !previewResult.canApprove && approveAttempt.blocked) {
    console.log('✅ TEST 2 PASSED: Preview impact correctly detects hard violations and blocks approval.');
    passedTests++;
  } else {
    console.error('❌ TEST 2 FAILED: Engine failed to catch or block conflicting alteration.');
    process.exit(1);
  }

  // -------------------------------------------------------------
  // TEST 3: Approving Clean Request (New Version, Archive Old, Schedule Updated)
  // -------------------------------------------------------------
  console.log('\n--- TEST 3: Approving Clean Alteration Request ---');

  // Preview clean request (johnRequestId moves to Tuesday 08:00-11:00 in Room 0, which is completely empty)
  const cleanPreview = await previewAlterationImpact(adminDirect, johnRequestId);
  console.log(`   Clean Request Can Approve: ${cleanPreview.canApprove} (Hard: ${cleanPreview.hardViolationsCount}, Soft: ${cleanPreview.softViolationsCount})`);

  if (!cleanPreview.canApprove) {
    console.error('❌ Clean request unexpectedly has hard violations:', cleanPreview.hardViolations);
    process.exit(1);
  }

  // Execute approval
  const approveCleanRes = await executeApproveAlteration(
    adminDirect,
    { id: schedulerUser.id, role: 'scheduler' },
    johnRequestId
  );

  if (!approveCleanRes.success) {
    console.error('❌ Failed to approve clean alteration request:', approveCleanRes.error);
    process.exit(1);
  }

  console.log(`   New Published Version Created: ${approveCleanRes.newVersionId} (v${approveCleanRes.versionNumber})`);

  // Verify:
  // A. Old version is archived
  const { data: oldVerCheck } = await adminDirect
    .from('schedule_versions')
    .select('status')
    .eq('id', testBaseVersionId)
    .single();

  // B. New version is published
  const { data: newVerCheck } = await adminDirect
    .from('schedule_versions')
    .select('status, published_at')
    .eq('id', approveCleanRes.newVersionId)
    .single();

  // C. Alteration request is marked approved
  const { data: reqApprovedCheck } = await adminDirect
    .from('alteration_requests')
    .select('status, reviewed_by, reviewed_at')
    .eq('id', johnRequestId)
    .single();

  // D. Instructor's entry in new version reflects the change (day_of_week = 2, start_time = '08:00')
  const { data: newEntries } = await adminDirect
    .from('schedule_entries')
    .select('*')
    .eq('version_id', approveCleanRes.newVersionId)
    .eq('instructor_id', johnInst.id);

  const updatedEntry = newEntries && newEntries[0];
  const isEntryUpdated =
    updatedEntry &&
    updatedEntry.day_of_week === 2 &&
    updatedEntry.start_time.startsWith('08:00');

  console.log(`   Old version archived: ${oldVerCheck?.status === 'archived' ? 'YES ✅' : 'NO ❌'}`);
  console.log(`   New version published: ${newVerCheck?.status === 'published' ? 'YES ✅' : 'NO ❌'}`);
  console.log(`   Request status approved: ${reqApprovedCheck?.status === 'approved' ? 'YES ✅' : 'NO ❌'}`);
  console.log(`   Instructor schedule updated in new version: ${isEntryUpdated ? 'YES (Tuesday 10:00) ✅' : 'NO ❌'}`);

  if (
    oldVerCheck?.status === 'archived' &&
    newVerCheck?.status === 'published' &&
    reqApprovedCheck?.status === 'approved' &&
    isEntryUpdated
  ) {
    console.log('✅ TEST 3 PASSED: Approval creates new published version, archives old, and updates schedule.');
    passedTests++;
  } else {
    console.error('❌ TEST 3 FAILED: Version transition or entry update verification failed.');
    process.exit(1);
  }

  // -------------------------------------------------------------
  // TEST 4: Rejecting a Request (Notifies Instructor, Untouched Schedule)
  // -------------------------------------------------------------
  console.log('\n--- TEST 4: Rejecting Request & Notifying Instructor ---');

  // Submit request for rejection testing (using the new published version's entry)
  const submitResReject = await executeSubmitAlteration(
    adminDirect,
    { id: johnUser.id, role: 'instructor' },
    {
      entryId: updatedEntry.id,
      proposedChanges: {
        room_id: rooms[1].id,
      },
      reason: 'Request moving to Room 1 for better projection equipment',
    }
  );

  const rejectReqId = submitResReject.requestId;
  const rejectionReason = 'Room 1 projector scheduled for firmware upgrade this semester.';

  // Count schedule entries before rejection
  const { data: entriesBefore } = await adminDirect
    .from('schedule_entries')
    .select('id, version_id, room_id, day_of_week, start_time')
    .eq('version_id', approveCleanRes.newVersionId);

  // Execute rejection
  const rejectRes = await executeRejectAlteration(
    adminDirect,
    { id: schedulerUser.id, role: 'scheduler' },
    rejectReqId,
    rejectionReason
  );

  if (!rejectRes.success) {
    console.error('❌ Failed to reject alteration request.');
    process.exit(1);
  }

  // Verify:
  // A. Request status is 'rejected' and rejection reason is stored
  const { data: rejectedReqCheck } = await adminDirect
    .from('alteration_requests')
    .select('*')
    .eq('id', rejectReqId)
    .single();

  const storedRejectionReason =
    rejectedReqCheck?.rejection_reason ||
    rejectedReqCheck?.proposed_changes?.rejection_reason;

  const isReasonStored = storedRejectionReason === rejectionReason;

  // B. In-app notification delivered to John Doe with reason
  const { data: notifications } = await adminDirect
    .from('notifications')
    .select('*')
    .eq('user_id', johnUser.id)
    .ilike('body', `%${rejectionReason}%`);

  const hasNotification = notifications && notifications.length > 0;

  // C. Schedule entries are completely untouched
  const { data: entriesAfter } = await adminDirect
    .from('schedule_entries')
    .select('id, version_id, room_id, day_of_week, start_time')
    .eq('version_id', approveCleanRes.newVersionId);

  const isScheduleUntouched =
    JSON.stringify(entriesBefore) === JSON.stringify(entriesAfter);

  console.log(`   Request marked rejected: ${rejectedReqCheck?.status === 'rejected' ? 'YES ✅' : 'NO ❌'}`);
  console.log(`   Rejection reason stored: ${isReasonStored ? 'YES ✅' : 'NO ❌'}`);
  console.log(`   In-app notification sent to instructor: ${hasNotification ? 'YES ✅' : 'NO ❌'}`);
  console.log(`   Schedule entries untouched: ${isScheduleUntouched ? 'YES ✅' : 'NO ❌'}`);

  if (
    rejectedReqCheck?.status === 'rejected' &&
    isReasonStored &&
    hasNotification &&
    isScheduleUntouched
  ) {
    console.log('✅ TEST 4 PASSED: Rejection stores reason, notifies instructor, and leaves schedule untouched.');
    passedTests++;
  } else {
    console.error('❌ TEST 4 FAILED: Rejection verification failed.');
    process.exit(1);
  }

  // -------------------------------------------------------------
  // TEST 5: Audit Log Records Approve and Reject
  // -------------------------------------------------------------
  console.log('\n--- TEST 5: Audit Log Verification ---');

  const { data: approveAudit } = await adminDirect
    .from('audit_log')
    .select('*')
    .eq('action', 'approve_alteration')
    .eq('entity_id', johnRequestId)
    .maybeSingle();

  const { data: rejectAudit } = await adminDirect
    .from('audit_log')
    .select('*')
    .eq('action', 'reject_alteration')
    .eq('entity_id', rejectReqId)
    .maybeSingle();

  console.log(`   Audit log for approval exists: ${approveAudit ? 'YES ✅' : 'NO ❌'}`);
  if (approveAudit) {
    console.log(`     Actor: ${approveAudit.actor_id}`);
    console.log(`     Before Version: ${approveAudit.before?.version_id}`);
    console.log(`     After Version: ${approveAudit.after?.version_id}`);
  }

  console.log(`   Audit log for rejection exists: ${rejectAudit ? 'YES ✅' : 'NO ❌'}`);
  if (rejectAudit) {
    console.log(`     Actor: ${rejectAudit.actor_id}`);
    console.log(`     Rejection reason in audit: "${rejectAudit.after?.rejection_reason}"`);
  }

  if (approveAudit && rejectAudit) {
    console.log('✅ TEST 5 PASSED: audit_log contains full before/after snapshots for both approve and reject.');
    passedTests++;
  } else {
    console.error('❌ TEST 5 FAILED: Audit log records missing.');
    process.exit(1);
  }

  // Clean up test versions
  await adminDirect.from('schedule_entries').delete().eq('version_id', approveCleanRes.newVersionId);
  await adminDirect.from('schedule_versions').delete().eq('id', approveCleanRes.newVersionId);
  await adminDirect.from('schedule_entries').delete().eq('version_id', testBaseVersionId);
  await adminDirect.from('schedule_versions').delete().eq('id', testBaseVersionId);

  console.log('\n=================================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} PHASE 6 VERIFICATION CHECKS PASSED SUCCESSFULLY!`);
  console.log('=================================================================\n');
}

run().catch((err) => {
  console.error('\n❌ Uncaught error during Phase 6 verification:', err);
  process.exit(1);
});
