// src/app/api/schedule/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateScheduleExcel, formatDayName, type ScheduleExportItem } from '@/lib/export/export-excel';
import { generateSchedulePdf } from '@/lib/export/export-pdf';
import type { AcademicTerm, ScheduleVersion, Block } from '@/types/database';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // Check user profile and role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single();

  if (!profile || profile.status !== 'active') {
    return new NextResponse('Forbidden: Inactive account', { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const versionId = searchParams.get('versionId');
  const format = searchParams.get('format') || 'excel';
  const blockId = searchParams.get('blockId');

  if (!versionId) {
    return new NextResponse('Missing required parameter: versionId', { status: 400 });
  }

  // 1. Fetch Version
  const { data: versionData, error: versionErr } = await supabase
    .from('schedule_versions')
    .select('*, academic_terms(*)')
    .eq('id', versionId)
    .single();

  if (versionErr || !versionData) {
    return new NextResponse('Schedule version not found', { status: 404 });
  }

  const version = versionData as ScheduleVersion & { academic_terms?: AcademicTerm | null };
  const term = version.academic_terms;

  if (!term) {
    return new NextResponse('Academic term for version not found', { status: 404 });
  }

  // Instructors can only view/export published schedules
  if (profile.role === 'instructor' && version.status !== 'published') {
    return new NextResponse('Forbidden: Instructors may only export published schedules', {
      status: 403,
    });
  }

  // 2. Fetch Entries
  let query = supabase
    .from('schedule_entries')
    .select(`
      id,
      day_of_week,
      start_time,
      end_time,
      session_type,
      class_offerings (
        id,
        block_id,
        subjects (
          code,
          title
        ),
        blocks (
          id,
          year_level,
          section,
          programs (
            code
          )
        )
      ),
      instructors (
        full_name
      ),
      rooms (
        name,
        code
      )
    `)
    .eq('version_id', versionId);

  const { data: rawEntries, error: entriesErr } = await query;

  if (entriesErr) {
    return new NextResponse(`Database error: ${entriesErr.message}`, { status: 500 });
  }

  // 3. Optional Block Filter
  let filteredEntries = rawEntries || [];
  let blockFilterName: string | undefined;

  if (blockId) {
    filteredEntries = filteredEntries.filter(
      (e: any) => e.class_offerings?.block_id === blockId
    );
    const firstBlock = filteredEntries[0]?.class_offerings?.blocks;
    if (firstBlock) {
      const prog = (firstBlock as any)?.programs?.code || 'BSIT';
      blockFilterName = `${prog} ${firstBlock.year_level}-${firstBlock.section}`;
    }
  }

  // 4. Map into ScheduleExportItem[]
  const exportItems: ScheduleExportItem[] = filteredEntries.map((e: any) => {
    const block = e.class_offerings?.blocks;
    const prog = block?.programs?.code || 'BSIT';
    const blockName = block ? `${prog} ${block.year_level}-${block.section}` : 'Unassigned';

    const subject = e.class_offerings?.subjects;
    const instructor = e.instructors;
    const room = e.rooms;

    return {
      id: e.id,
      blockName,
      dayOfWeek: e.day_of_week,
      dayName: formatDayName(e.day_of_week),
      startTime: (e.start_time || '').slice(0, 5),
      endTime: (e.end_time || '').slice(0, 5),
      subjectCode: subject?.code || 'N/A',
      subjectTitle: subject?.title || 'Unknown Subject',
      sessionType: e.session_type,
      instructorName: instructor?.full_name || 'TBA',
      roomName: room?.name || room?.code || 'TBA',
    };
  });

  const filenameBase = blockFilterName
    ? `Schedule-${blockFilterName.replace(/\s+/g, '_')}-v${version.version_number}`
    : `Schedule-${term.school_year.replace(/\s+/g, '_')}-v${version.version_number}`;

  // 5. Generate and return Excel or PDF
  if (format === 'pdf') {
    const pdfBuffer = await generateSchedulePdf(term, version, exportItems, blockFilterName);
    return new NextResponse(pdfBuffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filenameBase}.pdf"`,
      },
    });
  }

  // Default: Excel
  const excelBuffer = await generateScheduleExcel(term, version, exportItems, blockFilterName);
  return new NextResponse(excelBuffer as any, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filenameBase}.xlsx"`,
    },
  });
}
