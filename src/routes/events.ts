import { Router } from 'express';
import {
  listEvents,
  createEvent,
  getEventBySlug,
  getEventById,
  toggleClose,
  deleteEvent,
} from '../controllers/eventController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

/**
 * @openapi
 * tags:
 *   name: Events
 *   description: Submission event management (CR only, except public slug lookup)
 */

/**
 * @openapi
 * /api/events:
 *   get:
 *     tags: [Events]
 *     summary: List all events for the authenticated CR
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of submission events with stats
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/SubmissionEvent'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', authMiddleware, listEvents);

/**
 * @openapi
 * /api/events:
 *   post:
 *     tags: [Events]
 *     summary: Create a new submission event
 *     description: Generates a unique 7-character slug. Share `/submit/{slug}` with students.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, courseCode, deadline]
 *             properties:
 *               title:
 *                 type: string
 *                 example: Assignment 1
 *               courseCode:
 *                 type: string
 *                 example: CSC401
 *               type:
 *                 type: string
 *                 enum: [assignment, attendance, lab, other]
 *                 default: assignment
 *               description:
 *                 type: string
 *                 nullable: true
 *               deadline:
 *                 type: string
 *                 format: date-time
 *                 example: '2026-04-01T23:59:00.000Z'
 *     responses:
 *       201:
 *         description: Event created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SubmissionEvent'
 *       400:
 *         description: Missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/', authMiddleware, createEvent);

/**
 * @openapi
 * /api/events/id/{id}:
 *   get:
 *     tags: [Events]
 *     summary: Get event by UUID (dashboard use)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Event UUID
 *     responses:
 *       200:
 *         description: Event with submission stats
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SubmissionEvent'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Event not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/id/:id', authMiddleware, getEventById);

/**
 * @openapi
 * /api/events/{slug}:
 *   get:
 *     tags: [Events]
 *     summary: Get public event info by slug (student-facing)
 *     description: Used by the student submission form. No auth required.
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *           example: aB3dE7f
 *         description: 7-character unique event slug
 *     responses:
 *       200:
 *         description: Public event details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SubmissionEvent'
 *       404:
 *         description: Event not found or deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:slug', getEventBySlug);

/**
 * @openapi
 * /api/events/{id}/close:
 *   patch:
 *     tags: [Events]
 *     summary: Toggle event open/closed state
 *     description: Closed events reject new student submissions.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Updated event
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SubmissionEvent'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Event not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.patch('/:id/close', authMiddleware, toggleClose);

/**
 * @openapi
 * /api/events/{id}:
 *   delete:
 *     tags: [Events]
 *     summary: Soft-delete an event
 *     description: Sets isDeleted=true. Data is kept but hidden everywhere.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Event deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Event deleted
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Event not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete('/:id', authMiddleware, deleteEvent);

export default router;
