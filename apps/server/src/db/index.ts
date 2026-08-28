import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { databaseUrl, env, usingDatabase } from '../env.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Persistence boundary.

   Postgres via Prisma when DATABASE_URL is set; an in-memory store otherwise so
   the game is runnable and testable without provisioning a database. Everything
   above this file talks to `repo` and never to Prisma directly.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: Date;
}

export interface FinishedGameInput {
  gameId: string;
  winnerId: string | null;
  rounds: number;
  players: {
    userId: string;
    seat: number;
    progress: number;
    tokensFound: number;
    boardTokens: string[];
    completedTokens: string[];
  }[];
}

export interface GameSummary {
  id: string;
  roomCode: string;
  status: string;
  winnerId: string | null;
  createdAt: Date;
  finishedAt: Date | null;
  players: { userId: string; username: string; seat: number; progress: number }[];
}

export interface Repository {
  kind: 'postgres' | 'memory';
  /** Case-insensitive: "Talha" and "talha" are the same account. */
  findUserByUsername(username: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  createUser(username: string, passwordHash: string): Promise<UserRecord>;
  createGame(input: {
    roomCode: string;
    hostId: string;
    boxCount: number;
    boardSize: number;
    contentType: string;
  }): Promise<string>;
  addGamePlayer(gameId: string, userId: string, seat: number, boardTokens: string[]): Promise<void>;
  markGameInProgress(gameId: string): Promise<void>;
  finishGame(input: FinishedGameInput): Promise<void>;
  abandonGame(gameId: string): Promise<void>;
  recentGamesForUser(userId: string, limit?: number): Promise<GameSummary[]>;
  disconnect(): Promise<void>;
}

/* ───────────────────────────── in-memory store ───────────────────────────── */

/**
 * Where the dev store keeps accounts between restarts. Matches are NOT written
 * here — they are ephemeral by nature and would be stale on boot anyway.
 *
 * This exists because losing every account on each server restart makes local
 * development miserable: you register, restart, and can no longer sign in.
 * Production uses Postgres and never touches this.
 *
 * Memory-first: the file is read ONCE at boot and thereafter only written. That
 * means editing or deleting it while the server runs has no effect — the running
 * process still holds every account and rewrites them on the next sign-up. Stop
 * the server before clearing it.
 */
const USERS_FILE = resolve(process.cwd(), '.data', 'users.json');
const persistUsers = env.NODE_ENV !== 'test';

function readUsersFile(): UserRecord[] {
  if (!persistUsers) return [];
  try {
    const raw = readFileSync(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as (Omit<UserRecord, 'createdAt'> & { createdAt: string })[];
    return parsed.map((u) => ({ ...u, createdAt: new Date(u.createdAt) }));
  } catch {
    return []; // no file yet, or unreadable — start empty
  }
}

function writeUsersFile(users: UserRecord[]): void {
  if (!persistUsers) return;
  try {
    mkdirSync(dirname(USERS_FILE), { recursive: true });
    writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  } catch (err) {
    console.error('could not persist dev accounts', err);
  }
}

function memoryRepo(): Repository {
  const users = new Map<string, UserRecord>();
  const byName = new Map<string, string>();

  for (const user of readUsersFile()) {
    users.set(user.id, user);
    byName.set(user.username.toLowerCase(), user.id);
  }
  if (users.size > 0) console.log(`▸ restored ${users.size} local account(s) from .data/users.json`);
  type MemGame = GameSummary & { boxCount: number; rounds: number; hostId: string };
  const games = new Map<string, MemGame>();
  const names = (id: string) => users.get(id)?.username ?? 'PLAYER';

  return {
    kind: 'memory',
    async findUserByUsername(username) {
      const id = byName.get(username.trim().toLowerCase());
      return id ? (users.get(id) ?? null) : null;
    },
    async findUserById(id) {
      return users.get(id) ?? null;
    },
    async createUser(username, passwordHash) {
      const user: UserRecord = { id: randomUUID(), username, passwordHash, createdAt: new Date() };
      users.set(user.id, user);
      byName.set(username.toLowerCase(), user.id);
      writeUsersFile([...users.values()]);
      return user;
    },
    async createGame({ roomCode, hostId, boxCount }) {
      const id = randomUUID();
      games.set(id, {
        id,
        roomCode,
        status: 'WAITING_FOR_PLAYER',
        winnerId: null,
        createdAt: new Date(),
        finishedAt: null,
        players: [],
        boxCount,
        rounds: 0,
        hostId
      });
      return id;
    },
    async addGamePlayer(gameId, userId, seat) {
      const g = games.get(gameId);
      if (!g) return;
      if (!g.players.some((p) => p.userId === userId)) {
        g.players.push({ userId, username: names(userId), seat, progress: 0 });
      }
    },
    async markGameInProgress(gameId) {
      const g = games.get(gameId);
      if (g) g.status = 'IN_PROGRESS';
    },
    async finishGame({ gameId, winnerId, rounds, players }) {
      const g = games.get(gameId);
      if (!g) return;
      g.status = 'FINISHED';
      g.winnerId = winnerId;
      g.finishedAt = new Date();
      g.rounds = rounds;
      g.players = players.map((p) => ({
        userId: p.userId,
        username: names(p.userId),
        seat: p.seat,
        progress: p.progress
      }));
    },
    async abandonGame(gameId) {
      const g = games.get(gameId);
      if (g && g.status !== 'FINISHED') g.status = 'ABANDONED';
    },
    async recentGamesForUser(userId, limit = 10) {
      return [...games.values()]
        .filter((g) => g.players.some((p) => p.userId === userId))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);
    },
    async disconnect() {
      /* nothing to close */
    }
  };
}

/* ─────────────────────────────── prisma store ────────────────────────────── */

async function prismaRepo(): Promise<Repository> {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  return {
    kind: 'postgres',
    async findUserByUsername(username) {
      // Matched on the normalised column, never on the display name — otherwise
      // signing in with different capitalisation would look like a wrong password.
      return prisma.user.findUnique({ where: { usernameLower: username.trim().toLowerCase() } });
    },
    async findUserById(id) {
      return prisma.user.findUnique({ where: { id } });
    },
    async createUser(username, passwordHash) {
      return prisma.user.create({
        data: { username, usernameLower: username.toLowerCase(), passwordHash }
      });
    },
    async createGame({ roomCode, hostId, boxCount, boardSize, contentType }) {
      const game = await prisma.game.create({
        data: { roomCode, hostId, boxCount, boardSize, contentType: contentType as never }
      });
      return game.id;
    },
    async addGamePlayer(gameId, userId, seat, boardTokens) {
      await prisma.gamePlayer.upsert({
        where: { gameId_userId: { gameId, userId } },
        update: { seat, boardTokens },
        create: { gameId, userId, seat, boardTokens }
      });
    },
    async markGameInProgress(gameId) {
      await prisma.game.update({ where: { id: gameId }, data: { status: 'IN_PROGRESS' } });
    },
    async finishGame({ gameId, winnerId, rounds, players }) {
      // One transaction at the end of the match — not one write per box tap.
      await prisma.$transaction([
        prisma.game.update({
          where: { id: gameId },
          data: { status: 'FINISHED', winnerId, rounds, finishedAt: new Date() }
        }),
        ...players.map((p) =>
          prisma.gamePlayer.update({
            where: { gameId_userId: { gameId, userId: p.userId } },
            data: {
              progress: p.progress,
              tokensFound: p.tokensFound,
              boardTokens: p.boardTokens,
              completedTokens: p.completedTokens
            }
          })
        )
      ]);
    },
    async abandonGame(gameId) {
      await prisma.game
        .update({ where: { id: gameId }, data: { status: 'ABANDONED', finishedAt: new Date() } })
        .catch(() => undefined);
    },
    async recentGamesForUser(userId, limit = 10) {
      // Shape is only as precise as the generated client; before `prisma
      // generate` runs there are no row types to reference, so name it here.
      type Row = Omit<GameSummary, 'players'> & {
        players: { userId: string; seat: number; progress: number; user: { username: string } }[];
      };
      const rows = (await prisma.game.findMany({
        where: { players: { some: { userId } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: { players: { include: { user: true } } }
      })) as unknown as Row[];
      return rows.map((g) => ({
        id: g.id,
        roomCode: g.roomCode,
        status: g.status,
        winnerId: g.winnerId,
        createdAt: g.createdAt,
        finishedAt: g.finishedAt,
        players: g.players.map((p) => ({
          userId: p.userId,
          username: p.user.username,
          seat: p.seat,
          progress: p.progress
        }))
      }));
    },
    async disconnect() {
      await prisma.$disconnect();
    }
  };
}

export const repo: Repository = usingDatabase ? await prismaRepo() : memoryRepo();

if (repo.kind === 'memory') {
  console.warn(
    '⚠ DATABASE_URL not set — running the local store. Accounts persist to .data/users.json; matches do not.'
  );
}
