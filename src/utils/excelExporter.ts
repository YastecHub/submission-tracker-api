import * as XLSX from 'xlsx';
import type { PaymentEvent, PaymentReceipt, Submission, SubmissionEvent } from '@prisma/client';
import { format } from './dateFormat';

export function exportSubmissions(
  submissions: Submission[],
  event: SubmissionEvent
): { buffer: Buffer; filename: string } {
  const wb = XLSX.utils.book_new();

  const headers = [
    'S/N',
    'Full Name',
    'Matric Number',
    'Level',
    'Submitted At',
    'Confirmed At',
    'Confirmed By',
  ];

  const rows = submissions.map((s, i) => [
    i + 1,
    s.fullName,
    s.matricNumber,
    s.level ?? '',
    format(s.submittedAt),
    s.confirmedAt ? format(s.confirmedAt) : '',
    s.confirmedBy ?? '',
  ]);

  const wsData = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  ws['!cols'] = [
    { wch: 6 },  // S/N
    { wch: 30 }, // Full Name
    { wch: 18 }, // Matric Number
    { wch: 12 }, // Level
    { wch: 22 }, // Submitted At
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

  XLSX.utils.book_append_sheet(wb, ws, 'Confirmed Submissions');

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

export function exportPaymentReceipts(
  receipts: PaymentReceipt[],
  event: PaymentEvent
): { buffer: Buffer; filename: string } {
  const wb = XLSX.utils.book_new();

  const headers = [
    'S/N',
    'Full Name',
    'Matric Number',
    'Level',
    'Expected Amount',
    'AI Extracted Amount',
    'Amount Check',
    'Amount Check Note',
    'Status',
    'Submitted At',
    'Reviewed At',
    'Reviewed By',
    'Note',
    'Collected',
    'Collected At',
    'Collected By',
  ];

  const rows = receipts.map((r, i) => [
    i + 1,
    r.fullName,
    r.matricNumber,
    r.level ?? '',
    event.amount.toString(),
    r.extractedAmount?.toString() ?? '',
    r.amountCheckStatus,
    r.amountCheckNote ?? '',
    r.status,
    format(r.submittedAt),
    r.confirmedAt ? format(r.confirmedAt) : '',
    r.confirmedBy ?? '',
    r.note ?? '',
    r.isClaimed ? 'Yes' : 'No',
    r.claimedAt ? format(r.claimedAt) : '',
    r.claimedBy ?? '',
  ]);

  const wsData = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  ws['!cols'] = [
    { wch: 6 },
    { wch: 30 },
    { wch: 18 },
    { wch: 12 },
    { wch: 14 },
    { wch: 18 },
    { wch: 18 },
    { wch: 36 },
    { wch: 14 },
    { wch: 22 },
    { wch: 22 },
    { wch: 25 },
    { wch: 30 },
    { wch: 12 },
    { wch: 22 },
    { wch: 25 },
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

  XLSX.utils.book_append_sheet(wb, ws, 'Payment Receipts');

  const date = new Date().toISOString().slice(0, 10);
  const filename = `Payments_${event.title}_${date}.xlsx`.replace(
    /[^a-zA-Z0-9_\-.]/g,
    '_'
  );

  return {
    buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true }) as Buffer,
    filename,
  };
}
