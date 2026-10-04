// src/lib/export/export-excel.ts
import ExcelJS from 'exceljs';
import type { ScheduleVersion, AcademicTerm } from '../../types/database.ts';

export interface ScheduleExportItem {
  id: string;
  blockName: string;
  dayOfWeek: number;
  dayName: string;
  startTime: string;
  endTime: string;
  subjectCode: string;
  subjectTitle: string;
  sessionType: string;
  instructorName: string;
  roomName: string;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function formatDayName(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek] || `Day ${dayOfWeek}`;
}

export async function generateScheduleExcel(
  term: AcademicTerm,
  version: ScheduleVersion,
  items: ScheduleExportItem[],
  blockFilterName?: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AlterSched Timetable System';
  workbook.created = new Date();

  const titlePrefix = blockFilterName ? `${blockFilterName} Schedule` : 'Complete Academic Schedule';
  const worksheet = workbook.addWorksheet(blockFilterName ? blockFilterName.slice(0, 31) : 'Schedule');

  // Title Block
  worksheet.mergeCells('A1:I1');
  const titleRow = worksheet.getCell('A1');
  titleRow.value = `AlterSched — ${titlePrefix}`;
  titleRow.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  titleRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' }, // Slate 800
  };
  titleRow.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(1).height = 36;

  // Metadata Subtitle
  worksheet.mergeCells('A2:I2');
  const subRow = worksheet.getCell('A2');
  subRow.value = `School Year: ${term.school_year} (${term.semester})  |  Version: v${version.version_number} (${version.status.toUpperCase()})  |  Exported: ${new Date().toLocaleDateString()}`;
  subRow.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FFCBD5E1' } };
  subRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF334155' }, // Slate 700
  };
  subRow.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(2).height = 22;

  // Blank row separator
  worksheet.getRow(3).height = 10;

  // Table Headers
  const headers = [
    { key: 'blockName', header: 'Block', width: 16 },
    { key: 'dayName', header: 'Day', width: 14 },
    { key: 'timeRange', header: 'Time Slot', width: 18 },
    { key: 'subjectCode', header: 'Code', width: 14 },
    { key: 'subjectTitle', header: 'Subject Title', width: 34 },
    { key: 'sessionType', header: 'Type', width: 14 },
    { key: 'instructorName', header: 'Instructor', width: 26 },
    { key: 'roomName', header: 'Room', width: 18 },
  ];

  const headerRow = worksheet.getRow(4);
  headerRow.height = 26;

  headers.forEach((h, colIndex) => {
    const cell = headerRow.getCell(colIndex + 1);
    cell.value = h.header;
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4338CA' }, // Indigo 700
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF312E81' } },
      bottom: { style: 'medium', color: { argb: 'FF312E81' } },
      left: { style: 'thin', color: { argb: 'FF312E81' } },
      right: { style: 'thin', color: { argb: 'FF312E81' } },
    };
  });

  // Sort items: Block -> Day of Week -> Start Time
  const sortedItems = [...items].sort((a, b) => {
    if (a.blockName !== b.blockName) return a.blockName.localeCompare(b.blockName);
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    return a.startTime.localeCompare(b.startTime);
  });

  // Data Rows
  let currentRowIndex = 5;
  for (const item of sortedItems) {
    const row = worksheet.getRow(currentRowIndex);
    row.height = 22;

    const rowData = [
      item.blockName,
      item.dayName,
      `${item.startTime} - ${item.endTime}`,
      item.subjectCode,
      item.subjectTitle,
      item.sessionType.toUpperCase(),
      item.instructorName,
      item.roomName,
    ];

    rowData.forEach((val, colIndex) => {
      const cell = row.getCell(colIndex + 1);
      cell.value = val;
      cell.font = { name: 'Calibri', size: 10 };
      cell.alignment = {
        horizontal: colIndex === 4 || colIndex === 6 ? 'left' : 'center',
        vertical: 'middle',
      };

      // Subtle alternate striping
      if (currentRowIndex % 2 === 0) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8FAFC' },
        };
      }

      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
    });

    currentRowIndex++;
  }

  // Adjust Column Widths
  headers.forEach((h, colIndex) => {
    worksheet.getColumn(colIndex + 1).width = h.width;
  });

  // Generate binary buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
