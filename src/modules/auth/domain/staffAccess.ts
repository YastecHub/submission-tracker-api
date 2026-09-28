import { UserRole } from '@prisma/client';

export const STAFF_ROLES: UserRole[] = ['cr', 'acr', 'fin_sec', 'dev'];

export function canCreateStaffAccount(role: UserRole): boolean {
  return role === 'dev';
}
