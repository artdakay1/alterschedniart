// src/app/actions/qr-actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  generateTokensForPublishedVersion,
  revokeQrToken,
} from '@/lib/qr/token-service';

async function assertSchedulerOrAdminCaller() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('Authentication required.');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single();

  if (
    !profile ||
    profile.status !== 'active' ||
    (profile.role !== 'scheduler' && profile.role !== 'admin')
  ) {
    throw new Error(
      'Unauthorized: Caller must be an active scheduler or administrator.'
    );
  }

  return { supabase, user, profile };
}

/**
 * Revokes a QR token so that its public schedule URL is deactivated.
 */
export async function revokeQrTokenAction(tokenId: string) {
  const { user } = await assertSchedulerOrAdminCaller();
  const adminClient = createAdminClient();

  const result = await revokeQrToken(adminClient, user.id, tokenId);

  revalidatePath('/scheduler/qr-sheets');
  revalidatePath('/admin/qr-sheets');
  revalidatePath('/scheduler/schedules');

  return result;
}

/**
 * Manually triggers generation of QR tokens for a published schedule version if needed.
 */
export async function generateTokensForVersionAction(versionId: string) {
  await assertSchedulerOrAdminCaller();
  const adminClient = createAdminClient();

  const tokens = await generateTokensForPublishedVersion(adminClient, versionId);

  revalidatePath('/scheduler/qr-sheets');
  revalidatePath('/admin/qr-sheets');
  revalidatePath('/scheduler/schedules');

  return { success: true, tokensCount: tokens.length };
}
