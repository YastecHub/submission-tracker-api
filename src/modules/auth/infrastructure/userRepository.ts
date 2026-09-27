import { UserRole } from '@prisma/client';
import prisma from '../../../lib/prisma';

export class UserRepository {
  findLoginUserByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        passwordHash: true,
        hasLoggedInBefore: true,
      },
    });
  }

  findLoginUserByEmailInsensitive(email: string) {
    return prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        passwordHash: true,
        hasLoggedInBefore: true,
      },
    });
  }

  findByEmailInsensitive(email: string) {
    return prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  }

  findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  }

  findProfileById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
  }

  findEmailOwner(email: string, excludeUserId: string) {
    return prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, NOT: { id: excludeUserId } },
    });
  }

  updatePushSubscription(userId: string, subscription: unknown) {
    return prisma.user.update({
      where: { id: userId },
      data: { pushSubscription: JSON.stringify(subscription) },
    });
  }

  updateProfile(userId: string, data: { name?: string; email?: string }) {
    return prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, email: true, name: true, role: true },
    });
  }

  updatePassword(userId: string, passwordHash: string) {
    return prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  createUser(data: { name: string; email: string; passwordHash: string; role: UserRole }) {
    return prisma.user.create({
      data,
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
  }

  markHasLoggedInBefore(userId: string) {
    return prisma.user.update({ where: { id: userId }, data: { hasLoggedInBefore: true } });
  }
}

export const userRepository = new UserRepository();
