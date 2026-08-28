import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { repo } from '../db/index.js';
import { AuthError, credentialsSchema, currentUser, login, register } from './service.js';

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' }
});

export const bearer = (req: Request): string | null => {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
};

export const authRouter: Router = Router();

authRouter.post('/register', authLimiter, async (req: Request, res: Response) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input.' });
  }
  try {
    res.status(201).json(await register(parsed.data));
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    console.error('register failed', err);
    res.status(500).json({ error: 'Could not create your account.' });
  }
});

authRouter.post('/login', authLimiter, async (req: Request, res: Response) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Incorrect username or password.', code: 'BAD_CREDENTIALS' });
  }
  try {
    res.json(await login(parsed.data));
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    console.error('login failed', err);
    res.status(500).json({ error: 'Could not sign you in.' });
  }
});

authRouter.get('/me', async (req: Request, res: Response) => {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'Not signed in.' });
  const user = await currentUser(token);
  if (!user) return res.status(401).json({ error: 'Session expired.' });
  res.json({ user });
});

authRouter.get('/history', async (req: Request, res: Response) => {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'Not signed in.' });
  const user = await currentUser(token);
  if (!user) return res.status(401).json({ error: 'Session expired.' });
  res.json({ games: await repo.recentGamesForUser(user.id, 10) });
});
