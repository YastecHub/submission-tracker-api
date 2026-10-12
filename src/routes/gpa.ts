import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  createGpaSemester,
  deleteGpaSemester,
  finalizeGpaSemester,
  getCourseCatalog,
  getGpaRecord,
  importGpaCsv,
  unlockGpaSemester,
  updateGpaSemester,
} from '../controllers/gpaController';
import { studentAuthMiddleware } from '../middleware/studentAuthMiddleware';

const router = Router();

// GPA records are private to each student: every route needs a student token.
router.use(studentAuthMiddleware);

const importLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 30,
  keyGenerator: (req) => req.student!.id,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many imports. Please wait a few minutes and try again.' },
});

/**
 * @openapi
 * tags:
 *   name: GPA Tracker
 *   description: Private, student-only GPA and CGPA tracker (5.0 scale)
 * /api/gpa:
 *   get:
 *     tags: [GPA Tracker]
 *     summary: The signed-in student's semesters, courses, GPA per semester and CGPA
 *     security:
 *       - studentBearerAuth: []
 *     responses:
 *       200: { description: "{ semesters, summary } - summary.cgpa counts finalized semesters, summary.projectedCgpa also counts drafts" }
 * /api/gpa/catalog:
 *   get:
 *     tags: [GPA Tracker]
 *     summary: Department course list (active courses by level and semester)
 *     security:
 *       - studentBearerAuth: []
 *     responses:
 *       200: { description: "{ courses: [{ id, code, title, units, level, semester, isElective }] }" }
 * /api/gpa/semesters:
 *   post:
 *     tags: [GPA Tracker]
 *     summary: Create a semester (draft). Send a client-generated id to make retries safe.
 *     security:
 *       - studentBearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [level, semester]
 *             properties:
 *               id: { type: string, format: uuid }
 *               level: { type: integer, enum: [100, 200, 300, 400, 500] }
 *               semester: { type: integer, enum: [1, 2] }
 *               sessionLabel: { type: string, example: 2025/2026 }
 *               courses:
 *                 type: array
 *                 maxItems: 30
 *                 items:
 *                   type: object
 *                   required: [code, units]
 *                   properties:
 *                     catalogCourseId: { type: string, format: uuid }
 *                     code: { type: string }
 *                     title: { type: string }
 *                     units: { type: integer, minimum: 1, maximum: 12 }
 *                     grade: { type: string, enum: [A, B, C, D, E, F], nullable: true }
 *                     isCarryover: { type: boolean }
 *                     isRetake: { type: boolean }
 *     responses:
 *       201: { description: The semester }
 *       409: { description: This level and semester already exists }
 * /api/gpa/semesters/{id}:
 *   put:
 *     tags: [GPA Tracker]
 *     summary: Replace a draft semester's session and courses (optimistic concurrency via expectedVersion)
 *     security:
 *       - studentBearerAuth: []
 *     responses:
 *       200: { description: The semester }
 *       409: { description: Finalized, or changed on another device }
 *   delete:
 *     tags: [GPA Tracker]
 *     summary: Delete a semester and its courses
 *     security:
 *       - studentBearerAuth: []
 *     responses:
 *       200: { description: Deleted }
 * /api/gpa/semesters/{id}/finalize:
 *   post:
 *     tags: [GPA Tracker]
 *     summary: Mark a semester's results as final (every course needs a grade)
 *     security:
 *       - studentBearerAuth: []
 *     responses:
 *       200: { description: The semester }
 * /api/gpa/semesters/{id}/unlock:
 *   post:
 *     tags: [GPA Tracker]
 *     summary: Move a finalized semester back to draft so it can be corrected
 *     security:
 *       - studentBearerAuth: []
 *     responses:
 *       200: { description: The semester }
 * /api/gpa/import:
 *   post:
 *     tags: [GPA Tracker]
 *     summary: Import courses from CSV. dryRun (default true) returns a preview; any invalid row rejects the whole file.
 *     security:
 *       - studentBearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [csv]
 *             properties:
 *               csv: { type: string, description: "Header: level,semester,code,title,units,grade,carryover,retake,session" }
 *               dryRun: { type: boolean, default: true }
 *               finalize: { type: boolean, default: true, description: Finalize imported semesters whose courses all have grades }
 *     responses:
 *       200: { description: "{ valid, rowCount, issues: [{ line, column, message }], semesters, summaryAfterImport, imported, record? }" }
 */
router.get('/', getGpaRecord);
router.get('/catalog', getCourseCatalog);
router.post('/semesters', createGpaSemester);
router.put('/semesters/:id', updateGpaSemester);
router.delete('/semesters/:id', deleteGpaSemester);
router.post('/semesters/:id/finalize', finalizeGpaSemester);
router.post('/semesters/:id/unlock', unlockGpaSemester);
router.post('/import', importLimiter, importGpaCsv);

export default router;
