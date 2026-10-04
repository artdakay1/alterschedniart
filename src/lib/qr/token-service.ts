// src/lib/qr/token-service.ts
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  QrToken,
  ScheduleVersion,
  AcademicTerm,
  Block,
  Program,
} from '../../types/database.ts';
import { generateQrDataUrl } from './generate-qr.ts';

export interface PublicScheduleItem {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  session_type: string;
  subject_code: string;
  subject_title: string;
  room_name: string;
  room_type?: string;
  instructor_name: string;
}

export interface PublicScheduleResult {
  status: 'valid' | 'not_found' | 'revoked';
  message?: string;
  revoked_at?: string | null;
  token?: QrToken;
  version?: {
    id: string;
    version_number: number;
    status: string;
    published_at: string | null;
    is_archived: boolean;
  };
  term?: {
    id: string;
    school_year: string;
    semester: string;
  };
  block?: {
    id: string;
    name: string;
    year_level: number;
    section: string;
    program_code?: string;
    program_name?: string;
  };
  entries?: PublicScheduleItem[];
}

/**
 * Generates or ensures a unique QR token per block for a newly published schedule version.
 * Tokens are unguessable UUIDs and resolve to exactly one schedule version.
 */
export async function generateTokensForPublishedVersion(
  adminClient: SupabaseClient,
  versionId: string
): Promise<QrToken[]> {
  // 1. Fetch version details to get term_id
  const { data: version, error: verErr } = await adminClient
    .from('schedule_versions')
    .select('id, term_id, status, version_number')
    .eq('id', versionId)
    .single();

  if (verErr || !version) {
    throw new Error(`Schedule version not found: ${verErr?.message || versionId}`);
  }

  // 2. Discover all blocks for this version
  // Priority: blocks with scheduled entries in this version
  const { data: entries } = await adminClient
    .from('schedule_entries')
    .select('class_offerings(block_id)')
    .eq('version_id', versionId);

  const blockIdSet = new Set<string>();
  for (const e of entries || []) {
    const bId = (e.class_offerings as any)?.block_id;
    if (bId) blockIdSet.add(bId);
  }

  // Fallback: also include all blocks that have class offerings for this term
  const { data: termOfferings } = await adminClient
    .from('class_offerings')
    .select('block_id')
    .eq('term_id', version.term_id);

  for (const o of termOfferings || []) {
    if (o.block_id) blockIdSet.add(o.block_id);
  }

  const blockIds = Array.from(blockIdSet);
  if (blockIds.length === 0) {
    return [];
  }

  // 3. Fetch existing tokens for this version to avoid duplicates
  const { data: existingTokens } = await adminClient
    .from('qr_tokens')
    .select('*')
    .eq('version_id', versionId);

  const existingBlockTokenMap = new Map<string, QrToken>();
  for (const tok of existingTokens || []) {
    existingBlockTokenMap.set(tok.block_id, tok as QrToken);
  }

  const newTokensToInsert: Array<{
    block_id: string;
    version_id: string;
    token: string;
  }> = [];

  for (const blockId of blockIds) {
    if (!existingBlockTokenMap.has(blockId)) {
      newTokensToInsert.push({
        block_id: blockId,
        version_id: versionId,
        token: randomUUID(),
      });
    }
  }

  if (newTokensToInsert.length > 0) {
    const { data: inserted, error: insErr } = await adminClient
      .from('qr_tokens')
      .insert(newTokensToInsert)
      .select();

    if (insErr) {
      console.error('Failed to insert qr_tokens batch:', insErr.message);
      throw new Error(`Failed to generate QR tokens: ${insErr.message}`);
    }

    return [...(existingTokens || []), ...(inserted || [])] as QrToken[];
  }

  return (existingTokens || []) as QrToken[];
}

/**
 * Revokes a QR token by setting revoked_at timestamp.
 */
export async function revokeQrToken(
  adminClient: SupabaseClient,
  actorId: string,
  tokenId: string
) {
  const now = new Date().toISOString();

  // Fetch token before
  const { data: beforeToken, error: fetchErr } = await adminClient
    .from('qr_tokens')
    .select('*')
    .eq('id', tokenId)
    .single();

  if (fetchErr || !beforeToken) {
    throw new Error('QR token not found.');
  }

  const { data: updated, error: updateErr } = await adminClient
    .from('qr_tokens')
    .update({ revoked_at: now })
    .eq('id', tokenId)
    .select()
    .single();

  if (updateErr) {
    throw new Error(`Failed to revoke token: ${updateErr.message}`);
  }

  // Audit log
  try {
    await adminClient.from('audit_log').insert({
      actor_id: actorId,
      action: 'revoke_qr_token',
      entity_type: 'qr_token',
      entity_id: tokenId,
      before: beforeToken,
      after: updated,
    });
  } catch (auditErr: any) {
    console.error('Failed to log QR token revocation to audit_log:', auditErr?.message);
  }

  return { success: true, revokedAt: now };
}

/**
 * Retrieves the public timetable for a given token.
 * Validates token existence and revoked_at status.
 * Scoped strictly to the specific block and version.
 */
