import prisma from '../../../lib/prisma';
import { Prisma } from '@prisma/client';

export class StudentAccountRepository {
  findByMatric(matricNumber: string) {
    return prisma.studentAccount.findUnique({ where: { matricNumber } });
  }

  findById(id: string) {
    return prisma.studentAccount.findUnique({ where: { id } });
  }

  findByEmail(email: string) {
    return prisma.studentAccount.findUnique({ where: { email } });
  }

  findRosterRecord(matricNumber: string) {
    return prisma.studentRoster.findUnique({ where: { matricNumber }, select: { fullName: true } });
  }

  findRegistrationOtp(matricNumber: string) {
    return prisma.studentRegistrationOtp.findUnique({ where: { matricNumber } });
  }

  saveRegistrationOtp(data: { matricNumber: string; email: string; codeHash: string; expiresAt: Date }) {
    return prisma.studentRegistrationOtp.upsert({
      where: { matricNumber: data.matricNumber },
      create: data,
      update: { email: data.email, codeHash: data.codeHash, expiresAt: data.expiresAt, attempts: 0, lastSentAt: new Date() },
    });
  }

  incrementOtpAttempts(matricNumber: string) {
    return prisma.studentRegistrationOtp.update({ where: { matricNumber }, data: { attempts: { increment: 1 } } });
  }

  deleteRegistrationOtp(matricNumber: string) {
    return prisma.studentRegistrationOtp.deleteMany({ where: { matricNumber } });
  }

  createVerifiedAccount(data: { matricNumber: string; email: string; fullName: string; passwordHash: string }) {
    return prisma.$transaction(async (tx) => {
      const account = await tx.studentAccount.create({ data });
      await tx.studentRegistrationOtp.deleteMany({ where: { matricNumber: data.matricNumber } });
      return account;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

export const studentAccountRepository = new StudentAccountRepository();
