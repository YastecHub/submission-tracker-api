import { Router } from 'express';
import {
  listPaymentEvents,
  createPaymentEvent,
  getPaymentEventBySlug,
  getPaymentEventById,
  updatePaymentEvent,
  toggleClosePaymentEvent,
  extendPaymentEvent,
  deletePaymentEvent,
} from '../controllers/paymentEventController';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/requireRole';
import { CLASS_ROLES } from '../modules/auth/domain/classRepAccess';

const router = Router();
const classRepRoles = requireRole(...CLASS_ROLES);

// Public - student needs to load the payment form
router.get('/slug/:slug', getPaymentEventBySlug);

// Protected - admin routes
router.get('/', authMiddleware, classRepRoles, listPaymentEvents);
router.post('/', authMiddleware, classRepRoles, createPaymentEvent);
router.get('/id/:id', authMiddleware, classRepRoles, getPaymentEventById);
router.patch('/:id', authMiddleware, classRepRoles, updatePaymentEvent);
router.patch('/:id/close', authMiddleware, classRepRoles, toggleClosePaymentEvent);
router.patch('/:id/extend', authMiddleware, classRepRoles, extendPaymentEvent);
router.delete('/:id', authMiddleware, classRepRoles, deletePaymentEvent);

export default router;
