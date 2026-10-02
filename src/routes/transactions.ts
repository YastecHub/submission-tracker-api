import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import {
  getLedger,
  verifyMatric,
  listTransactionsAdmin,
  createTransaction,
  updateTransaction,
  deleteTransaction,
} from '../controllers/transactionController';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/requireRole';
import upload from '../middleware/uploadMiddleware';
import { studentAuthMiddleware } from '../middleware/studentAuthMiddleware';
import { rateLimit } from 'express-rate-limit';
import { STAFF_ROLES } from '../modules/auth/domain/staffAccess';

const router = Router();

function handleProofUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single('proof')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'Proof image must be under 5 MB' });
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

// Public - student-facing transparency page
const verificationLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification attempts, please try again later.' },
});
router.get('/transparency/ledger', studentAuthMiddleware, getLedger);
router.post('/transparency/verify-matric', verificationLimiter, studentAuthMiddleware, verifyMatric);

// Admin - list/create/edit/delete transactions
const financeRoles = requireRole('fin_sec', 'dev');
const staffRoles = requireRole(...STAFF_ROLES);

router.get('/transactions', authMiddleware, staffRoles, listTransactionsAdmin);
router.post('/transactions', authMiddleware, financeRoles, handleProofUpload, createTransaction);
router.patch('/transactions/:id', authMiddleware, financeRoles, handleProofUpload, updateTransaction);
router.delete('/transactions/:id', authMiddleware, financeRoles, deleteTransaction);

export default router;
