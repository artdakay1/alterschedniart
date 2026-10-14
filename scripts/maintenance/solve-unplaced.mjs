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

async function solveUnplaced() {
  const { data: versions } = await supabase
    .from('schedule_versions')
    .select('*')
    .order('created_at', { ascending: false });

  const draft = versions.find((v) => v.status === 'draft') || versions[0];
  console.log(`Solving for draft version ${draft.id}...`);

  const { data: entries } = await supabase
    .from('schedule_entries')
    .select('*, class_offerings(*, subjects(*), blocks(*))')
    .eq('version_id', draft.id);

  const { data: offerings } = await supabase
    .from('class_offerings')
    .select('*, subjects(*), blocks(*, programs(*))')
    .eq('term_id', draft.term_id);

  const { data: instructors } = await supabase
    .from('instructors')
    .select('*, instructor_qualifications(*), instructor_availability(*)');

  const { data: rooms } = await supabase.from('rooms').select('*');
  const availableRooms = rooms.filter((r) => r.allowed_departments?.includes('BSIT') || r.is_shared);
  const naRoomId = '00000000-0000-0000-0000-000000000000';

  function timeToMinutes(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }
  function timeRangesOverlap(s1, e1, s2, e2) {
    return s1 < e2 && s2 < e1;
  }

  const allEntries = [...entries];

  const isBlockOcc = (bId, day, s, e) => {
    return allEntries.some(
      (x) =>
        x.class_offerings?.block_id === bId &&
        x.day_of_week === day &&
        timeRangesOverlap(s, e, x.start_time, x.end_time)
    );
  };
  const isInstOcc = (iId, day, s, e) => {
    return allEntries.some(
      (x) =>
        x.instructor_id === iId &&
        x.day_of_week === day &&
        timeRangesOverlap(s, e, x.start_time, x.end_time)
    );
  };
  const isRoomOcc = (rId, day, s, e) => {
    if (!rId || rId === naRoomId) return false;
    return allEntries.some(
      (x) =>
        x.room_id === rId &&
        x.day_of_week === day &&
        timeRangesOverlap(s, e, x.start_time, x.end_time)
    );
  };

  const unplacedOfferings = [];
  for (const off of offerings) {
    const offEntries = allEntries.filter((e) => e.offering_id === off.id);
    const sub = off.subjects;
    if (!sub) continue;
    if (sub.lecture_hours > 0 && sub.lab_hours > 0) {
      const hasLec = offEntries.some((e) => e.session_type === 'lecture');
      const hasLab = offEntries.some((e) => e.session_type === 'lab');
      if (!hasLec || !hasLab) {
        unplacedOfferings.push({ off, missing: { lec: !hasLec, lab: !hasLab } });
      }
    } else {
      const reqHours = sub.lecture_hours + sub.lab_hours;
      let placedMinutes = 0;
      for (const e of offEntries) {
        placedMinutes += timeToMinutes(e.end_time) - timeToMinutes(e.start_time);
      }
      if (placedMinutes < reqHours * 60 - 10) {
        unplacedOfferings.push({ off, missing: { hours: reqHours - placedMinutes / 60 } });
      }
    }
  }

  console.log(`Unplaced offerings remaining: ${unplacedOfferings.length}`);

  const split15Slots = [
    ['08:00', '09:30'],
    ['09:30', '11:00'],
    ['11:00', '12:30'],
    ['13:00', '14:30'],
    ['14:30', '16:00'],
    ['16:00', '17:30'],
    ['17:30', '19:00'],
  ];

  const dayPairs = [
    [1, 3],
    [2, 4],
    [1, 4],
    [2, 5],
    [1, 5],
    [3, 5],
    [5, 6],
  ];

  const placedRows = [];

  for (const { off, missing } of unplacedOfferings) {
    const sub = off.subjects;
    const blk = off.blocks;
    const qualInsts = instructors.filter((i) =>
      (i.instructor_qualifications || []).some((q) => q.subject_id === sub.id)
    );

    if (qualInsts.length === 0) {
      console.warn(`No qualified instructors for ${sub.code}`);
      continue;
    }

    if (sub.lecture_hours > 0 && sub.lab_hours > 0) {
      let placed = false;
      for (const [d1, d2] of dayPairs) {
        if (placed) break;
        for (const [st, et] of split15Slots) {
          if (isBlockOcc(blk.id, d1, st, et) || isBlockOcc(blk.id, d2, st, et)) continue;

          const inst = qualInsts.find(
            (i) => !isInstOcc(i.id, d1, st, et) && !isInstOcc(i.id, d2, st, et)
          );
          if (!inst) continue;

          const lecRoom =
            availableRooms.find((r) => r.room_type === 'lecture' && !isRoomOcc(r.id, d1, st, et)) ||
            availableRooms.find((r) => !isRoomOcc(r.id, d1, st, et));
          const labRoom =
            availableRooms.find((r) => r.room_type === 'laboratory' && !isRoomOcc(r.id, d2, st, et)) ||
            availableRooms.find((r) => !isRoomOcc(r.id, d2, st, et));

          if (!lecRoom || !labRoom) continue;

          const r1 = {
            version_id: draft.id,
            offering_id: off.id,
            instructor_id: inst.id,
            room_id: lecRoom.id,
            day_of_week: d1,
            start_time: `${st}:00`,
            end_time: `${et}:00`,
            session_type: 'lecture',
            created_by_ai: true,
            class_offerings: off,
          };
          const r2 = {
            version_id: draft.id,
            offering_id: off.id,
            instructor_id: inst.id,
            room_id: labRoom.id,
            day_of_week: d2,
            start_time: `${st}:00`,
            end_time: `${et}:00`,
            session_type: 'lab',
            created_by_ai: true,
            class_offerings: off,
          };

          allEntries.push(r1, r2);
          placedRows.push(r1, r2);
          placed = true;
          console.log(
            `Placed ${sub.code} for ${blk.programs?.code} ${blk.year_level}${blk.section}: Lec ${d1} ${st}-${et}, Lab ${d2} ${st}-${et} with ${inst.full_name}`
          );
          break;
        }
      }

      if (!placed) {
        // Fallback to independent sessions
        for (const [sessType, roomType] of [
          ['lecture', 'lecture'],
          ['lab', 'laboratory'],
        ]) {
          let sessPlaced = false;
          for (const d of [1, 2, 3, 4, 5, 6]) {
            if (sessPlaced) break;
            for (const [st, et] of split15Slots) {
              if (isBlockOcc(blk.id, d, st, et)) continue;
              const inst = qualInsts.find((i) => !isInstOcc(i.id, d, st, et));
              if (!inst) continue;
              const room =
                availableRooms.find((r) => r.room_type === roomType && !isRoomOcc(r.id, d, st, et)) ||
                availableRooms.find((r) => !isRoomOcc(r.id, d, st, et));
              if (!room) continue;

              const row = {
                version_id: draft.id,
                offering_id: off.id,
                instructor_id: inst.id,
                room_id: room.id,
                day_of_week: d,
                start_time: `${st}:00`,
                end_time: `${et}:00`,
                session_type: sessType,
                created_by_ai: true,
                class_offerings: off,
              };
              allEntries.push(row);
              placedRows.push(row);
              sessPlaced = true;
              console.log(
                `Placed ${sub.code} ${sessType} for ${blk.programs?.code} ${blk.year_level}${blk.section}: Day ${d} ${st}-${et} with ${inst.full_name}`
              );
              break;
            }
          }
        }
      }
    }
  }

  console.log(`\nSuccessfully solved and placed: ${placedRows.length} new sessions!`);

  if (placedRows.length > 0) {
    const toInsert = placedRows.map(({ class_offerings, ...rest }) => rest);
    const { error: insErr } = await supabase.from('schedule_entries').insert(toInsert);
    if (insErr) {
      console.error('Error inserting placed sessions:', insErr);
    } else {
      console.log('ALL PLACED SESSIONS SUCCESSFULLY PERSISTED TO DATABASE!');
    }
  }
}

solveUnplaced();
