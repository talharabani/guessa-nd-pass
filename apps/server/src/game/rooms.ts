import { makeRoomCode } from './boards.js';
import { createGame } from './engine.js';
import type { GameConfig, GameState } from './types.js';

/**
 * Live match state lives here, in memory, because it changes many times per
 * second. Postgres is written only at match boundaries (see src/db).
 */
export interface Room {
  state: GameState;
  /** userId → the socket ids that user currently holds (multi-tab tolerant). */
  sockets: Map<string, Set<string>>;
  countdownTimer: NodeJS.Timeout | null;
  graceTimers: Map<string, NodeJS.Timeout>;
  lastActivity: number;
}

const rooms = new Map<string, Room>();
/** userId → roomCode, so a reconnecting player is put back where they were. */
const userRoom = new Map<string, string>();

export function createRoom(
  host: { userId: string; username: string },
  config?: Partial<GameConfig>
): Room {
  let code = makeRoomCode();
  while (rooms.has(code)) code = makeRoomCode();

  const room: Room = {
    state: createGame(code, host, config),
    sockets: new Map(),
    countdownTimer: null,
    graceTimers: new Map(),
    lastActivity: Date.now()
  };
  rooms.set(code, room);
  userRoom.set(host.userId, code);
  return room;
}

export const getRoom = (code: string): Room | undefined => rooms.get(code.toUpperCase());

export const roomOfUser = (userId: string): Room | undefined => {
  const code = userRoom.get(userId);
  return code ? rooms.get(code) : undefined;
};

export function bindUser(userId: string, code: string): void {
  userRoom.set(userId, code.toUpperCase());
}

export function attachSocket(room: Room, userId: string, socketId: string): void {
  const set = room.sockets.get(userId) ?? new Set<string>();
  set.add(socketId);
  room.sockets.set(userId, set);
  room.lastActivity = Date.now();
}

/** @returns true when that user has no sockets left (a real disconnect). */
export function detachSocket(room: Room, userId: string, socketId: string): boolean {
  const set = room.sockets.get(userId);
  if (!set) return true;
  set.delete(socketId);
  if (set.size === 0) {
    room.sockets.delete(userId);
    return true;
  }
  return false;
}

export function socketIdsFor(room: Room, userId: string): string[] {
  return [...(room.sockets.get(userId) ?? [])];
}

export function destroyRoom(code: string): void {
  const room = rooms.get(code);
  if (!room) return;
  if (room.countdownTimer) clearInterval(room.countdownTimer);
  for (const t of room.graceTimers.values()) clearTimeout(t);
  for (const p of room.state.players) userRoom.delete(p.userId);
  rooms.delete(code);
}

/** Housekeeping: drop rooms nobody has touched in a while. */
export function sweepRooms(maxIdleMs = 2 * 60 * 60_000): number {
  const cutoff = Date.now() - maxIdleMs;
  let removed = 0;
  for (const [code, room] of rooms) {
    if (room.sockets.size === 0 && room.lastActivity < cutoff) {
      destroyRoom(code);
      removed++;
    }
  }
  return removed;
}

export const roomCount = (): number => rooms.size;
