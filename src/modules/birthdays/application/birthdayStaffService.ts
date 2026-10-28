import * as XLSX from 'xlsx';
import { daysUntil, displayName, formatBirthday, lagosToday } from '../domain/birthdayRules';
import { birthdayRepository, type BirthdayRepository } from '../infrastructure/birthdayRepository';

type Store = Pick<BirthdayRepository, 'all' | 'studentsWithoutBirthday' | 'countStudents'>;

function lagosDateTime(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** Birthdays for the developer and class reps: who answered, what's coming up, and the export for the media team. */
export class BirthdayStaffService {
  constructor(private readonly store: Store = birthdayRepository) {}

  async overview(now: Date = new Date()) {
    const today = lagosToday(now);
    const [entries, missing, students] = await Promise.all([this.store.all(), this.store.studentsWithoutBirthday(), this.store.countStudents()]);
    const rows = entries.map((entry) => ({
      fullName: entry.student.fullName,
      preferredName: entry.preferredName,
      displayName: displayName(entry.student.fullName, entry.preferredName),
      matricNumber: entry.student.matricNumber,
      email: entry.student.email,
      month: entry.month,
      day: entry.day,
      birthday: formatBirthday(entry),
      daysUntil: daysUntil(entry, today),
      shareWithClass: entry.shareWithClass,
      photoUrl: entry.photoUrl,
      submittedAt: entry.updatedAt,
    }));
    return {
      counts: { answered: rows.length, students },
      upcoming: rows.filter((row) => row.daysUntil <= 7).sort((a, b) => a.daysUntil - b.daysUntil),
      rows,
      notAnswered: missing,
    };
  }

  async export(now: Date = new Date()) {
    const { rows } = await this.overview(now);
    const header = ['S/N', 'Full name', 'Preferred name', 'Matric number', 'Email', 'Birthday', 'Month', 'Day', 'Tell classmates', 'Photo', 'Filled in'];
    const data = rows.map((row, index) => [
      index + 1,
      row.fullName,
      row.preferredName ?? '',
      row.matricNumber.startsWith('JUPEB-') ? 'JUPEB' : row.matricNumber,
      row.email,
      row.birthday,
      row.month,
      row.day,
      row.shareWithClass ? 'Yes' : 'No',
      row.photoUrl ?? 'No photo: ask on the day',
      lagosDateTime(row.submittedAt),
    ]);
    const sheet = XLSX.utils.aoa_to_sheet([header, ...data]);
    sheet['!cols'] = [{ wch: 5 }, { wch: 32 }, { wch: 16 }, { wch: 14 }, { wch: 30 }, { wch: 14 }, { wch: 6 }, { wch: 5 }, { wch: 15 }, { wch: 60 }, { wch: 20 }];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Birthdays');
    const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return { buffer, filename: `nexium-birthdays-${today(now)}.xlsx` };
  }
}

function today(now: Date): string {
  const { year, month, day } = lagosToday(now);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export const birthdayStaffService = new BirthdayStaffService();
