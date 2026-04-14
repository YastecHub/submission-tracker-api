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

// Public — student-facing transparency page
router.get('/transparency/ledger', getLedger);
router.post('/transparency/verify-matric', verifyMatric);

// Admin — list/create/edit/delete transactions
const writeRoles = requireRole('cr', 'acr', 'fin_sec', 'dev');

router.get('/transactions', authMiddleware, listTransactionsAdmin);
router.post('/transactions', authMiddleware, writeRoles, handleProofUpload, createTransaction);
router.patch('/transactions/:id', authMiddleware, writeRoles, handleProofUpload, updateTransaction);
router.delete('/transactions/:id', authMiddleware, writeRoles, deleteTransaction);

export default router;
