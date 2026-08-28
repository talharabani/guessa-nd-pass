import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { repo, type UserRecord } from '../db/index.js';
import { env } from '../env.js';

export const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters.')
    .max(16, 'Username must be at most 16 characters.')
    .regex(/^[A-Za-z0-9_]+$/, 'Letters, numbers and underscore only.'),
  password: z.string().min(6, 'Password must be at least 6 characters.').max(72)
});

export type Credentials = z.infer<typeof credentialsSchema>;

export interface AuthPayload {
  sub: string;
  username: string;
}

export interface PublicUser {
  id: string;
  username: string;
}

const publicUser = (u: UserRecord): PublicUser => ({ id: u.id, username: u.username });

export function signToken(user: UserRecord): string {
  const payload: AuthPayload = { sub: user.id, username: user.username };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (typeof decoded === 'string') return null;
    const { sub, username } = decoded as jwt.JwtPayload & Partial<AuthPayload>;
    if (typeof sub !== 'string' || typeof username !== 'string') return null;
    return { sub, username };
  } catch {
    return null;
  }
}

export type AuthErrorCode = 'USERNAME_TAKEN' | 'BAD_CREDENTIALS' | 'INVALID_INPUT';

export class AuthError extends Error {
  constructor(
    override readonly message: string,
    readonly status = 400,
    /** Lets the UI react to *why* it failed without matching on prose. */
    readonly code: AuthErrorCode = 'INVALID_INPUT'
  ) {
    super(message);
  }
}

export async function register(input: Credentials): Promise<{ user: PublicUser; token: string }> {
  const existing = await repo.findUserByUsername(input.username);
  if (existing) throw new AuthError('That username is already taken.', 409, 'USERNAME_TAKEN');

  const passwordHash = await bcrypt.hash(input.password, 10);
  const user = await repo.createUser(input.username, passwordHash);
  return { user: publicUser(user), token: signToken(user) };
}

export async function login(input: Credentials): Promise<{ user: PublicUser; token: string }> {
  const user = await repo.findUserByUsername(input.username);
  // Same message either way — don't leak which usernames exist.
  const invalid = new AuthError('Incorrect username or password.', 401, 'BAD_CREDENTIALS');
  if (!user) {
    await bcrypt.compare(input.password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
    throw invalid;
  }
  const okPassword = await bcrypt.compare(input.password, user.passwordHash);
  if (!okPassword) throw invalid;
  return { user: publicUser(user), token: signToken(user) };
}

export async function currentUser(token: string): Promise<PublicUser | null> {
  const payload = verifyToken(token);
  if (!payload) return null;
  const user = await repo.findUserById(payload.sub);
  return user ? publicUser(user) : null;
}
