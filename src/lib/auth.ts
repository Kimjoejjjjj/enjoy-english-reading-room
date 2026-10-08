// src/lib/auth.ts
import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';
import { getJwtSecret, isLoginEmailAllowed } from '@/lib/auth-config';

const JWT_EXPIRES_IN = '7d';

export interface JwtPayload {
  userId: string;
  email: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const payload = jwt.verify(token, getJwtSecret()) as JwtPayload;
    if (process.env.NODE_ENV === 'production' && !isLoginEmailAllowed(payload.email)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Extract and verify userId from the JWT cookie in an API request. */
export function getUserId(req: NextRequest): string | null {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  const payload = verifyToken(token);
  return payload?.userId ?? null;
}
