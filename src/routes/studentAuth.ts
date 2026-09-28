import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { getStudent, loginStudent, registerStudent, requestStudentRegistrationOtp } from '../controllers/studentAuthController';
import { studentAuthMiddleware } from '../middleware/studentAuthMiddleware';

const router = Router();
const credentialLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' } });

/**
 * @openapi
 * tags:
 *   name: Student Auth
 *   description: Roster-backed student registration and authentication
 * /api/student-auth/register/request-code:
 *   post:
 *     tags: [Student Auth]
 *     summary: Send a student registration verification code
 *     description: The matric number must exist in the roster and the email local part must sufficiently match the roster name.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [matricNumber, email]
 *             properties:
 *               matricNumber: { type: string }
 *               email: { type: string, format: email }
 *     responses:
 *       200: { description: Verification code sent }
 *       400: { description: Details do not match the roster }
 *       409: { description: Account already exists }
 *       429: { description: Too many attempts }
 * /api/student-auth/register:
 *   post:
 *     tags: [Student Auth]
 *     summary: Verify the code and create a student account
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [matricNumber, email, code, password]
 *             properties:
 *               matricNumber: { type: string }
 *               email: { type: string, format: email }
 *               code: { type: string, pattern: '^[0-9]{6}$' }
 *               password: { type: string, minLength: 8, maxLength: 128 }
 *     responses:
 *       201: { description: Student account and JWT }
 * /api/student-auth/login:
 *   post:
 *     tags: [Student Auth]
 *     summary: Sign in with matric number and password
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [matricNumber, password]
 *             properties:
 *               matricNumber: { type: string }
 *               password: { type: string }
 *     responses:
 *       200: { description: Student account and JWT }
 *       401: { description: Invalid credentials }
 * /api/student-auth/me:
 *   get:
 *     tags: [Student Auth]
 *     summary: Get the signed-in student
 *     security:
 *       - studentBearerAuth: []
 *     responses:
 *       200:
 *         description: Student account
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/StudentAccount' }
 */

router.post('/register/request-code', credentialLimiter, requestStudentRegistrationOtp);
router.post('/register', credentialLimiter, registerStudent);
router.post('/login', credentialLimiter, loginStudent);
router.get('/me', studentAuthMiddleware, getStudent);

export default router;
