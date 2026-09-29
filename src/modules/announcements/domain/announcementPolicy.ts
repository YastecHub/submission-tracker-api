import { AnnouncementCategory, AnnouncementStatus, UserRole } from '@prisma/client';
import { STAFF_ROLES } from '../../auth/domain/staffAccess';

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
 * All exco roles (cr, acr, fin_sec, dev) share equal rights for
 * announcements. The only role-gated action is creating new exco
 * accounts, which is enforced separately in the auth routes.
 */
export function canPublishAnnouncement(role: UserRole, _category: AnnouncementCategory): boolean {
  return STAFF_ROLES.includes(role);
}

export function canEditAnnouncement(user: StaffIdentity, announcement: ManagedAnnouncement): boolean {
  if (announcement.status === 'archived') return false;
  // All staff roles can edit any announcement in any status
  return STAFF_ROLES.includes(user.role);
}

