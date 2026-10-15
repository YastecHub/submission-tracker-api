import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AppError, badRequest, notFound } from '../../../shared/errors/AppError';
import logger from '../../../lib/logger';
import { sendStudentPasswordResetOtp, sendStudentRegistrationOtp } from '../../../utils/mailer';
import { studentAccountRepository, StudentAccountRepository } from '../infrastructure/studentAccountRepository';
import { forgetStudentSession } from './studentSessions';
import { maskEmail } from '../../elections/domain/electionRules';

const OTP_LIFETIME_MS = 10 * 60_000;
const OTP_RESEND_COOLDOWN_MS = 60_000;
const MAX_OTP_ATTEMPTS = 5;

/** Same answer whether or not an account matched, so the form can't be used to probe accounts. */
const RESET_REQUESTED = {
  message: 'If an account matches, a reset code has been sent to the email linked to it.',
  expiresInSeconds: OTP_LIFETIME_MS / 1000,
  resendAfterSeconds: OTP_RESEND_COOLDOWN_MS / 1000,
};
const INVALID_RESET_CODE = 'The reset code is invalid or expired';

export interface StudentAuthMailer {
  sendRegistrationOtp(name: string, email: string, code: string): Promise<void>;
  sendPasswordResetOtp(name: string, email: string, code: string): Promise<void>;
}

const defaultMailer: StudentAuthMailer = {
  sendRegistrationOtp: sendStudentRegistrationOtp,
  sendPasswordResetOtp: sendStudentPasswordResetOtp,
};

function newOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

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
  constructor(
    private readonly students: StudentAccountRepository,
    private readonly mailer: StudentAuthMailer = defaultMailer,
  ) {}

  /**
   * Who is registering. With a matric number: it must be on the student list, and if the
   * list has a seeded email for it, the code goes only to that email. Without one (e.g.
   * JUPEB students): the email itself must be a seeded email on the student list.
   */
  private async resolveRegistrant(input: { matricNumber?: string; email?: string }) {
    const email = normalizeEmail(input.email);
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) throw badRequest('Enter a valid email address');
    let matricNumber = normalizeMatric(input.matricNumber);
    if (matricNumber.length > 50) throw badRequest('Enter a valid matric number');
    let record: { matricNumber: string; fullName: string; email: string | null } | null;
    if (!matricNumber) {
      record = await this.students.findRosterByEmail(email);
      if (!record) throw notFound('This email is not on the class list. Register with your matric number, or ask the electoral committee to add your email.');
      matricNumber = record.matricNumber;
    } else {
      record = await this.students.findRosterRecord(matricNumber);
      if (!record) throw notFound('Matric number was not found in class records');
      if (record.email && record.email !== email) {
        throw badRequest(`Use the email registered for this matric number (${maskEmail(record.email)}).`);
      }
    }
    return { matricNumber, email, fullName: record.fullName };
  }

  async requestRegistrationOtp(input: { matricNumber?: string; email?: string }) {
    const { matricNumber, email, fullName } = await this.resolveRegistrant(input);
    if (await this.students.findByMatric(matricNumber)) throw new AppError(409, 'You already have an account. Sign in, or use "Forgot password?".');
    if (await this.students.findByEmail(email)) throw new AppError(409, 'This email is already linked to a student account');
    const record = { fullName };

    const existing = await this.students.findRegistrationOtp(matricNumber);
    if (existing && Date.now() - existing.lastSentAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      throw new AppError(429, 'Please wait before requesting another code');
    }

    const code = newOtp();
    await this.students.saveRegistrationOtp({
      matricNumber,
      email,
      codeHash: await bcrypt.hash(code, 10),
      expiresAt: new Date(Date.now() + OTP_LIFETIME_MS),
    });
    try {
      await this.mailer.sendRegistrationOtp(record.fullName, email, code);
    } catch (error) {
      await this.students.deleteRegistrationOtp(matricNumber);
      logger.error('[student registration email] Failed to send OTP:', { error, email, matricNumber });
      throw new AppError(503, 'We could not send the verification email. Please try again later.');
    }
    return { message: 'Verification code sent', expiresInSeconds: OTP_LIFETIME_MS / 1000 };
  }

  async completeRegistration(input: { matricNumber?: string; email?: string; code?: string; password?: string }) {
    const code = input.code?.trim() ?? '';
    validatePassword(input.password);
    if (!/^\d{6}$/.test(code)) throw badRequest('Enter the 6-digit code from your email');
    const { matricNumber, email } = await this.resolveRegistrant(input);

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

  /** Sign in with the matric number or the account email. */
  async login(input: { matricNumber?: string; identifier?: string; password?: string }) {
    const identifier = (input.identifier ?? input.matricNumber ?? '').trim();
    if (!identifier || !input.password) throw badRequest('Matric number (or email) and password are required');
    const student = await this.findByIdentifier(identifier);
    if (!student || !(await bcrypt.compare(input.password, student.passwordHash))) throw new AppError(401, 'Invalid matric number or password');
    if (student.suspendedAt) throw new AppError(403, 'This account is suspended. Contact the electoral committee.');
    return { token: issueToken(student), student: safeStudent(student) };
  }

  private findByIdentifier(identifier: string) {
    return identifier.includes('@')
      ? this.students.findByEmail(normalizeEmail(identifier))
      : this.students.findByMatric(normalizeMatric(identifier));
  }

  /** Forgot password, step 1: email a 6-digit code to the account's address. */
  async requestPasswordReset(input: { identifier?: string }) {
    const identifier = input.identifier?.trim() ?? '';
    if (!identifier || identifier.length > 254) throw badRequest('Enter your matric number or email');

    const student = await this.findByIdentifier(identifier);
    if (!student) return RESET_REQUESTED;

    const existing = await this.students.findPasswordReset(student.id);
    // Within the cooldown the earlier code is still valid, so there is nothing new to send.
    if (existing && Date.now() - existing.lastSentAt.getTime() < OTP_RESEND_COOLDOWN_MS) return RESET_REQUESTED;

    const code = newOtp();
    await this.students.savePasswordReset({
      studentId: student.id,
      codeHash: await bcrypt.hash(code, 10),
      expiresAt: new Date(Date.now() + OTP_LIFETIME_MS),
    });
    try {
      await this.mailer.sendPasswordResetOtp(student.fullName, student.email, code);
    } catch (error) {
      await this.students.deletePasswordReset(student.id);
      logger.error('[student password reset email] Failed to send OTP:', { error, studentId: student.id });
      throw new AppError(503, 'We could not send the reset email. Please try again later.');
    }
    return RESET_REQUESTED;
  }

  /** Forgot password, step 2: check the code, set the new password and sign the student in. */
  async completePasswordReset(input: { identifier?: string; code?: string; password?: string }) {
    const identifier = input.identifier?.trim() ?? '';
    const code = input.code?.trim() ?? '';
    validatePassword(input.password);
    if (!identifier || !/^\d{6}$/.test(code)) throw badRequest('Your matric number or email and the 6-digit code are required');

    const student = await this.findByIdentifier(identifier);
    if (!student) throw badRequest(INVALID_RESET_CODE);
    const challenge = await this.students.findPasswordReset(student.id);
    if (!challenge) throw badRequest(INVALID_RESET_CODE);
    if (challenge.expiresAt.getTime() <= Date.now() || challenge.attempts >= MAX_OTP_ATTEMPTS) {
      await this.students.deletePasswordReset(student.id);
      throw badRequest(INVALID_RESET_CODE);
    }
    if (!(await bcrypt.compare(code, challenge.codeHash))) {
      await this.students.incrementPasswordResetAttempts(student.id);
      throw badRequest(INVALID_RESET_CODE);
    }

    if (student.suspendedAt) throw new AppError(403, 'This account is suspended. Contact the electoral committee.');
    const account = await this.students.resetPassword(student.id, await bcrypt.hash(input.password, 10), new Date());
    // Sessions on other devices end on their next request.
    forgetStudentSession(student.id);
    return { token: issueToken(account), student: safeStudent(account), message: 'Password updated' };
  }

  async me(id: string) {
    const student = await this.students.findById(id);
    if (!student) throw notFound('Student account not found');
    return safeStudent(student);
  }
}

export const studentAuthService = new StudentAuthService(studentAccountRepository);
