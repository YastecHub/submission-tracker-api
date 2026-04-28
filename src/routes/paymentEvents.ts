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

const router = Router();

// Public — student needs to load the payment form
router.get('/slug/:slug', getPaymentEventBySlug);

// Protected — admin routes
router.get('/', authMiddleware, listPaymentEvents);
router.post('/', authMiddleware, createPaymentEvent);
router.get('/id/:id', authMiddleware, getPaymentEventById);
router.patch('/:id', authMiddleware, updatePaymentEvent);
router.patch('/:id/close', authMiddleware, toggleClosePaymentEvent);
router.patch('/:id/extend', authMiddleware, extendPaymentEvent);
router.delete('/:id', authMiddleware, deletePaymentEvent);

export default router;
