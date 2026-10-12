import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { studentSessionIsCurrent } from '../modules/studentAuth/application/studentSessions';

export async function studentAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Student sign-in is required' });
    return;
  }
  let payload: Express.Request['student'];
  try {
    payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET!) as Express.Request['student'];
    if (!payload || payload.scope !== 'student' || !payload.id || !payload.matricNumber) throw new Error('Invalid student token');
  } catch {
    res.status(401).json({ error: 'Student session is invalid or expired' });
    return;
  }
  try {
    if (!(await studentSessionIsCurrent(payload.id, payload.iat))) {
      res.status(401).json({ error: 'Your password was changed. Please sign in again.' });
      return;
    }
  } catch (error) {
    next(error);
    return;
  }
  req.student = payload;
  next();
}
