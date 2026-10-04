// src/lib/academic/year-levels.ts
import fs from 'fs/promises';
import path from 'path';

export interface YearLevelGroup {
  id: string;
  deptCode: string;
  deptName: string;
  yearLevelNum: number;
  title: string;
  subTitle: string;
  targetSubjectsYearLevel: string;
  isHighSchool: boolean;
}

export interface YearLevelInput {
  deptCode: string;
  deptName: string;
  yearLevelNum: number;
  title: string;
  subTitle?: string;
  targetSubjectsYearLevel?: string;
}

const DATA_FILE = path.join(process.cwd(), 'src', 'data', 'year-levels.json');

const DEFAULT_CONFIGS: YearLevelGroup[] = [
  {
    id: 'bsit-1',
    deptCode: 'BSIT',
    deptName: 'Bachelor of Science in Information Technology',
    yearLevelNum: 1,
    title: '1st Year Level',
    subTitle: 'Freshman computing fundamentals, introduction to IT, and general education subjects',
    targetSubjectsYearLevel: '1st Year',
    isHighSchool: false,
  },
  {
    id: 'bsit-2',
    deptCode: 'BSIT',
    deptName: 'Bachelor of Science in Information Technology',
    yearLevelNum: 2,
    title: '2nd Year Level',
    subTitle: 'Sophomore core courses: Data structures, OOP, web systems, and discrete math',
    targetSubjectsYearLevel: '2nd Year',
    isHighSchool: false,
  },
  {
    id: 'bsit-3',
    deptCode: 'BSIT',
    deptName: 'Bachelor of Science in Information Technology',
    yearLevelNum: 3,
    title: '3rd Year Level',
    subTitle: 'Junior advanced courses: Database administration, networking, info assurance & security',
    targetSubjectsYearLevel: '3rd Year',
    isHighSchool: false,
  },
  {
    id: 'bsit-4',
    deptCode: 'BSIT',
    deptName: 'Bachelor of Science in Information Technology',
    yearLevelNum: 4,
    title: '4th Year Level',
    subTitle: 'Senior capstone research, systems administration, and industry internship practicum',
    targetSubjectsYearLevel: '4th Year',
    isHighSchool: false,
  },
  {
    id: 'hs-11',
    deptCode: 'HS',
    deptName: 'High School Department',
    yearLevelNum: 3,
    title: 'Grade 11 - STEM & TVL',
    subTitle: 'Senior High School Grade 11 specialized academic tracks (Pre-Calculus & TVL-ICT)',
    targetSubjectsYearLevel: 'Grade 11 (SHS)',
    isHighSchool: true,
  },
  {
    id: 'hs-12',
    deptCode: 'HS',
    deptName: 'High School Department',
    yearLevelNum: 4,
    title: 'Grade 12 - STEM & TVL',
    subTitle: 'Senior High School Grade 12 graduating projects and computer systems servicing NC II',
    targetSubjectsYearLevel: 'Grade 12 (SHS)',
    isHighSchool: true,
  },
];

export async function getYearLevelConfigs(): Promise<YearLevelGroup[]> {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {
    // If file doesn't exist yet, return defaults
  }
  return DEFAULT_CONFIGS;
}

export async function saveYearLevelConfig(input: YearLevelInput): Promise<YearLevelGroup> {
  const current = await getYearLevelConfigs();
  const isHighSchool =
    input.deptCode.toUpperCase() === 'HS' ||
    input.deptName.toLowerCase().includes('high school');

  const existingIndex = current.findIndex(
    (c) =>
      c.deptCode.toUpperCase() === input.deptCode.toUpperCase() &&
      c.yearLevelNum === input.yearLevelNum
  );

  const entry: YearLevelGroup = {
    id: existingIndex >= 0 ? current[existingIndex].id : `${input.deptCode.toLowerCase()}-${input.yearLevelNum}-${Date.now()}`,
    deptCode: input.deptCode.toUpperCase(),
    deptName: input.deptName,
    yearLevelNum: input.yearLevelNum,
    title: input.title,
    subTitle: input.subTitle || `${input.title} academic curriculum and student blocks`,
    targetSubjectsYearLevel: input.targetSubjectsYearLevel || input.title,
    isHighSchool,
  };

  if (existingIndex >= 0) {
    current[existingIndex] = entry;
  } else {
    current.push(entry);
  }

  // Sort by dept and year level
  current.sort((a, b) => {
    if (a.deptCode !== b.deptCode) return a.deptCode.localeCompare(b.deptCode);
    return a.yearLevelNum - b.yearLevelNum;
  });

  await fs.writeFile(DATA_FILE, JSON.stringify(current, null, 2), 'utf-8');
  return entry;
}

export async function deleteYearLevelConfig(id: string): Promise<void> {
  const current = await getYearLevelConfigs();
  const filtered = current.filter((c) => c.id !== id);
  await fs.writeFile(DATA_FILE, JSON.stringify(filtered, null, 2), 'utf-8');
}
