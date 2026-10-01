import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AppError, badRequest, notFound } from '../../../shared/errors/AppError';
import logger from '../../../lib/logger';
import { sendStudentRegistrationOtp } from '../../../utils/mailer';
import { studentAccountRepository, StudentAccountRepository } from '../infrastructure/studentAccountRepository';

const OTP_LIFETIME_MS = 10 * 60_000;
const OTP_RESEND_COOLDOWN_MS = 60_000;
const MAX_OTP_ATTEMPTS = 5;

function safeStudent(student: { id: string; matricNumber: string; email: string; fullName: string }) {
  return { id: student.id, matricNumber: student.matricNumber, email: student.email, fullName: student.fullName };
}

function issueToken(student: { id: string; matricNumber: string; email: string; fullName: string }) {
  return jwt.sign(
    { scope: 'student', id: student.id, matricNumber: student.matricNumber, email: student.email, fullName: student.fullName },
    process.env.JWT_SECRET!,
    { expiresIn: '7d' },
  );
}

function normalizeMatric(value?: string): string {
  return value?.trim().toUpperCase() ?? '';
}

function normalizeEmail(value?: string): string {
  return value?.trim().toLowerCase() ?? '';
}

function validatePassword(password?: string): asserts password is string {
  if (!password || password.length < 8 || password.length > 128) {
    throw badRequest('Password must be between 8 and 128 characters');
  }
}

export class StudentAuthService {
  constructor(private readonly students: StudentAccountRepository) {}

  async requestRegistrationOtp(input: { matricNumber?: string; email?: string }) {
    const matricNumber = normalizeMatric(input.matricNumber);
    const email = normalizeEmail(input.email);
    if (!matricNumber || matricNumber.length > 50) throw badRequest('Enter a valid matric number');
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) throw badRequest('Enter a valid email address');
    if (await this.students.findByMatric(matricNumber)) throw new AppError(409, 'A student account already exists for this matric number');
    if (await this.students.findByEmail(email)) throw new AppError(409, 'This email is already linked to a student account');

    const record = await this.students.findRosterRecord(matricNumber);
    if (!record) throw notFound('Matric number was not found in class records');

    const existing = await this.students.findRegistrationOtp(matricNumber);
    if (existing && Date.now() - existing.lastSentAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      throw new AppError(429, 'Please wait before requesting another code');
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.students.saveRegistrationOtp({
      matricNumber,
      email,
      codeHash: await bcrypt.hash(code, 10),
      expiresAt: new Date(Date.now() + OTP_LIFETIME_MS),
    });
    try {
      await sendStudentRegistrationOtp(record.fullName, email, code);
    } catch (error) {
      await this.students.deleteRegistrationOtp(matricNumber);
      logger.error('[student registration email] Failed to send OTP:', { error, email, matricNumber });
      throw new AppError(503, 'We could not send the verification email. Please try again later.');
    }
    return { message: 'Verification code sent', expiresInSeconds: OTP_LIFETIME_MS / 1000 };
  }

  async completeRegistration(input: { matricNumber?: string; email?: string; code?: string; password?: string }) {
    const matricNumber = normalizeMatric(input.matricNumber);
    const email = normalizeEmail(input.email);
    const code = input.code?.trim() ?? '';
    validatePassword(input.password);
    if (!matricNumber || !email || !/^\d{6}$/.test(code)) throw badRequest('Matric number, email, and a 6-digit code are required');

    const challenge = await this.students.findRegistrationOtp(matricNumber);
    if (!challenge || challenge.email !== email) throw badRequest('The verification code is invalid or expired');
    if (challenge.expiresAt.getTime() <= Date.now() || challenge.attempts >= MAX_OTP_ATTEMPTS) {
      await this.students.deleteRegistrationOtp(matricNumber);
      throw badRequest('The verification code is invalid or expired');
    }
    if (!(await bcrypt.compare(code, challenge.codeHash))) {
      await this.students.incrementOtpAttempts(matricNumber);
      throw badRequest('The verification code is invalid or expired');
    }

    const record = await this.students.findRosterRecord(matricNumber);
    if (!record) throw notFound('Matric number was not found in class records');
    try {
      const student = await this.students.createVerifiedAccount({
        matricNumber,
        email,
        fullName: record.fullName,
        passwordHash: await bcrypt.hash(input.password, 10),
      });
      return { token: issueToken(student), student: safeStudent(student) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(409, 'A student account already exists for these details');
      }
      throw error;
    }
  }

  async login(input: { matricNumber?: string; password?: string }) {
    const matricNumber = normalizeMatric(input.matricNumber);
    if (!matricNumber || !input.password) throw badRequest('Matric number and password are required');
    const student = await this.students.findByMatric(matricNumber);
    if (!student || !(await bcrypt.compare(input.password, student.passwordHash))) throw new AppError(401, 'Invalid matric number or password');
    return { token: issueToken(student), student: safeStudent(student) };
  }

  async me(id: string) {
    const student = await this.students.findById(id);
    if (!student) throw notFound('Student account not found');
    return safeStudent(student);
  }
}

export const studentAuthService = new StudentAuthService(studentAccountRepository);
