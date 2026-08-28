import { createServer } from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import { authRouter } from './auth/routes.js';
import { repo } from './db/index.js';
import { corsOrigins, env } from './env.js';
import { roomCount, sweepRooms } from './game/rooms.js';
import { registerSockets } from './sockets/index.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // Render sits behind a proxy
  app.use(express.json({ limit: '16kb' }));
  app.use(
    cors({
      origin: corsOrigins.length === 1 && corsOrigins[0] === '*' ? true : corsOrigins,
      credentials: true
    })
  );

  app.get('/health', (_req, res) =>
    res.json({ ok: true, store: repo.kind, rooms: roomCount(), uptime: process.uptime() })
  );
  app.use('/api/auth', authRouter);

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: corsOrigins.length === 1 && corsOrigins[0] === '*' ? true : corsOrigins, credentials: true },
    // Prefer websockets; fall back to polling on hostile networks.
    transports: ['websocket', 'polling'],
    pingInterval: 10_000,
    pingTimeout: 20_000
  });
  registerSockets(io);

  return { app, httpServer, io };
}

// Only listen when run directly — tests import createApp() instead.
const isEntrypoint = process.argv[1]?.replace(/\\/g, '/').endsWith('/src/index.ts')
  || process.argv[1]?.replace(/\\/g, '/').endsWith('/dist/index.js');

if (isEntrypoint) {
  const { httpServer } = createApp();
  const sweeper = setInterval(() => sweepRooms(), 30 * 60_000);

  httpServer.listen(env.PORT, () => {
    console.log(`▸ Number Rush server on :${env.PORT}  [${env.NODE_ENV}, store=${repo.kind}]`);
    console.log(`▸ CORS origins: ${corsOrigins.join(', ')}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} — shutting down`);
    clearInterval(sweeper);
    httpServer.close();
    await repo.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
