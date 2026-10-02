import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import {
  submitPaymentReceipt,
  getPaymentReceipts,
  confirmPaymentReceipt,
  rejectPaymentReceipt,
  getPaymentReceiptStatus,
  getMyTickets,
  claimPaymentReceipt,
  exportPaymentReceiptsToExcel,
} from '../controllers/paymentReceiptController';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/requireRole';
import upload from '../middleware/uploadMiddleware';
import { studentAuthMiddleware } from '../middleware/studentAuthMiddleware';
import { STAFF_ROLES } from '../modules/auth/domain/staffAccess';

const router = Router();
const paymentRoles = requireRole('cr', 'fin_sec', 'dev');
const staffRoles = requireRole(...STAFF_ROLES);

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

// Student-authenticated receipt and ticket routes
router.post('/', studentAuthMiddleware, handleUpload, submitPaymentReceipt);

router.get('/status/:id', studentAuthMiddleware, getPaymentReceiptStatus);

router.get('/my-tickets', studentAuthMiddleware, getMyTickets);

// Protected - admin routes
router.post('/scan', authMiddleware, paymentRoles, claimPaymentReceipt);
router.get('/:eventId/export', authMiddleware, staffRoles, exportPaymentReceiptsToExcel);
router.get('/:eventId', authMiddleware, staffRoles, getPaymentReceipts);
router.patch('/:id/confirm', authMiddleware, paymentRoles, confirmPaymentReceipt);
router.patch('/:id/reject', authMiddleware, paymentRoles, rejectPaymentReceipt);

export default router;
