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

async function balanceQualifications() {
  const { data: subjects } = await supabase.from('subjects').select('id, code');
  const { data: instructors } = await supabase.from('instructors').select('id, full_name');

  const subMap = new Map(subjects.map((s) => [s.code.toUpperCase(), s.id]));
  const instMap = new Map(instructors.map((i) => [i.full_name, i.id]));

  // Secondary qualifications to balance workloads
  const additions = [
    // ACCTG (Accounting): add Jeevie Rebias, Danline Natad, Kenneth Jeminez
    { code: 'ACCTG', inst: 'Jeevie Rebias' },
    { code: 'ACCTG', inst: 'Danline Natad' },
    { code: 'ACCTG', inst: 'Kenneth Jeminez' },

    // IT PROF EL 3 (Graphics & Visual Computing): add Kenneth Jeminez, Christian Lee Villaflor, Leh Maxine Flores
    { code: 'IT PROF EL 3', inst: 'Kenneth Jeminez' },
    { code: 'IT PROF EL 3', inst: 'Christian Lee Villaflor' },
    { code: 'IT PROF EL 3', inst: 'Leh Maxine Flores' },

    // GEEL 4 (Technopreneurship): add Leh Maxine Flores, Kenneth Jeminez, Christian Lee Villaflor
    { code: 'GEEL 4', inst: 'Leh Maxine Flores' },
    { code: 'GEEL 4', inst: 'Kenneth Jeminez' },
    { code: 'GEEL 4', inst: 'Christian Lee Villaflor' },

    // OS (Operating Systems): add Kenneth Jeminez, Reynard Abendan, Christian Lee Villaflor
    { code: 'OS', inst: 'Kenneth Jeminez' },
    { code: 'OS', inst: 'Reynard Abendan' },
    { code: 'OS', inst: 'Christian Lee Villaflor' },

    // CAPSTONE 2: add Kenneth Jeminez, Christian Lee Villaflor, Daniel Bert Uy
    { code: 'CAPSTONE 2', inst: 'Kenneth Jeminez' },
    { code: 'CAPSTONE 2', inst: 'Christian Lee Villaflor' },
    { code: 'CAPSTONE 2', inst: 'Daniel Bert Uy' },

    // REED 3: add Sir Theo
    { code: 'REED 3', inst: 'Sir Theo' },

    // GE 5: add Florencio Paras, Self Instructor
    { code: 'GE 5', inst: 'Florencio Paras' },
    { code: 'GE 5', inst: 'Self Instructor' },

    // ED (Event-Driven Programming): add Kenneth Jeminez, Reynard Abendan
    { code: 'ED', inst: 'Kenneth Jeminez' },
    { code: 'ED', inst: 'Reynard Abendan' },

    // SIA (Systems Integration & Architecture): add Kenneth Jeminez, Danline Natad
    { code: 'SIA', inst: 'Kenneth Jeminez' },
    { code: 'SIA', inst: 'Danline Natad' },

    // HCI: add Kenneth Jeminez, Leh Maxine Flores
    { code: 'HCI', inst: 'Kenneth Jeminez' },
    { code: 'HCI', inst: 'Leh Maxine Flores' },
  ];

  console.log(`Checking ${additions.length} qualification balancing entries...`);

  for (const item of additions) {
    const sId = subMap.get(item.code);
    const iId = instMap.get(item.inst);
    if (!sId || !iId) {
      console.warn(`Could not find subject ${item.code} or instructor ${item.inst}`);
      continue;
    }

    const { data: existing } = await supabase
      .from('instructor_qualifications')
      .select('id')
      .eq('subject_id', sId)
      .eq('instructor_id', iId)
      .maybeSingle();

    if (!existing) {
      const { error } = await supabase.from('instructor_qualifications').insert({
        subject_id: sId,
        instructor_id: iId,
      });
      if (error) {
        console.error(`Failed to qualify ${item.inst} for ${item.code}:`, error.message);
      } else {
        console.log(`Qualified ${item.inst} for ${item.code}`);
      }
    } else {
      console.log(`Already qualified: ${item.inst} -> ${item.code}`);
    }
  }

  console.log('Faculty qualification balancing complete!');
}

balanceQualifications();
