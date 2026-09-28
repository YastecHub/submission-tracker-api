import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export function studentAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Student sign-in is required' });
    return;
  }
  try {
    const payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET!) as Express.Request['student'];
    if (!payload || payload.scope !== 'student' || !payload.id || !payload.matricNumber) throw new Error('Invalid student token');
    req.student = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Student session is invalid or expired' });
  }
}
