// src/app/admin/qr-sheets/page.tsx
import React from 'react';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { QrSheetsClient } from '@/components/QrSheetsClient';
import { loadQrSheetData } from '@/lib/qr/token-service';
import type { AcademicTerm, ScheduleVersion } from '@/types/database';

export const dynamic = 'force-dynamic';

interface AdminQrSheetsPageProps {
  searchParams: Promise<{
    termId?: string;
    versionId?: string;
  }>;
}

export default async function AdminQrSheetsPage({ searchParams }: AdminQrSheetsPageProps) {
  const { termId: paramTermId, versionId: paramVersionId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single();

  if (!profile || profile.status !== 'active' || profile.role !== 'admin') {
    redirect('/login');
  }

  const adminClient = createAdminClient();

  // Fetch target or current academic term
  let currentTerm: AcademicTerm | null = null;
  if (paramTermId) {
    const { data: t } = await supabase
      .from('academic_terms')
      .select('*')
      .eq('id', paramTermId)
      .maybeSingle();
    currentTerm = t as AcademicTerm | null;
  }
  if (!currentTerm) {
    const { data: t } = await supabase
      .from('academic_terms')
      .select('*')
      .eq('is_current', true)
      .maybeSingle();
    currentTerm = t as AcademicTerm | null;
  }

  // Fetch specified version or latest published version
  let publishedVersion: ScheduleVersion | null = null;
  let items: any[] = [];

  if (paramVersionId) {
    const { data: v } = await supabase
      .from('schedule_versions')
      .select('*')
      .eq('id', paramVersionId)
      .maybeSingle();
    if (v) publishedVersion = v as ScheduleVersion;
  }

  if (!publishedVersion && currentTerm) {
    const { data: pubData } = await supabase
      .from('schedule_versions')
      .select('*')
      .eq('term_id', currentTerm.id)
      .eq('status', 'published')
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pubData) publishedVersion = pubData as ScheduleVersion;
  }

  if (publishedVersion) {
    const termId = publishedVersion.term_id;
    if (!currentTerm || currentTerm.id !== termId) {
      const { data: t } = await supabase
        .from('academic_terms')
        .select('*')
        .eq('id', termId)
        .maybeSingle();
      if (t) currentTerm = t as AcademicTerm;
    }

    // Determine public origin URL
    const headersList = await headers();
    const host =
      headersList.get('x-forwarded-host') ||
      headersList.get('host') ||
      'localhost:3000';
    const protocol =
      headersList.get('x-forwarded-proto') ||
      (host.includes('localhost') ? 'http' : 'https');
    const originUrl = `${protocol}://${host}`;

    items = await loadQrSheetData(
      adminClient,
      termId,
      publishedVersion.id,
      originUrl
    );
  }

  return (
    <QrSheetsClient
      currentTerm={currentTerm}
      publishedVersion={publishedVersion}
      items={items}
      userRole="admin"
    />
  );
}
