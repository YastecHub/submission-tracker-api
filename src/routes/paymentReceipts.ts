import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
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

// Wrap multer so its errors return clean JSON instead of a raw 500
function handleUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single('receipt')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'Receipt image must be under 5 MB' });
      } else {
        res.status(400).json({ error: err.message });
      }
      return;
    }
    if (err) {
      res.status(400).json({ error: (err as Error).message ?? 'File upload error' });
      return;
    }
    next();
  });
}

// Public — student submits receipt (multipart/form-data)
router.post('/', handleUpload, submitPaymentReceipt);

// Public — student polls status
router.get('/status/:id', getPaymentReceiptStatus);

// Protected — admin routes
router.get('/:eventId', authMiddleware, getPaymentReceipts);
router.patch('/:id/confirm', authMiddleware, confirmPaymentReceipt);
router.patch('/:id/reject', authMiddleware, rejectPaymentReceipt);

export default router;
