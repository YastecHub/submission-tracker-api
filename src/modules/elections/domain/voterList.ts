import { createHash } from 'node:crypto';
import { parseCsv } from '../../gpa/domain/csv';
import { normalizeMatric } from './electionRules';

export interface VoterRow {
  matricNumber: string;
  fullName: string;
  email: string | null;
  /** True when the student has no matric number and signs up with the seeded email. */
  emailOnly: boolean;
}

export const MAX_VOTERS = 2000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MATRIC_PATTERN = /^[A-Z0-9/-]{4,30}$/;

const HEADER_ALIASES: Record<string, 'matric' | 'name' | 'email'> = {
  matric: 'matric', matricnumber: 'matric', matricno: 'matric', 'matric no': 'matric', 'matric number': 'matric', regno: 'matric',
  name: 'name', fullname: 'name', 'full name': 'name', 'candidate full name': 'name', student: 'name',
  email: 'email', mail: 'email', 'email address': 'email',
};

/**
 * Students without a matric number (e.g. JUPEB) get a stable ID from their seeded email,
 * so re-uploading the list never creates duplicates. They never need to type it.
 */
export function emailOnlyId(email: string): string {
  return `JUPEB-${createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 6).toUpperCase()}`;
}

/**
 * Reads the voter list (CSV: matric number, full name, optional email). Returns every
 * problem found so the developer can fix the file in one go.
 */
export function readVoterList(text: string): { rows: VoterRow[]; errors: string[] } {
  const rows: VoterRow[] = [];
  const errors: string[] = [];
  const seenMatric = new Map<string, number>();
  const seenEmail = new Map<string, number>();
  let columns: { matric: number; name: number; email: number } | null = null;

  for (const record of parseCsv(text)) {
    if (!columns) {
      const header = record.values.map((value) => HEADER_ALIASES[value.trim().toLowerCase().replace(/[_.]/g, ' ').replace(/\s+/g, ' ')]
        ?? HEADER_ALIASES[value.trim().toLowerCase().replace(/[^a-z]/g, '')]);
      columns = { matric: header.indexOf('matric'), name: header.indexOf('name'), email: header.indexOf('email') };
      if (columns.name === -1) { errors.push('The first row must be a header with at least "matricNumber" and "fullName" (and optionally "email").'); break; }
      if (columns.matric === -1 && columns.email === -1) { errors.push('The header needs a "matricNumber" column, an "email" column, or both.'); break; }
      continue;
    }
    if (rows.length >= MAX_VOTERS) { errors.push(`Only ${MAX_VOTERS} voters can be uploaded at once.`); break; }
    const cell = (index: number) => (index >= 0 ? (record.values[index] ?? '').trim() : '');
    const where = `Line ${record.line}`;
    const fullName = cell(columns.name).replace(/\s+/g, ' ');
    const email = cell(columns.email).toLowerCase() || null;
    let matricNumber = normalizeMatric(cell(columns.matric));

    if (!fullName) errors.push(`${where}: the name is missing.`);
    if (fullName.length > 120) errors.push(`${where}: the name is too long.`);
    if (email && !EMAIL_PATTERN.test(email)) errors.push(`${where}: "${email}" is not a valid email.`);
    const emailOnly = !matricNumber;
    if (emailOnly) {
      if (!email) { errors.push(`${where}: add a matric number or an email.`); continue; }
      matricNumber = emailOnlyId(email);
    } else if (!MATRIC_PATTERN.test(matricNumber)) {
      errors.push(`${where}: "${matricNumber}" doesn't look like a matric number.`);
    }
    if (seenMatric.has(matricNumber)) errors.push(`${where}: ${emailOnly ? email : matricNumber} is already on line ${seenMatric.get(matricNumber)}.`);
    seenMatric.set(matricNumber, record.line);
    if (email) {
      if (seenEmail.has(email)) errors.push(`${where}: ${email} is already on line ${seenEmail.get(email)}.`);
      seenEmail.set(email, record.line);
    }
    rows.push({ matricNumber, fullName, email, emailOnly });
  }
  if (!columns) errors.push('The file is empty.');
  else if (!rows.length && !errors.length) errors.push('The file has a header but no voters.');
  return { rows, errors };
}
