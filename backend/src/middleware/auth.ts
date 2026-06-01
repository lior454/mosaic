import { Request, Response, NextFunction } from 'express';
import { createClerkClient } from '@clerk/clerk-sdk-node';
import { query } from '../db';

export interface AuthRequest extends Request {
  userId?: string;
  dbUserId?: string;
}

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = await clerk.verifyToken(token);
    req.userId = payload.sub;

    const users = await query<{ id: string }>(
      'SELECT id FROM users WHERE clerk_id = $1',
      [payload.sub]
    );
    if (!users.length) {
      return res.status(401).json({ error: 'User not found' });
    }
    req.dbUserId = users[0].id;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
