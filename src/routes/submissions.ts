import { Router } from 'express';
import {
  createSubmission,
  getSubmissions,
  confirmSubmission,
  scanConfirm,
  exportToExcel,
} from '../controllers/submissionController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

/**
 * @openapi
 * tags:
 *   name: Submissions
 *   description: Student submission and CR confirmation endpoints
 */

/**
 * @openapi
 * /api/submissions/scan:
 *   post:
 *     tags: [Submissions]
 *     summary: Confirm a submission via QR scan (Mode A)
 *     description: CR scans a student's QR code. The QR encodes the submission UUID.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [submissionId]
 *             properties:
 *               submissionId:
 *                 type: string
 *                 format: uuid
 *                 description: The UUID decoded from the student's QR code
 *     responses:
 *       200:
 *         description: Confirmation result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 alreadyConfirmed:
 *                   type: boolean
 *                 submission:
 *                   $ref: '#/components/schemas/Submission'
 *       400:
 *         description: Missing submissionId
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
 *       404:
 *         description: Submission not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/scan', authMiddleware, scanConfirm);

/**
 * @openapi
 * /api/submissions:
 *   post:
 *     tags: [Submissions]
 *     summary: Student submits for an event (public)
 *     description: >
 *       No authentication required. Returns submission with base64 QR code.
 *       Returns 409 if matric number already submitted for this event.
 *       Returns 403 if event is closed or deadline has passed.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [eventId, fullName, matricNumber]
 *             properties:
 *               eventId:
 *                 type: string
 *                 format: uuid
 *               fullName:
 *                 type: string
 *                 example: Amina Bello
 *               matricNumber:
 *                 type: string
 *                 example: 2021/12345
 *               level:
 *                 type: string
 *                 nullable: true
 *                 enum: [100L, 200L, 300L, 400L, 500L, Postgrad]
 *     responses:
 *       201:
 *         description: Submission created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 submission:
 *                   $ref: '#/components/schemas/Submission'
 *       400:
 *         description: Missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Event closed or deadline passed
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
 *       409:
 *         description: Duplicate submission
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: You have already submitted for this event
 */
router.post('/', createSubmission);

/**
 * @openapi
 * /api/submissions/{eventId}/export:
 *   get:
 *     tags: [Submissions]
 *     summary: Export submissions as print-ready Excel file
 *     description: >
 *       Downloads an .xlsx with bold headers, borders, frozen row, correct widths.
 *       Filename: {CourseCode}_{Title}_{YYYY-MM-DD}.xlsx
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Excel file download
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
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
router.get('/:eventId/export', authMiddleware, exportToExcel);

/**
 * @openapi
 * /api/submissions/{eventId}:
 *   get:
 *     tags: [Submissions]
 *     summary: Get all submissions for an event
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: List of submissions ordered newest first
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Submission'
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
router.get('/:eventId', authMiddleware, getSubmissions);

/**
 * @openapi
 * /api/submissions/{id}/confirm:
 *   patch:
 *     tags: [Submissions]
 *     summary: Manually confirm a submission (Mode B)
 *     description: CR clicks confirm in dashboard. Records confirmedBy and confirmedAt.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Submission UUID
 *     responses:
 *       200:
 *         description: Updated submission
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Submission'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Submission not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.patch('/:id/confirm', authMiddleware, confirmSubmission);

export default router;
