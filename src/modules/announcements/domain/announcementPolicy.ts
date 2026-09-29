import { AnnouncementCategory, AnnouncementStatus, UserRole } from '@prisma/client';

interface StaffIdentity {
  id: string;
  role: UserRole;
}

interface ManagedAnnouncement {
  createdBy: string;
  category: AnnouncementCategory;
  status: AnnouncementStatus;
}

/**
 * Roles that can manage any category including finance.
 * Only restriction: dev cannot create other excos (handled in auth controller).
 */
const MANAGE_ANY_CATEGORY: UserRole[] = ['dev', 'cr', 'acr'];

export function canPublishAnnouncement(role: UserRole, category: AnnouncementCategory): boolean {
  if (MANAGE_ANY_CATEGORY.includes(role)) return true;
  // fin_sec can only publish finance
  if (category === 'finance') return role === 'fin_sec';
  return false;
}

export function canEditAnnouncement(user: StaffIdentity, announcement: ManagedAnnouncement): boolean {
  if (announcement.status === 'archived') return false;
  if (announcement.status !== 'draft') {
    // Published/archived: need publish permission for the category
    return canPublishAnnouncement(user.role, announcement.category);
  }
  // Draft: dev and cr can manage any draft
  if (user.role === 'dev' || user.role === 'cr') return true;
  // Others (including acr and fin_sec) can only edit their own drafts
  return announcement.createdBy === user.id;
}
