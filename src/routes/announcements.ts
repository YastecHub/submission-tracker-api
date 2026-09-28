import { Router } from 'express';
import {
  archiveAnnouncement,
  createAnnouncement,
  getAnnouncementAdmin,
  getAnnouncementUnreadCount,
  getPublishedAnnouncement,
  listAnnouncementPaymentOptions,
  listAnnouncementsAdmin,
  listPublishedAnnouncements,
  markAnnouncementRead,
  publishAnnouncement,
  updateAnnouncement,
} from '../controllers/announcementController';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/requireRole';
import { studentAuthMiddleware } from '../middleware/studentAuthMiddleware';

const router = Router();
const requireStaff = requireRole('cr', 'acr', 'fin_sec', 'dev');

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
