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

export function canPublishAnnouncement(role: UserRole, category: AnnouncementCategory): boolean {
  if (role === 'dev') return true;
  if (category === 'finance') return role === 'fin_sec';
  return role === 'cr';
}

export function canEditAnnouncement(user: StaffIdentity, announcement: ManagedAnnouncement): boolean {
  if (announcement.status === 'archived') return false;
  if (announcement.status !== 'draft') return canPublishAnnouncement(user.role, announcement.category);
  if (user.role === 'dev' || user.role === 'cr') return true;
  if (user.role === 'fin_sec' && announcement.category === 'finance') return true;
  return announcement.createdBy === user.id;
}
