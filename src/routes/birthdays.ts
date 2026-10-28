import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { exportBirthdays, getBirthdayOverview, getMyBirthday, saveMyBirthday } from '../controllers/birthdayController';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/requireRole';
import { studentAuthMiddleware } from '../middleware/studentAuthMiddleware';
import upload from '../middleware/uploadMiddleware';
import { CLASS_ROLES } from '../modules/auth/domain/classRepAccess';

function handlePhoto(req: Request, res: Response, next: NextFunction): void {
  upload.single('photo')(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'The photo must be under 5 MB.' : 'The photo could not be read.' });
      return;
    }
    if (error) {
      res.status(400).json({ error: (error as Error).message || 'The photo could not be read.' });
      return;
    }
    next();
  });
}

const saveLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  keyGenerator: (req) => req.student!.id,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'You have saved your birthday several times. Please wait a few minutes.' },
});

/**
 * @openapi
 * tags:
 *   name: Birthdays
 *   description: Students' birthdays (day and month only), celebrated in the app
 * /api/birthdays/me:
 *   get:
 *     tags: [Birthdays]
 *     summary: The signed-in student's birthday, whether it is today, and classmates celebrating today
 *     security:
 *       - studentBearerAuth: []
 *   put:
 *     tags: [Birthdays]
 *     summary: Save the birthday form (multipart; month, day, preferredName, shareWithClass, optional photo)
 *     security:
 *       - studentBearerAuth: []
 * /api/birthdays/admin:
 *   get:
 *     tags: [Birthdays]
 *     summary: Every answer, who hasn't answered, and birthdays in the next 7 days (class reps and developer)
 *     security:
 *       - bearerAuth: []
 * /api/birthdays/admin/export:
 *   get:
 *     tags: [Birthdays]
 *     summary: Excel export for the media team
 *     security:
 *       - bearerAuth: []
 */
export const birthdayRoutes = Router();

birthdayRoutes.get('/me', studentAuthMiddleware, getMyBirthday);
birthdayRoutes.put('/me', studentAuthMiddleware, saveLimiter, handlePhoto, saveMyBirthday);
birthdayRoutes.get('/admin', authMiddleware, requireRole(...CLASS_ROLES), getBirthdayOverview);
birthdayRoutes.get('/admin/export', authMiddleware, requireRole(...CLASS_ROLES), exportBirthdays);
