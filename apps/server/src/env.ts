import 'dotenv/config';
import { z } from 'zod';

/** A key left blank in .env means "not configured", not "invalid". */
const blankAsUndefined = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), inner);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  /** Postgres connection string. Leave blank in local dev for the in-memory store. */
  DATABASE_URL: blankAsUndefined(z.string().url().optional()),

  /** Must be set in production — the server refuses to boot without it. */
  JWT_SECRET: z.string().min(16).default('dev-only-insecure-secret-change-me'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  /** Comma-separated list of allowed browser origins (the Vercel URL in prod). */
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  FRONTEND_URL: z.string().default('http://localhost:3000')
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('✖ Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export const corsOrigins = env.CORS_ORIGIN.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (env.NODE_ENV === 'production') {
  if (env.JWT_SECRET === 'dev-only-insecure-secret-change-me') {
    console.error('✖ JWT_SECRET must be set in production.');
    process.exit(1);
  }
  if (!env.DATABASE_URL) {
    console.error('✖ DATABASE_URL must be set in production.');
    process.exit(1);
  }
  if (corsOrigins.includes('*')) {
    console.error('✖ Wildcard CORS is not allowed in production.');
    process.exit(1);
  }
}

export const usingDatabase = Boolean(env.DATABASE_URL);
