# Deployment

Two services, one database:

```
Vercel (Next.js)  ──HTTPS + WebSocket──►  Render (Express + Socket.IO)  ──►  Postgres
```

The frontend is static-friendly and cheap to host anywhere. The backend must be a
long-lived Node process — Socket.IO connections cannot live on serverless
functions, which is why it goes to Render rather than Vercel.

---

## Why the backend is not on Vercel

Vercel runs serverless functions: they start per request, do not hold open
connections, and share no memory. This game needs the opposite — a long-lived
process holding WebSocket connections and the live match state for every room.
Put the frontend on Vercel and the backend on Render (or Railway / Fly / any host
that runs a persistent Node process).

Deploy the **backend first**: the frontend needs its URL at build time.

## 1. Database

Any managed Postgres works (Render Postgres, Neon, Supabase). You need one value:

```
DATABASE_URL=postgresql://user:password@host:5432/number_rush?sslmode=require
```

Neon and Supabase both require `sslmode=require`. Render's internal URL does not.

The schema migration is already committed at
`apps/server/prisma/migrations/`, so there is nothing to generate — the deploy
runs `prisma migrate deploy` and applies it to an empty database. You only need
`prisma migrate dev` later, when you change `schema.prisma`.

---

## 2. Backend → Render

**Blueprint (recommended):** Render → New → Blueprint → select this repo. It reads
[render.yaml](render.yaml) and provisions the web service and the database together.

**Manual setup:** New → Web Service, then:

| Setting | Value |
| --- | --- |
| Root directory | `apps/server` |
| Build command | `npm install && npx prisma generate && npx prisma migrate deploy && npm run build` |
| Start command | `npm run start` |
| Health check path | `/health` |

Environment variables:

| Key | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | your Postgres URL |
| `JWT_SECRET` | 48+ random bytes — `openssl rand -base64 48` |
| `JWT_EXPIRES_IN` | `7d` |
| `CORS_ORIGIN` | your Vercel URL, e.g. `https://number-rush.vercel.app` |
| `FRONTEND_URL` | same as above |

Do **not** set `PORT` yourself — Render injects it and the server reads it.

The server refuses to boot in production if `JWT_SECRET` is still the dev default,
if `DATABASE_URL` is missing, or if `CORS_ORIGIN` contains `*`. That is deliberate:
a misconfigured deploy should fail loudly, not run insecurely.

> **Free tier warning.** Render's free instances sleep after inactivity. A sleeping
> backend drops every socket, so the first player to arrive waits ~30s for a cold
> start. Use `starter` or above for anything real.

---

## 3. Frontend → Vercel

Vercel → **Add New… → Project** → import `talharabani/guessa-nd-pass`:

| Setting | Value |
| --- | --- |
| **Root Directory** | `apps/web` ← the one setting people miss |
| Framework preset | Next.js (auto-detected) |
| Build command | leave default |
| Install command | leave default |

This is an npm workspace repo. Setting Root Directory to `apps/web` is what makes
Vercel build the frontend rather than the repo root — without it the build fails
with "No Next.js version detected".

Environment variable:

| Key | Value |
| --- | --- |
| `NEXT_PUBLIC_SERVER_URL` | your Render URL, e.g. `https://number-rush-server.onrender.com` |

`NEXT_PUBLIC_*` is inlined at build time, so **changing it requires a redeploy** —
setting it in the dashboard alone does nothing until the next build.

---

## 4. Wire the two together

The order matters, because each side needs the other's URL:

1. Deploy the backend. Copy its URL.
2. Deploy the frontend with `NEXT_PUBLIC_SERVER_URL` set to that URL. Copy the Vercel URL.
3. Set `CORS_ORIGIN` and `FRONTEND_URL` on Render to the Vercel URL. Render restarts.
4. Open the Vercel URL, register, and check `/health` on the backend shows
   `"store":"postgres"`.

For preview deployments, add the preview domain to `CORS_ORIGIN` as a
comma-separated list:

```
CORS_ORIGIN=https://number-rush.vercel.app,https://number-rush-git-dev-you.vercel.app
```

---

## 5. Verifying a live deploy

```bash
curl https://<render-url>/health
# {"ok":true,"store":"postgres","rooms":0,"uptime":12.3}
```

If `store` says `memory`, `DATABASE_URL` did not reach the process.

Then open the site in two different browsers (not two tabs of one — you need two
accounts), register both, create a game in one, join with the code in the other.
If the lobby updates without a refresh, sockets and CORS are both correct.

### Common failures

| Symptom | Cause |
| --- | --- |
| `connect_error: UNAUTHENTICATED` | Token missing or `JWT_SECRET` changed between deploys — sign in again. |
| Socket connects then immediately drops | `CORS_ORIGIN` does not exactly match the browser's origin (scheme + host, no trailing slash). |
| Everything works locally, nothing in prod | `NEXT_PUBLIC_SERVER_URL` was set after the build — redeploy the frontend. |
| Long pause on first load | Free-tier Render cold start. |
| `store: memory` in production | The server would have refused to boot; you are looking at a stale instance. |

---

## Scaling note

Match state lives in the memory of one server process, so the backend runs as a
**single instance**. Two instances would each hold their own rooms and players
would land in different games. To scale horizontally you would add the Socket.IO
Redis adapter and move room state into Redis — the engine
(`apps/server/src/game/engine.ts`) is pure and would not need to change.
