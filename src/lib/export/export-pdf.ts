// src/lib/export/export-pdf.ts
import PDFDocument from 'pdfkit';
import type { ScheduleVersion, AcademicTerm } from '../../types/database.ts';
import type { ScheduleExportItem } from './export-excel.ts';

export async function generateSchedulePdf(
  term: AcademicTerm,
  version: ScheduleVersion,
  items: ScheduleExportItem[],
  blockFilterName?: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        layout: 'landscape',
        size: 'A4',
        margin: 36,
        info: {
          Title: `AlterSched Schedule - ${term.school_year}`,
          Author: 'AlterSched Timetable System',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      const titlePrefix = blockFilterName ? `${blockFilterName} Timetable` : 'Master Academic Schedule';

      // 1. Header Banner
      doc.rect(36, 36, 769.89, 50).fill('#1e293b'); // Slate 800

      doc.fillColor('#ffffff').fontSize(16).font('Helvetica-Bold');
      doc.text(`AlterSched — ${titlePrefix}`, 50, 48);

      doc.fillColor('#cbd5e1').fontSize(9).font('Helvetica');
      doc.text(
        `Academic Term: ${term.school_year} (${term.semester})   |   Version: v${version.version_number} [${version.status.toUpperCase()}]   |   Generated: ${new Date().toLocaleDateString()}`,
        50,
        68
      );

      // 2. Table Column Dimensions
      const startX = 36;
      let currentY = 100;
      const rowHeight = 22;

      const columns = [
        { label: 'Block', width: 80, x: startX },
        { label: 'Day', width: 75, x: startX + 80 },
        { label: 'Time', width: 95, x: startX + 155 },
        { label: 'Code', width: 75, x: startX + 250 },
        { label: 'Subject Title', width: 175, x: startX + 325 },
        { label: 'Type', width: 65, x: startX + 500 },
        { label: 'Instructor', width: 125, x: startX + 565 },
        { label: 'Room', width: 79.89, x: startX + 690 },
      ];

      // Helper function to draw table header
      const drawTableHeader = (y: number) => {
        doc.rect(startX, y, 769.89, rowHeight).fill('#4338ca'); // Indigo 700
        doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold');

        columns.forEach((col) => {
          doc.text(col.label, col.x + 4, y + 6, {
            width: col.width - 8,
            align: 'left',
          });
        });
      };

      drawTableHeader(currentY);
      currentY += rowHeight;

      // 3. Sort Items
      const sortedItems = [...items].sort((a, b) => {
        if (a.blockName !== b.blockName) return a.blockName.localeCompare(b.blockName);
        if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
        return a.startTime.localeCompare(b.startTime);
      });

      // 4. Draw Rows
      let rowIndex = 0;
      for (const item of sortedItems) {
        // Page break if reaching bottom margin (A4 landscape height = 595.28)
        if (currentY + rowHeight > 540) {
          doc.addPage({ layout: 'landscape', size: 'A4', margin: 36 });
          currentY = 40;
          drawTableHeader(currentY);
          currentY += rowHeight;
        }

        // Alternating row background
        if (rowIndex % 2 === 0) {
          doc.rect(startX, currentY, 769.89, rowHeight).fill('#f8fafc');
        } else {
          doc.rect(startX, currentY, 769.89, rowHeight).fill('#ffffff');
        }

        // Row outline border
        doc.rect(startX, currentY, 769.89, rowHeight).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

        doc.fillColor('#1e293b').fontSize(8.5).font('Helvetica');

        const rowValues = [
          item.blockName,
          item.dayName,
          `${item.startTime} - ${item.endTime}`,
          item.subjectCode,
          item.subjectTitle,
          item.sessionType.toUpperCase(),
          item.instructorName,
          item.roomName,
        ];

        columns.forEach((col, idx) => {
          doc.text(rowValues[idx], col.x + 4, currentY + 6, {
            width: col.width - 8,
            align: 'left',
            lineBreak: false,
            ellipsis: true,
          });
        });

        currentY += rowHeight;
        rowIndex++;
      }

      // 5. Finalize document
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