export async function getPublicScheduleByToken(
  supabase: SupabaseClient,
  token: string
): Promise<PublicScheduleResult> {
  if (!token || typeof token !== 'string') {
    return { status: 'not_found', message: 'Invalid token.' };
  }

  // Try RPC first if available
  try {
    const { data: rpcData, error: rpcErr } = await (supabase.rpc as any)(
      'get_public_schedule_by_token',
      { p_token: token }
    );

    if (!rpcErr && rpcData && rpcData.status) {
      return rpcData as PublicScheduleResult;
    }
  } catch {
    // Proceed to fallback
  }

  // Fallback query
  const { data: tokenRow, error: tokErr } = await supabase
    .from('qr_tokens')
    .select('*')
    .eq('token', token)
    .maybeSingle();

  if (tokErr || !tokenRow) {
    return {
      status: 'not_found',
      message: 'The requested timetable link does not exist.',
    };
  }

  if (tokenRow.revoked_at) {
    return {
      status: 'revoked',
      revoked_at: tokenRow.revoked_at,
      message: 'This timetable link is no longer active.',
    };
  }

  // Load version & term
  const { data: versionData } = await supabase
    .from('schedule_versions')
    .select('*, academic_terms(*)')
    .eq('id', tokenRow.version_id)
    .single();

  if (!versionData) {
    return {
      status: 'not_found',
      message: 'Associated schedule version not found.',
    };
  }

  const version = versionData as ScheduleVersion & { academic_terms?: AcademicTerm | null };

  // Load block details
  const { data: blockData } = await supabase
    .from('blocks')
    .select('*, programs(*)')
    .eq('id', tokenRow.block_id)
    .single();

  const block = blockData as (Block & { programs?: Program | null }) | null;
  const blockName = block
    ? `${block.programs?.code || ''} ${block.year_level}-${block.section}`.trim()
    : 'Academic Block';

  // Load scheduled entries for this specific block & version
  const { data: entriesData } = await supabase
    .from('schedule_entries')
    .select(`
      id,
      day_of_week,
      start_time,
      end_time,
      session_type,
      class_offerings!inner (
        block_id,
        subjects (
          code,
          title
        )
      ),
      rooms (
        name,
        room_type
      ),
      instructors (
        full_name
      )
    `)
    .eq('version_id', tokenRow.version_id)
    .eq('class_offerings.block_id', tokenRow.block_id)
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true });

  const entries: PublicScheduleItem[] = (entriesData || []).map((e: any) => ({
    id: e.id,
    day_of_week: e.day_of_week,
    start_time: e.start_time,
    end_time: e.end_time,
    session_type: e.session_type || 'lecture',
    subject_code: e.class_offerings?.subjects?.code || 'N/A',
    subject_title: e.class_offerings?.subjects?.title || 'Class',
    room_name: e.rooms?.name || 'TBA',
    room_type: e.rooms?.room_type,
    instructor_name: e.instructors?.full_name || 'TBA',
  }));

  return {
    status: 'valid',
    token: tokenRow as QrToken,
    version: {
      id: version.id,
      version_number: version.version_number,
      status: version.status,
      published_at: version.published_at,
      is_archived: version.status === 'archived',
    },
    term: {
      id: version.term_id,
      school_year: version.academic_terms?.school_year || '',
      semester: version.academic_terms?.semester || '',
    },
    block: {
      id: tokenRow.block_id,
      name: blockName,
      year_level: block?.year_level || 1,
      section: block?.section || '',
      program_code: block?.programs?.code,
      program_name: block?.programs?.name,
    },
    entries,
  };
}

/**
 * Loads all blocks, their QR tokens, and generates QR code data URLs for printing.
 */
export async function loadQrSheetData(
  adminClient: SupabaseClient,
  termId: string,
  versionId: string,
  originUrl: string
) {
  // 1. Ensure tokens exist
  const tokens = await generateTokensForPublishedVersion(adminClient, versionId);
  const tokenByBlockId = new Map<string, QrToken>();
  for (const t of tokens) {
    tokenByBlockId.set(t.block_id, t);
  }

  // 2. Fetch all blocks that have offerings for this term
  const { data: offerings } = await adminClient
    .from('class_offerings')
    .select('block_id, blocks(*, programs(*))')
    .eq('term_id', termId);

  const blockMap = new Map<string, Block & { programs?: Program | null }>();
  for (const o of offerings || []) {
    if (o.blocks && !blockMap.has(o.block_id)) {
      blockMap.set(o.block_id, o.blocks as any);
    }
  }

  // 3. Count entries per block in this version
  const { data: entries } = await adminClient
    .from('schedule_entries')
    .select('class_offerings!inner(block_id)')
    .eq('version_id', versionId);

  const countsByBlock = new Map<string, number>();
  for (const e of entries || []) {
    const bId = (e.class_offerings as any)?.block_id;
    if (bId) {
      countsByBlock.set(bId, (countsByBlock.get(bId) || 0) + 1);
    }
  }

  // 4. Build items with QR code data URLs
  const items = await Promise.all(
    Array.from(blockMap.values()).map(async (block) => {
      const token = tokenByBlockId.get(block.id) || null;
      const publicUrl = token ? `${originUrl}/s/${token.token}` : `${originUrl}/s/not-found`;
      const qrDataUrl = token ? await generateQrDataUrl(publicUrl) : null;
      const classesCount = countsByBlock.get(block.id) || 0;

      return {
        block,
        token,
        qrDataUrl,
        publicUrl,
        classesCount,
      };
    })
  );

  // Sort by year level and section
  items.sort((a, b) => {
    if (a.block.year_level !== b.block.year_level) {
      return a.block.year_level - b.block.year_level;
    }
    return (a.block.section || '').localeCompare(b.block.section || '');
  });

  return items;
}

