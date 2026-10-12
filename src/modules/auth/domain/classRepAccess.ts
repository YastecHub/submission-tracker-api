import { UserRole } from '@prisma/client';

/**
 * Class roles. CR, ACR, Fin Sec and Dev share the same rights across
 * submissions, payments, the ledger and the Bulletin.
 */
export const CLASS_ROLES: UserRole[] = ['cr', 'acr', 'fin_sec', 'dev'];

export function isClassRep(role: string | undefined | null): role is UserRole {
  return !!role && (CLASS_ROLES as string[]).includes(role);
}

/** Creating new class rep accounts is the only developer-only action. */
export function canCreateClassRepAccount(role: UserRole): boolean {
  return role === 'dev';
}
