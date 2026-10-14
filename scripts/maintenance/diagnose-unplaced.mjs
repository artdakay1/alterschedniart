import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf8');
const envVars = {};
for (const line of env.split('\n')) {
  const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (m) {
    let v = m[2] ? m[2].trim() : '';
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    envVars[m[1]] = v;
  }
}

const supabase = createClient(
  envVars.NEXT_PUBLIC_SUPABASE_URL,
  envVars.SUPABASE_SERVICE_ROLE_KEY || envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function run() {
  const { data: versions, error: vErr } = await supabase
    .from('schedule_versions')
    .select('*')
    .order('created_at', { ascending: false });

  if (vErr || !versions || versions.length === 0) {
    console.error('Error fetching versions:', vErr);
    return;
  }

  const latestDraft = versions.find((v) => v.status === 'draft') || versions[0];
  console.log(`Analyzing version: ${latestDraft.id} (status: ${latestDraft.status}, number: ${latestDraft.version_number})`);

  const { data: entries, error: eErr } = await supabase
    .from('schedule_entries')
    .select('*, class_offerings(*, subjects(*), blocks(*, programs(*)))')
    .eq('version_id', latestDraft.id);

  if (eErr) {
    console.error('Error fetching entries:', eErr);
    return;
  }
  console.log(`Total placed entries in draft: ${entries.length}`);

  const { data: offerings, error: oErr } = await supabase
    .from('class_offerings')
    .select('*, subjects(*), blocks(*, programs(*))')
    .eq('term_id', latestDraft.term_id);

  if (oErr) {
    console.error('Error fetching offerings:', oErr);
    return;
  }
  console.log(`Total offerings for term: ${offerings.length}`);

  const { data: instructors } = await supabase
    .from('instructors')
    .select('*, instructor_qualifications(*), instructor_availability(*)');

  const unplaced = [];
  for (const off of offerings) {
    const offEntries = entries.filter((e) => e.offering_id === off.id);
    const sub = off.subjects;
    const blk = off.blocks;
    if (!sub || !blk) continue;

    const placedLec = offEntries.filter((e) => e.session_type === 'lecture');
    const placedLab = offEntries.filter((e) => e.session_type === 'lab');

    let isComplete = false;
    let missingDesc = '';

    if (sub.lecture_hours > 0 && sub.lab_hours > 0) {
      if (placedLec.length >= 1 && placedLab.length >= 1) {
        isComplete = true;
      } else {
        missingDesc = `Needs 1 Lec (${sub.lecture_hours}h) & 1 Lab (${sub.lab_hours}h). Has ${placedLec.length} Lec, ${placedLab.length} Lab.`;
      }
    } else if (sub.lecture_hours === 3 && sub.lab_hours === 0) {
      const totalHours = offEntries.reduce((sum, e) => {
        const [sh, sm] = e.start_time.split(':').map(Number);
        const [eh, em] = e.end_time.split(':').map(Number);
        return sum + ((eh * 60 + em) - (sh * 60 + sm)) / 60;
      }, 0);
      if (totalHours >= 2.8) {
        isComplete = true;
      } else {
        missingDesc = `3h Lecture: Placed ${totalHours}h / 3h (${offEntries.length} sessions).`;
      }
    } else {
      const reqHours = sub.lecture_hours + sub.lab_hours;
      const totalHours = offEntries.reduce((sum, e) => {
        const [sh, sm] = e.start_time.split(':').map(Number);
        const [eh, em] = e.end_time.split(':').map(Number);
        return sum + ((eh * 60 + em) - (sh * 60 + sm)) / 60;
      }, 0);
      if (totalHours >= reqHours - 0.2) {
        isComplete = true;
      } else {
        missingDesc = `${offEntries.length} sessions placed. Needs ${reqHours}h.`;
      }
    }

    if (!isComplete) {
      const qual = instructors.filter((i) =>
        (i.instructor_qualifications || []).some((q) => q.subject_id === sub.id)
      );
      unplaced.push({
        blockName: `${blk.programs?.code || ''} ${blk.year_level}${blk.section}`,
        subjectCode: sub.code,
        subjectTitle: sub.title,
        missingDesc,
        qualifiedInstructors: qual.map((i) => i.full_name),
      });
    }
  }

  console.log(`\n=== UNPLACED / INCOMPLETE OFFERINGS COUNT: ${unplaced.length} ===\n`);
  const byBlock = {};
  for (const u of unplaced) {
    byBlock[u.blockName] = byBlock[u.blockName] || [];
    byBlock[u.blockName].push(u);
  }

  for (const [block, items] of Object.entries(byBlock)) {
    console.log(`Block: ${block} (${items.length} unplaced)`);
    for (const it of items) {
      console.log(`  - [${it.subjectCode}] ${it.subjectTitle}`);
      console.log(`    Missing: ${it.missingDesc}`);
      console.log(`    Qualified faculty (${it.qualifiedInstructors.length}): ${it.qualifiedInstructors.join(', ')}`);
    }
    console.log('');
  }
}

run();
