import { Router } from 'express';
import {
  submitPaymentReceipt,
  getPaymentReceipts,
  confirmPaymentReceipt,
  rejectPaymentReceipt,
  getPaymentReceiptStatus,
} from '../controllers/paymentReceiptController';
import { authMiddleware } from '../middleware/authMiddleware';
import upload from '../middleware/uploadMiddleware';

const router = Router();

// Public — student submits receipt (multipart/form-data)
router.post('/', upload.single('receipt'), submitPaymentReceipt);

// Public — student polls status
router.get('/status/:id', getPaymentReceiptStatus);

// Protected — admin routes
router.get('/:eventId', authMiddleware, getPaymentReceipts);
router.patch('/:id/confirm', authMiddleware, confirmPaymentReceipt);
router.patch('/:id/reject', authMiddleware, rejectPaymentReceipt);

export default router;
