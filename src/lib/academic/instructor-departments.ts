// src/lib/academic/instructor-departments.ts
// Helper utility to read and write instructor departments with local JSON caching and DB fallback.

import fs from 'fs';
import path from 'path';

export type InstructorDepartmentType = 'BSIT' | 'High School' | 'Both';

const CONFIG_PATH = path.join(process.cwd(), 'src', 'data', 'instructor-departments.json');

function readInstructorDepartmentsConfig(): Record<string, InstructorDepartmentType> {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Failed to read instructor-departments.json config:', err);
  }
  return {};
}

function writeInstructorDepartmentsConfig(data: Record<string, InstructorDepartmentType>) {
  try {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write instructor-departments.json config:', err);
  }
}

/**
 * Returns the assigned department for an instructor.
 * Falls back to row value, local JSON config, or 'BSIT' by default.
 */
export function getInstructorDepartment(
  instructorId: string,
  rowDepartment?: string | null,
  profileDepartment?: string | null
): InstructorDepartmentType {
  if (
    rowDepartment === 'BSIT' ||
    rowDepartment === 'High School' ||
    rowDepartment === 'Both'
  ) {
    return rowDepartment as InstructorDepartmentType;
  }

  const config = readInstructorDepartmentsConfig();
  if (config[instructorId]) {
    return config[instructorId];
  }

  if (profileDepartment === 'BSIT' || profileDepartment === 'High School') {
    return profileDepartment as InstructorDepartmentType;
  }

  return 'BSIT';
}

/**
 * Persists an instructor's department to the local JSON configuration file.
 */
export function saveInstructorDepartmentToConfig(
  instructorId: string,
  department: InstructorDepartmentType
) {
  const config = readInstructorDepartmentsConfig();
  config[instructorId] = department;
  writeInstructorDepartmentsConfig(config);
}
