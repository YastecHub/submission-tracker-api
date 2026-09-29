import { NextFunction, Request, Response, Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import {
  archiveAnnouncement,
  createAnnouncement,
  deleteAnnouncementMedia,
  deleteStudentPushSubscription,
  getAnnouncementAdmin,
  getAnnouncementUnreadCount,
  getPublishedAnnouncement,
  getStudentPushConfig,
  getStudentPushSubscriptionStatus,
  listAnnouncementPaymentOptions,
  listAnnouncementsAdmin,
  listPublishedAnnouncements,
  markAnnouncementRead,
  organizeAnnouncement,
  publishAnnouncement,
  saveStudentPushSubscription,
  updateAnnouncement,
  updateAnnouncementMedia,
  uploadAnnouncementMedia,
} from '../controllers/announcementController';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/requireRole';
import { studentAuthMiddleware } from '../middleware/studentAuthMiddleware';
import { STAFF_ROLES } from '../modules/auth/domain/staffAccess';
import upload from '../middleware/uploadMiddleware';

const router = Router();
const requireStaff = requireRole(...STAFF_ROLES);
const assistantLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 8,
  keyGenerator: (req) => req.user!.id,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'You have used the announcement assistant several times. Review the current suggestions before trying again.' },
});
const mediaUploadLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 30,
  keyGenerator: (req) => req.user!.id,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'You have uploaded several image batches. Please wait before uploading more.' },
});

function handleMediaUpload(req: Request, res: Response, next: NextFunction): void {
  upload.array('images', 8)(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? 'Each image must be under 5 MB'
        : error.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Upload no more than 8 images at once'
          : 'The selected images could not be read';
      res.status(400).json({ error: message });
      return;
    }
    if (error) {
      res.status(400).json({ error: (error as Error).message || 'The selected images could not be read' });
      return;
    }
    next();
  });
}

/**
 * @openapi
 * /api/bulletin/push/config:
 *   get:
 *     tags: [Nexium Bulletin]
 *     summary: Get student push-notification configuration
 *     security: [{ studentBearerAuth: [] }]
 *     responses:
 *       200: { description: Push configuration and public VAPID key }
 * /api/bulletin/push/subscriptions/status:
 *   post:
 *     tags: [Nexium Bulletin]
 *     summary: Check whether this browser subscription belongs to the signed-in student
 *     security: [{ studentBearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [endpoint]
 *             properties: { endpoint: { type: string, format: uri } }
 *     responses:
 *       200: { description: Current browser subscription status }
 * /api/bulletin/push/subscriptions:
 *   post:
 *     tags: [Nexium Bulletin]
 *     summary: Save or refresh a student browser push subscription
 *     security: [{ studentBearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [subscription]
 *             properties: { subscription: { $ref: '#/components/schemas/StudentPushSubscription' } }
 *     responses:
 *       201: { description: Subscription saved }
 *   delete:
 *     tags: [Nexium Bulletin]
 *     summary: Disable Bulletin delivery to this browser for the signed-in student
 *     security: [{ studentBearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [endpoint]
 *             properties: { endpoint: { type: string, format: uri } }
 *     responses:
 *       200: { description: Subscription removed }
 */
router.get('/push/config', studentAuthMiddleware, getStudentPushConfig);
router.post('/push/subscriptions/status', studentAuthMiddleware, getStudentPushSubscriptionStatus);
router.post('/push/subscriptions', studentAuthMiddleware, saveStudentPushSubscription);
router.delete('/push/subscriptions', studentAuthMiddleware, deleteStudentPushSubscription);

/**
 * @openapi
 * /api/bulletin/feed:
 *   get:
 *     tags: [Nexium Bulletin]
 *     summary: List published announcements for the signed-in student
 *     security: [{ studentBearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, minimum: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 50 } }
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: category, schema: { type: string, enum: [general, academic, practical, finance, event, opportunity, emergency] } }
 *       - { in: query, name: priority, schema: { type: string, enum: [normal, important, urgent] } }
 *     responses:
 *       200:
 *         description: Paginated published announcements with student read state
 */
router.get('/feed', studentAuthMiddleware, listPublishedAnnouncements);

/**
 * @openapi
 * /api/bulletin/feed/unread-count:
 *   get:
 *     tags: [Nexium Bulletin]
 *     summary: Count announcements not read at their current version
 *     security: [{ studentBearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Unread announcement count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties: { count: { type: integer } }
 */
router.get('/feed/unread-count', studentAuthMiddleware, getAnnouncementUnreadCount);

/**
 * @openapi
 * /api/bulletin/feed/{slug}:
 *   get:
 *     tags: [Nexium Bulletin]
 *     summary: Get one published announcement
 *     security: [{ studentBearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: slug, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Published announcement content and related payment summary
 *       404:
 *         description: Announcement not found
 */
router.get('/feed/:slug', studentAuthMiddleware, getPublishedAnnouncement);

/**
 * @openapi
 * /api/bulletin/feed/{id}/read:
 *   post:
 *     tags: [Nexium Bulletin]
 *     summary: Mark the current announcement version as read
 *     security: [{ studentBearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Read state saved }
 *       404: { description: Announcement not found }
 */
router.post('/feed/:id/read', studentAuthMiddleware, markAnnouncementRead);

router.get('/admin/payment-options', authMiddleware, requireStaff, listAnnouncementPaymentOptions);

