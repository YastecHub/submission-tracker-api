/**
 * Birthday rules: day and month only, Lagos time, and 29 February celebrated on
 * 28 February in years that don't have one.
 */
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Days per month, counting 29 for February so leap-day birthdays can be saved. */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const MAX_PREFERRED_NAME = 40;

/** Email goes out at 7 am, classmates are told at 8 am (Lagos time). */
export const EMAIL_HOUR = 7;
export const CLASSMATES_HOUR = 8;

export interface MonthDay {
  month: number;
  day: number;
}

export interface LagosToday extends MonthDay {
  year: number;
  hour: number;
}

export function birthdayProblem(month: unknown, day: unknown): string | null {
  if (!Number.isInteger(month) || (month as number) < 1 || (month as number) > 12) return 'Choose your birth month.';
  if (!Number.isInteger(day) || (day as number) < 1) return 'Choose your birth day.';
  if ((day as number) > DAYS_IN_MONTH[(month as number) - 1]) return `${MONTH_NAMES[(month as number) - 1]} only has ${DAYS_IN_MONTH[(month as number) - 1]} days.`;
  return null;
}

export function formatBirthday({ month, day }: MonthDay): string {
  return `${day} ${MONTH_NAMES[month - 1]}`;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Today's date and hour in Lagos. */
export function lagosToday(now: Date = new Date()): LagosToday {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) };
}

/** The birthdays celebrated on this date: the date itself, plus 29 February on 28 February in non-leap years. */
export function birthdaysCelebratedOn(today: { year: number; month: number; day: number }): MonthDay[] {
  const dates: MonthDay[] = [{ month: today.month, day: today.day }];
  if (today.month === 2 && today.day === 28 && !isLeapYear(today.year)) dates.push({ month: 2, day: 29 });
  return dates;
}

export function isBirthdayToday(birthday: MonthDay, today: { year: number; month: number; day: number }): boolean {
  return birthdaysCelebratedOn(today).some((date) => date.month === birthday.month && date.day === birthday.day);
}

/** Days from today until the next celebration (0 = today). */
export function daysUntil(birthday: MonthDay, today: { year: number; month: number; day: number }): number {
  const start = Date.UTC(today.year, today.month - 1, today.day);
  for (const year of [today.year, today.year + 1]) {
    const day = birthday.month === 2 && birthday.day === 29 && !isLeapYear(year) ? 28 : birthday.day;
    const next = Date.UTC(year, birthday.month - 1, day);
    if (next >= start) return Math.round((next - start) / 86_400_000);
  }
  return 365;
}

/** The first name to greet someone by: their preferred name, else the first word of their name. */
export function greetingName(fullName: string, preferredName: string | null): string {
  if (preferredName?.trim()) return preferredName.trim();
  // Names on the class list are "SURNAME, Firstname Middle": greet by the first name.
  const afterComma = fullName.includes(',') ? fullName.split(',')[1] : fullName;
  return afterComma.trim().split(/\s+/)[0] || fullName.trim();
}

function titleCase(word: string): string {
  return word.toLowerCase().replace(/(^|[-'\s])(\p{L})/gu, (_match, separator: string, letter: string) => separator + letter.toUpperCase());
}

/** How classmates see the name: the preferred name, else "Firstname Surname" from "SURNAME, Firstname Middle". */
export function displayName(fullName: string, preferredName: string | null): string {
  if (preferredName?.trim()) return preferredName.trim();
  if (!fullName.includes(',')) return fullName.trim();
  const [surname, rest] = fullName.split(',', 2);
  const first = rest.trim().split(/\s+/)[0];
  return [first, titleCase(surname.trim())].filter(Boolean).join(' ');
}
