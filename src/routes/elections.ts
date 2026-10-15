import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import {
  addCandidate, addPosition, approvePublish, backToDraft, castBallot, checkReceipt, closeElection, createElection,
  deleteElection, extendElection, getAuditLog, getElection, getElectionResults, getMyElection, getPublishedResults,
  getRegistrations, getTurnoutTimeline, listCommittee, listElections, listMyElections, markReady, openElection,
  pauseElection, removeCandidate, removePosition, resumeElection, suspendStudent, updateCandidate, updateElection,
  updatePosition, uploadVoters,
} from '../controllers/electionController';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/requireRole';
import { studentAuthMiddleware } from '../middleware/studentAuthMiddleware';
import upload from '../middleware/uploadMiddleware';

function handlePhoto(req: Request, res: Response, next: NextFunction): void {
  upload.single('photo')(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'The photo must be under 5 MB.' : 'The photo could not be read.' });
      return;
    }
    if (error) {
      res.status(400).json({ error: (error as Error).message || 'The photo could not be read.' });
      return;
    }
    next();
  });
}

// Per student, not per IP: a whole class may vote from one campus network.
const ballotLimiter = rateLimit({
  windowMs: 60_000,
  max: 12,
  keyGenerator: (req) => `ballot:${req.student?.id ?? ipKeyGenerator(req.ip ?? '')}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Wait a minute and try again.' },
});

/**
 * @openapi
 * tags:
 *   - name: Elections (students)
 *     description: Secret-ballot class elections. Students only see elections they are on the voter list for.
 *   - name: Elections (setup and committee)
 *     description: The developer sets an election up; the electoral committee runs it. Class reps have no access.
 * /api/elections:
 *   get:
 *     tags: [Elections (students)]
 *     summary: Elections the signed-in student can vote in
 *     security: [{ studentBearerAuth: [] }]
 * /api/elections/{id}/ballot:
 *   post:
 *     tags: [Elections (students)]
 *     summary: Cast a ballot (once; never changeable)
 *     description: Body { requestId (uuid, same on retry), receiptCode (10 chars, generated on the device), choices [{ positionId, candidateId, approve? }] }. Every position must be answered. A retry with the same requestId returns success instead of "already voted".
 *     security: [{ studentBearerAuth: [] }]
 * /api/elections/{id}/results:
 *   get:
 *     tags: [Elections (students)]
 *     summary: Published results, ranked from most votes to least
 *     security: [{ studentBearerAuth: [] }]
 * /api/elections/{id}/receipt:
 *   post:
 *     tags: [Elections (students)]
 *     summary: Check that a receipt code was counted (after closing). Never reveals choices.
 *     security: [{ studentBearerAuth: [] }]
 * /api/election-admin:
 *   get:
 *     tags: [Elections (setup and committee)]
 *     summary: List elections (developer and committee)
 *     security: [{ bearerAuth: [] }]
 *   post:
 *     tags: [Elections (setup and committee)]
 *     summary: Create an election (developer)
 *     security: [{ bearerAuth: [] }]
 * /api/election-admin/{id}/voters:
 *   put:
 *     tags: [Elections (setup and committee)]
 *     summary: Upload the voter list (CSV text; dryRun true by default). Replaces it in setup, only adds after locking.
 *     security: [{ bearerAuth: [] }]
 * /api/election-admin/{id}/publish:
 *   post:
 *     tags: [Elections (setup and committee)]
 *     summary: Approve publishing results (committee). Publishes when both members approve, or one after 30 minutes.
 *     security: [{ bearerAuth: [] }]
 */
export const studentElectionRoutes = Router();
studentElectionRoutes.use(studentAuthMiddleware);
studentElectionRoutes.get('/', listMyElections);
studentElectionRoutes.get('/:id', getMyElection);
studentElectionRoutes.post('/:id/ballot', ballotLimiter, castBallot);
studentElectionRoutes.get('/:id/results', getPublishedResults);
studentElectionRoutes.post('/:id/receipt', ballotLimiter, checkReceipt);

export const electionAdminRoutes = Router();
electionAdminRoutes.use(authMiddleware, requireRole('dev', 'electoral_committee'));
electionAdminRoutes.get('/', listElections);
electionAdminRoutes.post('/', createElection);
electionAdminRoutes.get('/committee', listCommittee);
electionAdminRoutes.get('/:id', getElection);
electionAdminRoutes.patch('/:id', updateElection);
electionAdminRoutes.delete('/:id', deleteElection);
electionAdminRoutes.post('/:id/positions', addPosition);
electionAdminRoutes.patch('/:id/positions/:positionId', updatePosition);
electionAdminRoutes.delete('/:id/positions/:positionId', removePosition);
electionAdminRoutes.post('/:id/candidates', handlePhoto, addCandidate);
electionAdminRoutes.patch('/:id/candidates/:candidateId', handlePhoto, updateCandidate);
electionAdminRoutes.delete('/:id/candidates/:candidateId', removeCandidate);
electionAdminRoutes.put('/:id/voters', uploadVoters);
electionAdminRoutes.get('/:id/registrations', getRegistrations);
electionAdminRoutes.post('/:id/students/:studentId/suspension', suspendStudent);
electionAdminRoutes.post('/:id/ready', markReady);
electionAdminRoutes.post('/:id/draft', backToDraft);
electionAdminRoutes.post('/:id/open', openElection);
electionAdminRoutes.post('/:id/pause', pauseElection);
electionAdminRoutes.post('/:id/resume', resumeElection);
electionAdminRoutes.post('/:id/extend', extendElection);
electionAdminRoutes.post('/:id/close', closeElection);
electionAdminRoutes.post('/:id/publish', approvePublish);
electionAdminRoutes.get('/:id/results', getElectionResults);
electionAdminRoutes.get('/:id/audit', getAuditLog);
electionAdminRoutes.get('/:id/timeline', getTurnoutTimeline);
