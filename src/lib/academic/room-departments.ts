import fs from 'fs';
import path from 'path';
import type { DepartmentType, Room } from '@/types/database';

let cachedMap: Record<string, DepartmentType[]> | null = null;

function getConfigPath(): string {
  return path.join(process.cwd(), 'src', 'data', 'room-departments.json');
}

export function loadRoomDepartmentsMap(): Record<string, DepartmentType[]> {
  try {
    const filePath = getConfigPath();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      cachedMap = JSON.parse(raw);
      return cachedMap || {};
    }
  } catch (err) {
    console.error('Error reading room-departments.json:', err);
  }
  return cachedMap || {};
}

/**
 * Returns the permitted departments for a room.
 * Priority:
 * 1. Explicit room.allowed_departments (if loaded from DB)
 * 2. Lookup in room-departments.json by room ID or room name
 * 3. Fallback to room.is_shared: true -> ['BSIT', 'High School'], false -> ['BSIT']
 */
export function getRoomAllowedDepartments(
  room: Partial<Room> & {
    id?: string;
    name?: string;
    is_shared?: boolean;
    allowed_departments?: DepartmentType[] | string[] | null;
  }
): DepartmentType[] {
  if (
    room.allowed_departments &&
    Array.isArray(room.allowed_departments) &&
    room.allowed_departments.length > 0
  ) {
    return room.allowed_departments as DepartmentType[];
  }

  const map = loadRoomDepartmentsMap();
  if (room.id && map[room.id]) {
    return map[room.id];
  }
  if (room.name && map[room.name]) {
    return map[room.name];
  }

  if (room.is_shared) {
    return ['BSIT', 'High School'];
  }

  return ['BSIT'];
}

/**
 * Checks whether a room is permitted to be scheduled by a given department.
 * If department is null/undefined, returns true (global access).
 */
export function isRoomAllowedForDepartment(
  room: Partial<Room> & {
    id?: string;
    name?: string;
    is_shared?: boolean;
    allowed_departments?: DepartmentType[] | string[] | null;
  },
  department?: DepartmentType | string | null
): boolean {
  if (!department) return true;
  const allowed = getRoomAllowedDepartments(room);
  return allowed.includes(department as DepartmentType);
}

/**
 * Persists room department mapping to src/data/room-departments.json
 */
export async function saveRoomDepartmentsToConfig(
  roomId: string,
  allowedDepartments: DepartmentType[],
  roomName?: string
): Promise<void> {
  try {
    const filePath = getConfigPath();
    let currentMap: Record<string, DepartmentType[]> = {};
    if (fs.existsSync(filePath)) {
      try {
        currentMap = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch {
        currentMap = {};
      }
    }
    currentMap[roomId] = allowedDepartments;
    if (roomName) {
      currentMap[roomName] = allowedDepartments;
    }
    fs.writeFileSync(filePath, JSON.stringify(currentMap, null, 2), 'utf8');
    cachedMap = currentMap;
  } catch (err) {
    console.error('Failed to write room-departments.json:', err);
  }
}

/**
 * Removes room from src/data/room-departments.json
 */
export async function removeRoomDepartmentsFromConfig(roomId: string, roomName?: string): Promise<void> {
  try {
    const filePath = getConfigPath();
    if (fs.existsSync(filePath)) {
      const currentMap: Record<string, DepartmentType[]> = JSON.parse(
        fs.readFileSync(filePath, 'utf8')
      );
      delete currentMap[roomId];
      if (roomName) {
        delete currentMap[roomName];
      }
      fs.writeFileSync(filePath, JSON.stringify(currentMap, null, 2), 'utf8');
      cachedMap = currentMap;
    }
  } catch (err) {
    console.error('Failed to remove from room-departments.json:', err);
  }
}