/**
 * @openapi
 * /api/bulletin/admin/organize:
 *   post:
 *     tags: [Nexium Bulletin Staff]
 *     summary: Suggest a structured draft from staff-provided source material
 *     description: Returns reviewable suggestions only. It never saves or publishes announcement content.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rawSource]
 *             properties:
 *               rawSource: { type: string, minLength: 20, maxLength: 30000 }
 *               announcementId: { type: string, format: uuid, nullable: true }
 *     responses:
 *       200:
 *         description: Validated suggestion with warnings, split suggestions and audit metadata
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AnnouncementAiOrganization' }
 *       429: { description: Assistant request limit reached }
 *       502: { description: A safe, validated suggestion could not be produced }
 *       503: { description: Announcement assistant is not configured }
 */
router.post('/admin/organize', authMiddleware, requireStaff, assistantLimiter, organizeAnnouncement);

/**
 * @openapi
 * /api/bulletin/admin/{id}/media:
 *   post:
 *     tags: [Nexium Bulletin Staff]
 *     summary: Upload multiple version-checked announcement images
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [images, metadata, expectedVersion]
 *             properties:
 *               images: { type: array, maxItems: 8, items: { type: string, format: binary } }
 *               metadata: { type: string, description: 'JSON array containing altText, caption and sectionId for each image' }
 *               expectedVersion: { type: integer, minimum: 1 }
 *               changeNote: { type: string, maxLength: 300 }
 *     responses:
 *       201: { description: Images uploaded and announcement version advanced }
 *       409: { description: Announcement changed before upload completed }
 *   patch:
 *     tags: [Nexium Bulletin Staff]
 *     summary: Save image order, alt text, captions and section assignments
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [expectedVersion, items]
 *             properties:
 *               expectedVersion: { type: integer, minimum: 1 }
 *               changeNote: { type: string, maxLength: 300 }
 *               items: { type: array, items: { $ref: '#/components/schemas/AnnouncementMediaWrite' } }
 *     responses:
 *       200: { description: Image details saved and announcement version advanced }
 *       409: { description: Announcement changed before image details were saved }
 */
router.post('/admin/:id/media', authMiddleware, requireStaff, mediaUploadLimiter, handleMediaUpload, uploadAnnouncementMedia);
router.patch('/admin/:id/media', authMiddleware, requireStaff, updateAnnouncementMedia);

/**
 * @openapi
 * /api/bulletin/admin/{id}/media/{mediaId}:
 *   delete:
 *     tags: [Nexium Bulletin Staff]
 *     summary: Remove one version-checked announcement image
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: mediaId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [expectedVersion]
 *             properties:
 *               expectedVersion: { type: integer, minimum: 1 }
 *               changeNote: { type: string, maxLength: 300 }
 *     responses:
 *       200: { description: Image removed and announcement version advanced }
 *       409: { description: Announcement changed before image removal }
 */
router.delete('/admin/:id/media/:mediaId', authMiddleware, requireStaff, deleteAnnouncementMedia);

/**
 * @openapi
 * /api/bulletin/admin:
 *   get:
 *     tags: [Nexium Bulletin Staff]
 *     summary: List drafts, published announcements and archives
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, minimum: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 50 } }
 *       - { in: query, name: status, schema: { type: string, enum: [draft, published, archived] } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: Paginated staff announcement list }
 *   post:
 *     tags: [Nexium Bulletin Staff]
 *     summary: Create an announcement draft
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/AnnouncementWrite' }
 *     responses:
 *       201: { description: Draft created }
 *       400:
 *         description: Invalid announcement
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get('/admin', authMiddleware, requireStaff, listAnnouncementsAdmin);
router.post('/admin', authMiddleware, requireStaff, createAnnouncement);

/**
 * @openapi
 * /api/bulletin/admin/{id}:
 *   get:
 *     tags: [Nexium Bulletin Staff]
 *     summary: Get an announcement for staff review
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Complete staff announcement including raw source and revisions }
 *       404: { description: Announcement not found }
 *   patch:
 *     tags: [Nexium Bulletin Staff]
 *     summary: Save a version-checked announcement update
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/AnnouncementWrite' }
 *     responses:
 *       200: { description: Announcement saved }
 *       409: { description: Announcement was changed by another editor }
 */
router.get('/admin/:id', authMiddleware, requireStaff, getAnnouncementAdmin);
router.patch('/admin/:id', authMiddleware, requireStaff, updateAnnouncement);

/**
 * @openapi
 * /api/bulletin/admin/{id}/publish:
 *   post:
 *     tags: [Nexium Bulletin Staff]
 *     summary: Publish a reviewed draft
 *     description: CR/dev publish non-finance content; Fin Sec/dev publish finance content.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [expectedVersion]
 *             properties:
 *               expectedVersion: { type: integer, minimum: 1 }
 *               changeNote: { type: string, maxLength: 300 }
 *     responses:
 *       200: { description: Announcement published and revision captured }
 *       403: { description: Role cannot publish this category }
 *       409: { description: Announcement changed before publication }
 */
router.post('/admin/:id/publish', authMiddleware, requireStaff, publishAnnouncement);

/**
 * @openapi
 * /api/bulletin/admin/{id}/archive:
 *   post:
 *     tags: [Nexium Bulletin Staff]
 *     summary: Remove a published announcement from the active feed without deleting it
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Announcement archived }
 *       403: { description: Role cannot archive this category }
 *       409: { description: Announcement changed before archival }
 */
router.post('/admin/:id/archive', authMiddleware, requireStaff, archiveAnnouncement);

export default router;
