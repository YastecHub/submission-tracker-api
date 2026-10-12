import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  getStudent,
  loginStudent,
  registerStudent,
  requestStudentPasswordReset,
  requestStudentRegistrationOtp,
  resetStudentPassword,
} from '../controllers/studentAuthController';
import { studentAuthMiddleware } from '../middleware/studentAuthMiddleware';

const router = Router();
const credentialLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' } });
// Separate budget so a few reset attempts never lock a shared campus IP out of signing in.
const passwordResetLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many password reset attempts, please try again later.' } });

/**
 * @openapi
 * tags:
 *   name: Student Auth
 *   description: Roster-backed student registration and authentication
 * /api/student-auth/register/request-code:
 *   post:
 *     tags: [Student Auth]
 *     summary: Send a student registration verification code
 *     description: The matric number must exist in the roster. Any email address can be used for now (the email-name rule is not enforced).
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
 *       400: { description: Invalid matric number or email }
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
 * /api/student-auth/password-reset/request:
 *   post:
 *     tags: [Student Auth]
 *     summary: Forgot password - email a 6-digit reset code
 *     description: Accepts the matric number or the account email. The answer is the same whether or not an account matches. The code goes to the email on the account, expires in 10 minutes, and a new one can be sent after 60 seconds.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [identifier]
 *             properties:
 *               identifier: { type: string, description: Matric number or account email }
 *     responses:
 *       200: { description: Reset code sent if an account matched }
 *       429: { description: Too many attempts }
 *       503: { description: The email could not be sent }
 * /api/student-auth/password-reset:
 *   post:
 *     tags: [Student Auth]
 *     summary: Forgot password - set a new password with the emailed code
 *     description: Signs the student in. Sessions on other devices end on their next request. A code allows 5 wrong attempts.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [identifier, code, password]
 *             properties:
 *               identifier: { type: string }
 *               code: { type: string, pattern: '^[0-9]{6}$' }
 *               password: { type: string, minLength: 8, maxLength: 128 }
 *     responses:
 *       200: { description: Password changed; student account and JWT }
 *       400: { description: Invalid or expired code, or weak password }
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
router.post('/password-reset/request', passwordResetLimiter, requestStudentPasswordReset);
router.post('/password-reset', passwordResetLimiter, resetStudentPassword);
router.get('/me', studentAuthMiddleware, getStudent);

export default router;
