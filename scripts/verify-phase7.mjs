// scripts/verify-phase7.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  generateTokensForPublishedVersion,
  revokeQrToken,
  getPublicScheduleByToken,
  loadQrSheetData,
} from '../src/lib/qr/token-service.ts';
import { generateQrDataUrl } from '../src/lib/qr/generate-qr.ts';

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
  console.error('❌ Missing SUPABASE credentials in .env.local');
  process.exit(1);
}

const cleanUrl = supabaseUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');

// Direct admin client
const adminClient = createClient(cleanUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Anonymous client (no session)
const anonClient = createClient(cleanUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log('=================================================================');
console.log('         ALTERSCHED PHASE 7 PUBLIC QR VERIFICATION SUITE         ');
console.log('=================================================================');

async function run() {
  let passedTests = 0;
  const totalTests = 6;

  // -------------------------------------------------------------
  // Test 1: Anonymous RLS Enumeration Protection
  // -------------------------------------------------------------
  console.log('\n--- TEST 1: Anonymous Role RLS Privacy (No Enumeration) ---');
  try {
    const { data: anonTokens, error: tokErr } = await anonClient
      .from('qr_tokens')
      .select('*');
    const { data: anonBlocks, error: blkErr } = await anonClient
      .from('blocks')
      .select('*');

    const tokenCount = anonTokens ? anonTokens.length : 0;
    const blockCount = anonBlocks ? anonBlocks.length : 0;

    console.log(`Anon qr_tokens query returned: ${tokenCount} rows (expected: 0)`);
    console.log(`Anon blocks query returned: ${blockCount} rows (expected: 0)`);

    if (tokenCount === 0 && blockCount === 0) {
      console.log('✅ TEST 1 PASSED: Anonymous RLS blocks listing/enumerating tokens and blocks.');
      passedTests++;
    } else {
      console.error('❌ TEST 1 FAILED: Anonymous role can enumerate rows!', { tokenCount, blockCount });
    }
  } catch (err) {
    console.error('❌ TEST 1 EXCEPTION:', err);
  }

  // -------------------------------------------------------------
  // Setup Test Data: Version, Term, Block & Entries
  // -------------------------------------------------------------
  console.log('\n--- SETUP: Resolving or Creating Test Version & Block ---');
  // Find current term
  const { data: terms } = await adminClient
    .from('academic_terms')
    .select('*')
    .eq('is_current', true)
    .limit(1);

  const testTerm = terms?.[0];
  if (!testTerm) {
    console.error('❌ No current academic term found in database.');
    process.exit(1);
  }

  // Find or create a published version
  let { data: pubVersions } = await adminClient
    .from('schedule_versions')
    .select('*')
    .eq('term_id', testTerm.id)
    .eq('status', 'published')
    .order('version_number', { ascending: false })
    .limit(1);

  let publishedVersion = pubVersions?.[0];
  if (!publishedVersion) {
    const { data: allVers } = await adminClient
      .from('schedule_versions')
      .select('version_number')
      .eq('term_id', testTerm.id)
      .order('version_number', { ascending: false })
      .limit(1);

    const nextVerNumber = (allVers?.[0]?.version_number || 0) + 1;
    const { data: newVer, error: vErr } = await adminClient
      .from('schedule_versions')
      .insert({
        term_id: testTerm.id,
        version_number: nextVerNumber,
        status: 'published',
        published_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (vErr) throw vErr;
    publishedVersion = newVer;
  }
  console.log(`Using published version v${publishedVersion.version_number} (ID: ${publishedVersion.id})`);

  // Find a block for this term
  const { data: blocks } = await adminClient.from('blocks').select('*').limit(1);
  const testBlock = blocks?.[0];
  if (!testBlock) {
    console.error('❌ No blocks found in database.');
    process.exit(1);
  }

  // Ensure offerings and an entry exist for this block in this version
  const { data: offerings } = await adminClient
    .from('class_offerings')
    .select('id')
    .eq('term_id', testTerm.id)
    .eq('block_id', testBlock.id)
    .limit(1);

  let offeringId = offerings?.[0]?.id;
  if (!offeringId) {
    // create dummy offering
    const { data: subj } = await adminClient.from('subjects').select('id').limit(1);
    const { data: newOff } = await adminClient
      .from('class_offerings')
      .insert({
        term_id: testTerm.id,
        block_id: testBlock.id,
        subject_id: subj[0].id,
      })
      .select()
      .single();
    offeringId = newOff.id;
  }

  // Ensure at least one schedule entry exists
  const { data: existingEntries } = await adminClient
    .from('schedule_entries')
    .select('id')
    .eq('version_id', publishedVersion.id)
    .limit(1);

  if (!existingEntries || existingEntries.length === 0) {
    const { data: rooms } = await adminClient.from('rooms').select('id').limit(1);
    const { data: instructors } = await adminClient.from('instructors').select('id').limit(1);
    await adminClient.from('schedule_entries').insert({
      version_id: publishedVersion.id,
      offering_id: offeringId,
      room_id: rooms?.[0]?.id || null,
      instructor_id: instructors?.[0]?.id || null,
      day_of_week: 1, // Monday
      start_time: '08:00',
      end_time: '10:00',
      session_type: 'lecture',
    });
    console.log('Inserted sample schedule entry for test block.');
  }

  // -------------------------------------------------------------
  // Test 2: QR Token Generation & Unguessable Structure
  // -------------------------------------------------------------
  console.log('\n--- TEST 2: Per-Block QR Token Generation on Publish ---');
  let testTokenRow = null;
  try {
    const tokens = await generateTokensForPublishedVersion(adminClient, publishedVersion.id);
    console.log(`Generated/Loaded ${tokens.length} QR token(s) for version v${publishedVersion.version_number}`);

    testTokenRow = tokens.find((t) => t.block_id === testBlock.id) || tokens[0];

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      testTokenRow.token
    );

    if (testTokenRow && isUUID && testTokenRow.version_id === publishedVersion.id) {
      console.log(`Token: "${testTokenRow.token}" (Valid UUID format, unguessable)`);
      console.log('✅ TEST 2 PASSED: Tokens generated per block with unguessable random UUIDs.');
      passedTests++;
    } else {
      console.error('❌ TEST 2 FAILED: Token does not match expected format or version ID.');
    }
  } catch (err) {
    console.error('❌ TEST 2 EXCEPTION:', err);
  }

  // -------------------------------------------------------------
  // Test 3: Public Schedule Lookup (No Auth Required)
  // -------------------------------------------------------------
  console.log('\n--- TEST 3: Public Read-Only Schedule Lookup (/s/[token]) ---');
  try {
    const publicSchedule = await getPublicScheduleByToken(adminClient, testTokenRow.token);

    console.log('Lookup status:', publicSchedule.status);
    console.log('Resolved block:', publicSchedule.block?.name);
    console.log('Schedule entries count:', publicSchedule.entries?.length);

    if (
      publicSchedule.status === 'valid' &&
      publicSchedule.block &&
      publicSchedule.version &&
      publicSchedule.entries !== undefined
    ) {
      console.log('✅ TEST 3 PASSED: Public schedule resolves correctly without user login.');
      passedTests++;
    } else {
      console.error('❌ TEST 3 FAILED: Public schedule failed to resolve valid data.');
    }
  } catch (err) {
    console.error('❌ TEST 3 EXCEPTION:', err);
  }

  // -------------------------------------------------------------
  // Test 4: Revocation Action & Nonexistent Token (No Data Leak)
  // -------------------------------------------------------------
  console.log('\n--- TEST 4: Token Revocation & Nonexistent Token Privacy ---');
  try {
    // 4a: Nonexistent token
    const nonExistentRes = await getPublicScheduleByToken(adminClient, 'non-existent-fake-token-9999');
    const leakCheckNonExistent = !nonExistentRes.entries && nonExistentRes.status === 'not_found';

    // 4b: Create a temporary token and revoke it
    const tempTokenStr = randomUUID();
    const { data: tempToken } = await adminClient
      .from('qr_tokens')
      .insert({
        block_id: testBlock.id,
        version_id: publishedVersion.id,
        token: tempTokenStr,
      })
      .select()
      .single();

    // Revoke using revokeQrToken
    const { data: profiles } = await adminClient.from('profiles').select('id').limit(1);
    const actorId = profiles?.[0]?.id || '00000000-0000-0000-0000-000000000001';
    await revokeQrToken(adminClient, actorId, tempToken.id);

    const revokedRes = await getPublicScheduleByToken(adminClient, tempTokenStr);
    const leakCheckRevoked = !revokedRes.entries && revokedRes.status === 'revoked';

    console.log('Nonexistent token result:', nonExistentRes.status, `(message: "${nonExistentRes.message}")`);
    console.log('Revoked token result:', revokedRes.status, `(revoked_at: ${revokedRes.revoked_at})`);

    // Clean up temporary token
    await adminClient.from('qr_tokens').delete().eq('id', tempToken.id);

    if (leakCheckNonExistent && leakCheckRevoked) {
      console.log('✅ TEST 4 PASSED: Nonexistent & revoked tokens show friendly inactive page with 0 data leaked.');
      passedTests++;
    } else {
      console.error('❌ TEST 4 FAILED: Schedule data was leaked or invalid status returned.');
    }
  } catch (err) {
    console.error('❌ TEST 4 EXCEPTION:', err);
  }

  // -------------------------------------------------------------
  // Test 5: Archived Version Token Still Resolves with Banner Flag
  // -------------------------------------------------------------
  console.log('\n--- TEST 5: Archived Version Resolution & Older Version Banner Flag ---');
  try {
    // Create an archived version with a token
    const { data: latestVers } = await adminClient
      .from('schedule_versions')
      .select('version_number')
      .eq('term_id', testTerm.id)
      .order('version_number', { ascending: false })
      .limit(1);
    const archVerNumber = (latestVers?.[0]?.version_number || 10) + 5;

    const { data: archivedVer } = await adminClient
      .from('schedule_versions')
      .insert({
        term_id: testTerm.id,
        version_number: archVerNumber,
        status: 'archived',
        published_at: new Date(Date.now() - 86400000).toISOString(),
      })
      .select()
      .single();

    const archTokenStr = randomUUID();
    const { data: archToken } = await adminClient
      .from('qr_tokens')
      .insert({
        block_id: testBlock.id,
        version_id: archivedVer.id,
        token: archTokenStr,
      })
      .select()
      .single();

    const archSchedule = await getPublicScheduleByToken(adminClient, archTokenStr);

    console.log('Archived token status:', archSchedule.status);
    console.log('Version status:', archSchedule.version?.status);
    console.log('is_archived flag:', archSchedule.version?.is_archived);

    // Clean up
    await adminClient.from('qr_tokens').delete().eq('id', archToken.id);
    await adminClient.from('schedule_versions').delete().eq('id', archivedVer.id);

    if (archSchedule.status === 'valid' && archSchedule.version?.is_archived === true) {
      console.log('✅ TEST 5 PASSED: Archived version token resolves and correctly flags is_archived = true.');
      passedTests++;
    } else {
      console.error('❌ TEST 5 FAILED: Archived version token did not resolve or missing is_archived flag.');
    }
  } catch (err) {
    console.error('❌ TEST 5 EXCEPTION:', err);
  }

  // -------------------------------------------------------------
  // Test 6: QR Code Image Generation & Printable Sheet Data
  // -------------------------------------------------------------
  console.log('\n--- TEST 6: QR Code Image Generation & Printable Sheet Preparation ---');
  try {
    const testUrl = `http://localhost:3000/s/${testTokenRow.token}`;
    const qrDataUrl = await generateQrDataUrl(testUrl);

    const isPngDataUrl = qrDataUrl.startsWith('data:image/png;base64,');
    console.log('Generated QR Data URL:', isPngDataUrl ? 'Valid PNG Base64 data' : 'Invalid');

    // Test loadQrSheetData
    const sheetItems = await loadQrSheetData(
      adminClient,
      testTerm.id,
      publishedVersion.id,
      'http://localhost:3000'
    );

    console.log(`Loaded ${sheetItems.length} printable sheet block items.`);
    const firstHasQr = sheetItems[0]?.qrDataUrl?.startsWith('data:image/png;base64,');

    if (isPngDataUrl && sheetItems.length > 0 && firstHasQr) {
      console.log('✅ TEST 6 PASSED: QR code images generate properly and printable sheet items are prepared.');
      passedTests++;
    } else {
      console.error('❌ TEST 6 FAILED: QR code generation or sheet data preparation failed.');
    }
  } catch (err) {
    console.error('❌ TEST 6 EXCEPTION:', err);
  }

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log('\n=================================================================');
  console.log(`Phase 7 Verification Result: ${passedTests}/${totalTests} Passed`);
  console.log('=================================================================');

  if (passedTests === totalTests) {
    console.log('🎉 ALL PHASE 7 CRITERIA SUCCESSFULLY VERIFIED!\n');
    process.exit(0);
  } else {
    console.error('❌ SOME PHASE 7 CHECKS FAILED.\n');
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
