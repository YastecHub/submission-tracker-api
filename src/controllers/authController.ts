import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { sendWelcomeEmail } from '../utils/mailer';

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password required' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    process.env.JWT_SECRET!,
    { expiresIn: '7d' }
  );

  // Send welcome email + mark first login — fire and forget
  if (!user.hasLoggedInBefore) {
    prisma.user
      .update({ where: { id: user.id }, data: { hasLoggedInBefore: true } })
      .then(() => sendWelcomeEmail(user.name, user.email, user.role))
      .catch((err) => console.error('[welcome email]', err));
  }

  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
}

export async function savePushSubscription(req: Request, res: Response): Promise<void> {
  const { subscription } = req.body as { subscription?: unknown };
  if (!subscription) {
    res.status(400).json({ error: 'subscription required' });
    return;
  }
  await prisma.user.update({
    where: { id: req.user!.id },
    data: { pushSubscription: JSON.stringify(subscription) },
  });
  res.json({ ok: true });
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  const { name, email } = req.body as { name?: string; email?: string };

  if (!name && !email) {
    res.status(400).json({ error: 'Nothing to update' });
    return;
  }

  if (email) {
    const taken = await prisma.user.findFirst({
      where: { email, NOT: { id: req.user!.id } },
    });
    if (taken) {
      res.status(409).json({ error: 'Email already in use by another account' });
      return;
    }
  }

  const updated = await prisma.user.update({
    where: { id: req.user!.id },
    data: {
      ...(name ? { name } : {}),
      ...(email ? { email } : {}),
    },
    select: { id: true, email: true, name: true, role: true },
  });

  res.json(updated);
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'currentPassword and newPassword are required' });
    return;
  }

  if (newPassword.length < 8) {
    res.status(400).json({ error: 'New password must be at least 8 characters' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  res.json({ ok: true });
}

export async function me(req: Request, res: Response): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json(user);
}
