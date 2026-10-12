import { AnnouncementCategory, AnnouncementStatus, UserRole } from '@prisma/client';
import { CLASS_ROLES } from '../../auth/domain/classRepAccess';

interface ClassRepIdentity {
  id: string;
  role: UserRole;
}

interface ManagedAnnouncement {
  createdBy: string;
  category: AnnouncementCategory;
  status: AnnouncementStatus;
}

/**
 * All class roles (cr, acr, fin_sec, dev) share equal rights for
 * announcements. The only role-gated action is creating new class rep
 * accounts, which is enforced separately in the auth routes.
 */
export function canPublishAnnouncement(role: UserRole, _category: AnnouncementCategory): boolean {
  return CLASS_ROLES.includes(role);
}

export function canEditAnnouncement(user: ClassRepIdentity, announcement: ManagedAnnouncement): boolean {
  if (announcement.status === 'archived') return false;
  // All class roles can edit any announcement in any status
  return CLASS_ROLES.includes(user.role);
}

