import { badRequest } from '../../../shared/errors/AppError';
import { uploadImageBuffer } from '../../../lib/cloudinary';
import {
  birthdayProblem,
  displayName,
  formatBirthday,
  greetingName,
  isBirthdayToday,
  birthdaysCelebratedOn,
  lagosToday,
  MAX_PREFERRED_NAME,
} from '../domain/birthdayRules';
import { birthdayRepository, type BirthdayRepository } from '../infrastructure/birthdayRepository';

export interface BirthdayStudent {
  id: string;
  fullName: string;
}

type PhotoUploader = (buffer: Buffer) => Promise<{ url: string; publicId: string }>;
type Store = Pick<BirthdayRepository, 'findForStudent' | 'upsert' | 'onDates' | 'findStudentByEmail'>;

const defaultUploader: PhotoUploader = (buffer) => uploadImageBuffer(buffer, 'nexium-birthdays');

function flag(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 'true' || value === '1' || value === 'on';
}

/** The birthday form for students, and what their home page shows on the day. */
export class StudentBirthdayService {
  constructor(
    private readonly store: Store = birthdayRepository,
    private readonly uploadPhoto: PhotoUploader = defaultUploader,
  ) {}

  async mine(student: BirthdayStudent, now: Date = new Date()) {
    const today = lagosToday(now);
    const [birthday, celebrating] = await Promise.all([
      this.store.findForStudent(student.id),
      this.store.onDates(birthdaysCelebratedOn(today)),
    ]);
    return {
      birthday: birthday && {
        month: birthday.month,
        day: birthday.day,
        label: formatBirthday(birthday),
        preferredName: birthday.preferredName,
        shareWithClass: birthday.shareWithClass,
        photoUrl: birthday.photoUrl,
        updatedAt: birthday.updatedAt,
      },
      isMyBirthday: !!birthday && isBirthdayToday(birthday, today),
      greetingName: greetingName(student.fullName, birthday?.preferredName ?? null),
      // Classmates celebrating today who agreed to share it.
      today: celebrating
        .filter((entry) => entry.studentId !== student.id && entry.shareWithClass)
        .map((entry) => ({ name: displayName(entry.student.fullName, entry.preferredName), photoUrl: entry.photoUrl })),
    };
  }

  /**
   * For a class rep on the staff dashboard: is it their birthday today? Their staff account
   * is matched to their student account by email.
   */
  async forStaff(user: { email: string; name: string }, now: Date = new Date()) {
    const student = await this.store.findStudentByEmail(user.email);
    const birthday = student?.birthday;
    const isMyBirthday = !!birthday && isBirthdayToday(birthday, lagosToday(now));
    return {
      isMyBirthday,
      greetingName: greetingName(student?.fullName ?? user.name, birthday?.preferredName ?? null),
    };
  }

  async save(student: BirthdayStudent, body: Record<string, unknown>, photo?: { buffer: Buffer }) {
    const month = Number(body.month);
    const day = Number(body.day);
    const problem = birthdayProblem(month, day);
    if (problem) throw badRequest(problem);
    const preferredName = typeof body.preferredName === 'string' ? body.preferredName.trim().replace(/\s+/g, ' ') : '';
    if (preferredName.length > MAX_PREFERRED_NAME) throw badRequest(`Keep the preferred name under ${MAX_PREFERRED_NAME} characters.`);

    const existing = await this.store.findForStudent(student.id);
    let photoFields: { photoUrl?: string | null; photoPublicId?: string | null } = {};
    if (photo) {
      const uploaded = await this.uploadPhoto(photo.buffer);
      photoFields = { photoUrl: uploaded.url, photoPublicId: uploaded.publicId };
    } else if (flag(body.removePhoto, false)) {
      photoFields = { photoUrl: null, photoPublicId: null };
    }

    await this.store.upsert(student.id, {
      month,
      day,
      preferredName: preferredName || null,
      shareWithClass: flag(body.shareWithClass, existing?.shareWithClass ?? true),
      ...photoFields,
    });
    return this.mine(student);
  }
}

export const studentBirthdayService = new StudentBirthdayService();
