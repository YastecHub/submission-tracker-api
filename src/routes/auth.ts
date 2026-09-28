import { Router } from 'express';
import { login, me, savePushSubscription, updateProfile, changePassword, createUser } from '../controllers/authController';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/requireRole';
import { STAFF_ROLES } from '../modules/auth/domain/staffAccess';

const router = Router();
const requireStaff = requireRole(...STAFF_ROLES);
const requireDev = requireRole('dev');

/**
 * @openapi
 * tags:
 *   name: Auth
 *   description: Authentication endpoints for staff
 */

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Staff login
 *     description: Authenticate a staff member. Returns a 7-day JWT token.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: cr@university.edu
 *               password:
 *                 type: string
 *                 example: admin123
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   description: JWT bearer token (7-day expiry)
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Missing email or password
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/login', login);

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get current user
 *     description: Returns the authenticated staff member's profile.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401:
 *         description: Missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/me', authMiddleware, requireStaff, me);
router.patch('/profile', authMiddleware, requireStaff, updateProfile);
router.patch('/password', authMiddleware, requireStaff, changePassword);
router.post('/push-subscription', authMiddleware, requireStaff, savePushSubscription);
router.post('/users', authMiddleware, requireDev, createUser);

export default router;
