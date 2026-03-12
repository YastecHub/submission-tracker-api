import * as XLSX from 'xlsx';
import type { Submission, SubmissionEvent } from '@prisma/client';
import { format } from './dateFormat';

export function exportSubmissions(
  submissions: Submission[],
  event: SubmissionEvent
): { buffer: Buffer; filename: string } {
  const wb = XLSX.utils.book_new();

  const headers = [
    'Full Name',
    'Matric Number',
    'Level',
    'Submitted At',
    'Confirmed',
    'Confirmed At',
    'Confirmed By',
  ];

  const rows = submissions.map((s) => [
    s.fullName,
    s.matricNumber,
    s.level ?? '',
    format(s.submittedAt),
    s.isConfirmed ? 'Yes' : 'No',
    s.confirmedAt ? format(s.confirmedAt) : '',
    s.confirmedBy ?? '',
  ]);

  const wsData = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  ws['!cols'] = [
    { wch: 30 }, // Full Name
    { wch: 18 }, // Matric Number
    { wch: 12 }, // Level
    { wch: 22 }, // Submitted At
    { wch: 12 }, // Confirmed
    { wch: 22 }, // Confirmed At
    { wch: 25 }, // Confirmed By
  ];

  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cellAddr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[cellAddr]) continue;
      ws[cellAddr].s = {
        font: R === 0 ? { bold: true } : {},
        border: {
          top: { style: 'thin' },
          bottom: { style: 'thin' },
          left: { style: 'thin' },
          right: { style: 'thin' },
        },
        alignment: { vertical: 'center' },
      };
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, 'Submissions');

  const date = new Date().toISOString().slice(0, 10);
  const filename = `${event.courseCode}_${event.title}_${date}.xlsx`.replace(
    /[^a-zA-Z0-9_\-.]/g,
    '_'
  );

  return {
    buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true }) as Buffer,
    filename,
  };
}
