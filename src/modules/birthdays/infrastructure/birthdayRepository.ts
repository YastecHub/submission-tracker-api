import { Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';
import type { MonthDay } from '../domain/birthdayRules';

export interface BirthdayInput {
  month: number;
  day: number;
  preferredName: string | null;
  shareWithClass: boolean;
  photoUrl?: string | null;
  photoPublicId?: string | null;
}

const STUDENT = { select: { id: true, fullName: true, matricNumber: true, email: true } } as const;

/** Data access for birthdays. */
export class BirthdayRepository {
  findForStudent(studentId: string) {
    return prisma.studentBirthday.findUnique({ where: { studentId } });
  }

  upsert(studentId: string, data: BirthdayInput) {
    return prisma.studentBirthday.upsert({ where: { studentId }, create: { studentId, ...data }, update: data });
  }

  /** Birthdays on any of these dates, with the student (suspended accounts left out). */
  onDates(dates: MonthDay[]) {
    return prisma.studentBirthday.findMany({
      where: { OR: dates.map((date) => ({ month: date.month, day: date.day })), student: { suspendedAt: null } },
      include: { student: STUDENT },
    });
  }

  /** Every answer, in calendar order, for the staff page and the export. */
  all() {
    return prisma.studentBirthday.findMany({ include: { student: STUDENT }, orderBy: [{ month: 'asc' }, { day: 'asc' }] });
  }

  /** Students with an account who haven't filled in the form. */
  studentsWithoutBirthday() {
    return prisma.studentAccount.findMany({
      where: { birthday: null, suspendedAt: null },
      select: { fullName: true, matricNumber: true },
      orderBy: { fullName: 'asc' },
    });
  }

  countStudents() {
    return prisma.studentAccount.count({ where: { suspendedAt: null } });
  }

  /** Records a celebration; false if it was already sent this year (unique key, so safe with restarts). */
  async claimCelebration(studentId: string, year: number, kind: string): Promise<boolean> {
    try {
      await prisma.birthdayCelebration.create({ data: { studentId, year, kind } });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
      throw error;
    }
  }

  /** Push subscriptions of everyone except these students (classmates of the birthday person). */
  async classmateSubscriptions(excludeStudentIds: string[]) {
    const rows = await prisma.studentPushSubscription.findMany({
      where: { studentId: { notIn: excludeStudentIds }, student: { suspendedAt: null } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async studentSubscriptions(studentId: string) {
    const rows = await prisma.studentPushSubscription.findMany({ where: { studentId }, select: { id: true } });
    return rows.map((row) => row.id);
  }

  async enqueuePush(subscriptionIds: string[], message: { title: string; body: string; url: string; tag: string }) {
    if (!subscriptionIds.length) return 0;
    const payload = { ...message, priority: 'important' } as unknown as Prisma.InputJsonValue;
    const result = await prisma.notificationOutbox.createMany({ data: subscriptionIds.map((subscriptionId) => ({ subscriptionId, payload })) });
    return result.count;
  }
}

export const birthdayRepository = new BirthdayRepository();
