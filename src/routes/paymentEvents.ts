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

const router = Router();
const paymentRoles = requireRole('cr', 'fin_sec', 'dev');

// Public — student needs to load the payment form
router.get('/slug/:slug', getPaymentEventBySlug);

// Protected — admin routes
router.get('/', authMiddleware, paymentRoles, listPaymentEvents);
router.post('/', authMiddleware, paymentRoles, createPaymentEvent);
router.get('/id/:id', authMiddleware, paymentRoles, getPaymentEventById);
router.patch('/:id', authMiddleware, paymentRoles, updatePaymentEvent);
router.patch('/:id/close', authMiddleware, paymentRoles, toggleClosePaymentEvent);
router.patch('/:id/extend', authMiddleware, paymentRoles, extendPaymentEvent);
router.delete('/:id', authMiddleware, paymentRoles, deletePaymentEvent);

export default router;
