import { Router } from 'express';
import { login, me, savePushSubscription, updateProfile, changePassword, createUser } from '../controllers/authController';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/requireRole';
import { CLASS_ROLES } from '../modules/auth/domain/classRepAccess';

const router = Router();
const requireClassRep = requireRole(...CLASS_ROLES);
const requireDev = requireRole('dev');

/**
 * @openapi
 * tags:
 *   name: Auth
 *   description: Authentication endpoints for class reps
 */

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Class rep login
 *     description: Authenticate a class rep. Returns a 7-day JWT token.
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
 *     description: Returns the authenticated class rep's profile.
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
router.get('/me', authMiddleware, requireClassRep, me);
router.patch('/profile', authMiddleware, requireClassRep, updateProfile);
router.patch('/password', authMiddleware, requireClassRep, changePassword);
router.post('/push-subscription', authMiddleware, requireClassRep, savePushSubscription);
router.post('/users', authMiddleware, requireDev, createUser);

export default router;
