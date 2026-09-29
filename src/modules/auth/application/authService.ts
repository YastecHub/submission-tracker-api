import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';
import { badRequest, forbidden, notFound, AppError } from '../../../shared/errors/AppError';
import logger from '../../../lib/logger';
import { sendWelcomeEmail } from '../../../utils/mailer';
import { userRepository, UserRepository } from '../infrastructure/userRepository';
import { canCreateStaffAccount } from '../domain/staffAccess';

function safeUser(user: { id: string; email: string; name: string; role: UserRole }) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export class AuthService {
  constructor(private readonly users: UserRepository) {}

  async login(input: { email?: string; password?: string }) {
    if (!input.email || !input.password) throw badRequest('Email and password required');

    const email = input.email.trim().toLowerCase();
    const user =
      (await this.users.findLoginUserByEmail(email)) ??
      (await this.users.findLoginUserByEmailInsensitive(email));
    if (!user) throw new AppError(401, 'Invalid credentials');

    const valid = await bcrypt.compare(input.password, user.passwordHash);
    if (!valid) throw new AppError(401, 'Invalid credentials');

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    this.handleFirstLogin(user).catch((err) => logger.error('[welcome email] Failed to send first login email:', { error: err, userId: user.id }));
    return { token, user: safeUser(user) };
  }

  async me(userId: string) {
    const user = await this.users.findProfileById(userId);
    if (!user) throw notFound('User not found');
    return user;
  }

  async savePushSubscription(userId: string, subscription: unknown) {
    if (!subscription) throw badRequest('subscription required');
    await this.users.updatePushSubscription(userId, subscription);
    return { ok: true };
  }

  async updateProfile(userId: string, input: { name?: string; email?: string }) {
    if (!input.name && !input.email) throw badRequest('Nothing to update');

    const normalizedEmail = input.email?.trim().toLowerCase();
    if (normalizedEmail) {
      const taken = await this.users.findEmailOwner(normalizedEmail, userId);
      if (taken) throw new AppError(409, 'Email already in use by another account');
    }

    return this.users.updateProfile(userId, {
      ...(input.name ? { name: input.name.trim() } : {}),
      ...(normalizedEmail ? { email: normalizedEmail } : {}),
    });
  }

  async changePassword(userId: string, input: { currentPassword?: string; newPassword?: string }) {
    if (!input.currentPassword || !input.newPassword) {
      throw badRequest('currentPassword and newPassword are required');
    }
    if (input.newPassword.length < 8) throw badRequest('New password must be at least 8 characters');

    const user = await this.users.findById(userId);
    if (!user) throw notFound('User not found');

    const valid = await bcrypt.compare(input.currentPassword, user.passwordHash);
    if (!valid) throw new AppError(401, 'Current password is incorrect');

    await this.users.updatePassword(user.id, await bcrypt.hash(input.newPassword, 10));
    return { ok: true };
  }

  async createUser(callerRole: UserRole, input: { name?: string; email?: string; password?: string; role?: string }) {
    if (!canCreateStaffAccount(callerRole)) throw forbidden('Only developers can create staff accounts');
    if (!input.name || !input.email || !input.password || !input.role) {
      throw badRequest('name, email, password, and role are required');
    }

    const validRoles: UserRole[] = ['cr', 'acr', 'fin_sec', 'dev'];
    if (!validRoles.includes(input.role as UserRole)) throw badRequest(`role must be one of: ${validRoles.join(', ')}`);
    if (input.password.length < 8) throw badRequest('Password must be at least 8 characters');

    const email = input.email.trim().toLowerCase();
    const existing = await this.users.findByEmailInsensitive(email);
    if (existing) throw new AppError(409, 'An account with this email already exists');

    return this.users.createUser({
      name: input.name.trim(),
      email,
      passwordHash: await bcrypt.hash(input.password, 10),
      role: input.role as UserRole,
    });
  }

  private async handleFirstLogin(user: { id: string; name: string; email: string; role: UserRole; hasLoggedInBefore: boolean }) {
    if (user.hasLoggedInBefore) return;
    await this.users.markHasLoggedInBefore(user.id);
    if (user.role !== 'dev') {
      await sendWelcomeEmail(user.name, user.email, user.role as 'cr' | 'acr');
    }
  }
}

export const authService = new AuthService(userRepository);
