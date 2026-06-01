# Mosaic Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build Mosaic — a multi-angle event video sharing platform where guests upload media from their phones and event owners edit a final video from multiple angles on a web dashboard.

**Architecture:** Three separate packages in a monorepo: `backend` (Node.js/Express/PostgreSQL), `web` (Next.js dashboard for event owners), `mobile` (React Native/Expo for participants). Media flows directly from phone → Cloudflare R2 via signed URLs. Backend stores only metadata. FFmpeg renders the final video server-side from a `timeline_json` descriptor.

**Tech Stack:** Node.js + Express + PostgreSQL (Neon) + BullMQ (Upstash Redis) + Cloudflare R2 + FFmpeg + Next.js + TailwindCSS + React Native + Expo + Clerk (auth)

---

## Task 1: Monorepo Scaffold

**Files:**
- Create: `package.json` (root)
- Create: `backend/package.json`
- Create: `web/package.json`
- Create: `mobile/package.json`
- Create: `.gitignore`
- Create: `.env.example`

**Step 1: Initialize monorepo with npm workspaces**

```bash
cd C:\Users\Lior\Desktop\Mosaic
```

Create root `package.json`:
```json
{
  "name": "mosaic",
  "private": true,
  "workspaces": ["backend", "web", "mobile"]
}
```

**Step 2: Create .gitignore**

```
node_modules/
.env
.env.local
dist/
build/
.expo/
*.log
```

**Step 3: Create .env.example**

```
# Database
DATABASE_URL=postgresql://user:pass@host/mosaic

# Cloudflare R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=mosaic-media
R2_PUBLIC_URL=

# Clerk Auth
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_WEBHOOK_SECRET=

# Redis (Upstash)
REDIS_URL=

# App
BACKEND_URL=http://localhost:3001
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

**Step 4: Commit**

```bash
git add .
git commit -m "feat: monorepo scaffold with workspace structure"
```

---

## Task 2: Backend — Project Setup

**Files:**
- Create: `backend/package.json`
- Create: `backend/src/index.ts`
- Create: `backend/src/db/schema.sql`
- Create: `backend/tsconfig.json`

**Step 1: Initialize backend**

```bash
cd backend
npm init -y
npm install express cors helmet express-rate-limit dotenv @clerk/clerk-sdk-node
npm install pg drizzle-orm
npm install bullmq ioredis
npm install aws-sdk @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
npm install -D typescript @types/express @types/node @types/cors @types/pg ts-node nodemon
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create backend/src/index.ts**

```typescript
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
app.use(express.json({ limit: '10kb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));

export default app;
```

**Step 4: Add scripts to backend/package.json**

```json
{
  "scripts": {
    "dev": "nodemon --exec ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

**Step 5: Run and verify**

```bash
npm run dev
curl http://localhost:3001/health
```
Expected: `{"ok":true}`

**Step 6: Commit**

```bash
git add backend/
git commit -m "feat: backend express setup with security middleware"
```

---

## Task 3: Database Schema

**Files:**
- Create: `backend/src/db/schema.sql`
- Create: `backend/src/db/index.ts`
- Create: `backend/src/db/migrate.ts`

**Step 1: Write schema.sql**

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clerk_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  qr_code TEXT UNIQUE NOT NULL,
  invite_link TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','live','ended')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE event_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clock_delta_ms INTEGER NOT NULL DEFAULT 0,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, user_id)
);

CREATE TABLE media_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  uploader_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  raw_timestamp TIMESTAMPTZ,
  synced_timestamp TIMESTAMPTZ,
  type TEXT NOT NULL CHECK (type IN ('photo','video')),
  duration_ms INTEGER,
  width INTEGER,
  height INTEGER,
  file_size_bytes BIGINT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','uploaded','approved','rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE edit_projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID UNIQUE NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  timeline_json JSONB NOT NULL DEFAULT '{"clips":[]}',
  auto_generated BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE export_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  r2_key TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_events_owner ON events(owner_id);
CREATE INDEX idx_events_location ON events(lat, lng);
CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_media_event ON media_items(event_id);
CREATE INDEX idx_media_synced_timestamp ON media_items(event_id, synced_timestamp);
CREATE INDEX idx_participants_event ON event_participants(event_id);
```

**Step 2: Create backend/src/db/index.ts**

```typescript
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}
```

**Step 3: Create backend/src/db/migrate.ts**

```typescript
import { pool } from './index';
import fs from 'fs';
import path from 'path';

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  await pool.query(sql);
  console.log('Migration complete');
  await pool.end();
}

migrate().catch(console.error);
```

**Step 4: Run migration**

```bash
ts-node src/db/migrate.ts
```
Expected: `Migration complete`

**Step 5: Commit**

```bash
git add backend/src/db/
git commit -m "feat: PostgreSQL schema — events, participants, media, edit projects"
```

---

## Task 4: Auth Middleware + User Sync

**Files:**
- Create: `backend/src/middleware/auth.ts`
- Create: `backend/src/routes/webhooks.ts`
- Modify: `backend/src/index.ts`

**Step 1: Create auth middleware**

```typescript
// backend/src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import { clerkClient, createClerkClient } from '@clerk/clerk-sdk-node';
import { query } from '../db';

export interface AuthRequest extends Request {
  userId?: string;
  dbUserId?: string;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = await clerkClient.verifyToken(token);
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
```

**Step 2: Create Clerk webhook to sync users**

```typescript
// backend/src/routes/webhooks.ts
import { Router, Request, Response } from 'express';
import { Webhook } from 'svix';
import { query } from '../db';

const router = Router();

router.post('/clerk', async (req: Request, res: Response) => {
  const wh = new Webhook(process.env.CLERK_WEBHOOK_SECRET!);
  let event: { type: string; data: { id: string; email_addresses: { email_address: string }[]; first_name?: string; last_name?: string } };

  try {
    event = wh.verify(JSON.stringify(req.body), {
      'svix-id': req.headers['svix-id'] as string,
      'svix-timestamp': req.headers['svix-timestamp'] as string,
      'svix-signature': req.headers['svix-signature'] as string,
    }) as typeof event;
  } catch {
    return res.status(400).json({ error: 'Invalid webhook' });
  }

  if (event.type === 'user.created' || event.type === 'user.updated') {
    const { id, email_addresses, first_name, last_name } = event.data;
    const email = email_addresses[0]?.email_address;
    const name = [first_name, last_name].filter(Boolean).join(' ') || null;

    await query(
      `INSERT INTO users (clerk_id, email, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (clerk_id) DO UPDATE SET email = $2, name = $3`,
      [id, email, name]
    );
  }

  res.json({ ok: true });
});

export default router;
```

**Step 3: Wire up in index.ts**

```typescript
import webhookRoutes from './routes/webhooks';
// add before other routes:
app.use('/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);
```

**Step 4: Commit**

```bash
git add backend/src/middleware/ backend/src/routes/webhooks.ts backend/src/index.ts
git commit -m "feat: Clerk auth middleware and user sync webhook"
```

---

## Task 5: Events API

**Files:**
- Create: `backend/src/routes/events.ts`
- Modify: `backend/src/index.ts`

**Step 1: Create events router**

```typescript
// backend/src/routes/events.ts
import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { query } from '../db';

const router = Router();

// POST /events — create event
router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const { name, start_time, end_time, lat, lng } = req.body;
  if (!name || !start_time || !end_time) {
    return res.status(400).json({ error: 'name, start_time, end_time required' });
  }

  const qr_code = uuidv4();
  const invite_link = uuidv4();

  const [event] = await query<{ id: string }>(
    `INSERT INTO events (owner_id, name, start_time, end_time, lat, lng, qr_code, invite_link)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.dbUserId, name, start_time, end_time, lat ?? null, lng ?? null, qr_code, invite_link]
  );

  res.status(201).json(event);
});

// GET /events — list owner's events
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const events = await query(
    'SELECT * FROM events WHERE owner_id = $1 ORDER BY start_time DESC',
    [req.dbUserId]
  );
  res.json(events);
});

// GET /events/nearby — find events near location
router.get('/nearby', requireAuth, async (req: AuthRequest, res: Response) => {
  const { lat, lng, radius = 500 } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  // Haversine approximation: 1 degree lat ≈ 111km
  const latDelta = Number(radius) / 111000;
  const lngDelta = Number(radius) / (111000 * Math.cos(Number(lat) * Math.PI / 180));

  const events = await query(
    `SELECT * FROM events
     WHERE status IN ('upcoming','live')
       AND lat BETWEEN $1 AND $2
       AND lng BETWEEN $3 AND $4
       AND start_time <= NOW() + INTERVAL '2 hours'
       AND end_time >= NOW()`,
    [Number(lat) - latDelta, Number(lat) + latDelta, Number(lng) - lngDelta, Number(lng) + lngDelta]
  );
  res.json(events);
});

// POST /events/:id/join — participant joins event
router.post('/:id/join', requireAuth, async (req: AuthRequest, res: Response) => {
  const { device_time } = req.body;
  const serverTime = Date.now();
  const clockDelta = device_time ? serverTime - Number(device_time) : 0;

  await query(
    `INSERT INTO event_participants (event_id, user_id, clock_delta_ms)
     VALUES ($1, $2, $3)
     ON CONFLICT (event_id, user_id) DO UPDATE SET clock_delta_ms = $3`,
    [req.params.id, req.dbUserId, clockDelta]
  );

  const [event] = await query('SELECT * FROM events WHERE id = $1', [req.params.id]);
  res.json({ event, clock_delta_ms: clockDelta });
});

// GET /events/join/:invite_link — get event by invite link
router.get('/join/:invite_link', requireAuth, async (req: AuthRequest, res: Response) => {
  const [event] = await query(
    'SELECT * FROM events WHERE invite_link = $1 OR qr_code = $1',
    [req.params.invite_link]
  );
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json(event);
});

export default router;
```

**Step 2: Register in index.ts**

```typescript
import eventRoutes from './routes/events';
app.use('/api/events', eventRoutes);
```

**Step 3: Manual test**

```bash
# create event (replace TOKEN with a Clerk JWT)
curl -X POST http://localhost:3001/api/events \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Party","start_time":"2026-06-01T18:00:00Z","end_time":"2026-06-01T23:00:00Z","lat":32.08,"lng":34.78}'
```
Expected: `{"id":"...","name":"Test Party",...}`

**Step 4: Commit**

```bash
git add backend/src/routes/events.ts backend/src/index.ts
git commit -m "feat: events API — create, list, nearby, join with clock delta"
```

---

## Task 6: Media Upload API (Signed URLs)

**Files:**
- Create: `backend/src/lib/r2.ts`
- Create: `backend/src/routes/media.ts`
- Modify: `backend/src/index.ts`

**Step 1: Create R2 client**

```typescript
// backend/src/lib/r2.ts
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand } from '@aws-sdk/client-s3';

export const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export async function getUploadUrl(key: string, contentType: string): Promise<string> {
  return getSignedUrl(
    r2,
    new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key, ContentType: contentType }),
    { expiresIn: 900 } // 15 minutes
  );
}

export async function getDownloadUrl(key: string): Promise<string> {
  return getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key }),
    { expiresIn: 900 }
  );
}
```

**Step 2: Create media router**

```typescript
// backend/src/routes/media.ts
import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { query } from '../db';
import { getUploadUrl, getDownloadUrl } from '../lib/r2';

const router = Router();

// POST /media/upload-url — get signed URL for direct upload
router.post('/upload-url', requireAuth, async (req: AuthRequest, res: Response) => {
  const { event_id, type, content_type, raw_timestamp, duration_ms, width, height, file_size_bytes } = req.body;

  if (!event_id || !type || !content_type) {
    return res.status(400).json({ error: 'event_id, type, content_type required' });
  }

  // Verify participant is in event
  const [participant] = await query(
    'SELECT clock_delta_ms FROM event_participants WHERE event_id = $1 AND user_id = $2',
    [event_id, req.dbUserId]
  );
  if (!participant) return res.status(403).json({ error: 'Not a participant of this event' });

  const ext = content_type.split('/')[1] || 'bin';
  const r2_key = `events/${event_id}/${uuidv4()}.${ext}`;

  // Compute synced timestamp
  const rawTs = raw_timestamp ? new Date(raw_timestamp) : null;
  const syncedTs = rawTs
    ? new Date(rawTs.getTime() - (participant as { clock_delta_ms: number }).clock_delta_ms)
    : null;

  const [media] = await query<{ id: string }>(
    `INSERT INTO media_items
       (event_id, uploader_id, r2_key, raw_timestamp, synced_timestamp, type, duration_ms, width, height, file_size_bytes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [event_id, req.dbUserId, r2_key, rawTs, syncedTs, type, duration_ms ?? null, width ?? null, height ?? null, file_size_bytes ?? null]
  );

  const upload_url = await getUploadUrl(r2_key, content_type);
  res.json({ media_id: media.id, upload_url, r2_key });
});

// POST /media/:id/confirm — mark upload as complete
router.post('/:id/confirm', requireAuth, async (req: AuthRequest, res: Response) => {
  await query(
    `UPDATE media_items SET status = 'uploaded'
     WHERE id = $1 AND uploader_id = $2`,
    [req.params.id, req.dbUserId]
  );
  res.json({ ok: true });
});

// GET /media/event/:event_id — list media for event (owner only)
router.get('/event/:event_id', requireAuth, async (req: AuthRequest, res: Response) => {
  const [event] = await query(
    'SELECT id FROM events WHERE id = $1 AND owner_id = $2',
    [req.params.event_id, req.dbUserId]
  );
  if (!event) return res.status(403).json({ error: 'Not your event' });

  const items = await query(
    `SELECT * FROM media_items
     WHERE event_id = $1 AND status = 'uploaded'
     ORDER BY synced_timestamp ASC NULLS LAST`,
    [req.params.event_id]
  );

  // Attach signed download URLs
  const withUrls = await Promise.all(
    (items as { r2_key: string }[]).map(async (item) => ({
      ...item,
      download_url: await getDownloadUrl(item.r2_key),
    }))
  );

  res.json(withUrls);
});

export default router;
```

**Step 3: Register in index.ts**

```typescript
import mediaRoutes from './routes/media';
app.use('/api/media', mediaRoutes);
```

**Step 4: Commit**

```bash
git add backend/src/lib/r2.ts backend/src/routes/media.ts backend/src/index.ts
git commit -m "feat: media upload API with R2 signed URLs and clock-delta sync"
```

---

## Task 7: Auto-Generate Video + Export Queue

**Files:**
- Create: `backend/src/lib/queue.ts`
- Create: `backend/src/workers/auto-generate.ts`
- Create: `backend/src/workers/export.ts`
- Create: `backend/src/routes/export.ts`
- Modify: `backend/src/index.ts`

**Step 1: Create queue**

```typescript
// backend/src/lib/queue.ts
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

export const autoGenerateQueue = new Queue('auto-generate', { connection });
export const exportQueue = new Queue('export', { connection });
```

**Step 2: Create auto-generate worker**

```typescript
// backend/src/workers/auto-generate.ts
import { Worker } from 'bullmq';
import { connection } from '../lib/queue';
import { query } from '../db';

new Worker('auto-generate', async (job) => {
  const { event_id } = job.data;

  // Get all uploaded media ordered by synced_timestamp
  const items = await query<{
    id: string; synced_timestamp: string; type: string; duration_ms: number;
  }>(
    `SELECT id, synced_timestamp, type, duration_ms
     FROM media_items
     WHERE event_id = $1 AND status = 'uploaded'
     ORDER BY synced_timestamp ASC NULLS LAST`,
    [event_id]
  );

  if (!items.length) return;

  // Build timeline: group clips by 3-second windows, pick one per window
  const WINDOW_MS = 3000;
  const clips: object[] = [];
  const used = new Set<string>();

  for (const item of items) {
    if (used.has(item.id)) continue;
    const ts = new Date(item.synced_timestamp).getTime();

    // Find alternatives within ±3 seconds
    const alternatives = items.filter(
      (other) =>
        other.id !== item.id &&
        Math.abs(new Date(other.synced_timestamp).getTime() - ts) <= WINDOW_MS
    );

    clips.push({
      media_item_id: item.id,
      synced_timestamp: item.synced_timestamp,
      duration: item.duration_ms || 3000,
      alternatives: alternatives.map((a) => ({ media_item_id: a.id, synced_timestamp: a.synced_timestamp })),
    });

    alternatives.forEach((a) => used.add(a.id));
    used.add(item.id);
  }

  await query(
    `INSERT INTO edit_projects (event_id, timeline_json, auto_generated)
     VALUES ($1, $2, true)
     ON CONFLICT (event_id) DO UPDATE
     SET timeline_json = $2, auto_generated = true, updated_at = NOW()`,
    [event_id, JSON.stringify({ clips })]
  );

  console.log(`Auto-generated timeline for event ${event_id}: ${clips.length} clips`);
}, { connection });
```

**Step 3: Create export worker (FFmpeg)**

```typescript
// backend/src/workers/export.ts
import { Worker } from 'bullmq';
import { connection } from '../lib/queue';
import { query } from '../db';
import { getDownloadUrl, getUploadUrl, r2 } from '../lib/r2';
import { execSync } from 'child_process';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import os from 'os';

new Worker('export', async (job) => {
  const { export_job_id, event_id } = job.data;

  await query(`UPDATE export_jobs SET status = 'processing' WHERE id = $1`, [export_job_id]);

  try {
    const [project] = await query<{ timeline_json: { clips: { media_item_id: string; duration: number }[] } }>(
      'SELECT timeline_json FROM edit_projects WHERE event_id = $1',
      [event_id]
    );

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-'));
    const listFile = path.join(tmpDir, 'list.txt');
    const outputFile = path.join(tmpDir, 'output.mp4');

    // Download each clip
    const lines: string[] = [];
    for (const clip of project.timeline_json.clips) {
      const [media] = await query<{ r2_key: string }>(
        'SELECT r2_key FROM media_items WHERE id = $1',
        [clip.media_item_id]
      );
      const url = await getDownloadUrl(media.r2_key);
      const localPath = path.join(tmpDir, `${clip.media_item_id}.mp4`);
      execSync(`curl -s -o "${localPath}" "${url}"`);
      lines.push(`file '${localPath}'`);
      lines.push(`duration ${(clip.duration / 1000).toFixed(3)}`);
    }

    fs.writeFileSync(listFile, lines.join('\n'));

    // Concatenate with FFmpeg
    execSync(`ffmpeg -f concat -safe 0 -i "${listFile}" -c copy "${outputFile}" -y`);

    // Upload result to R2
    const r2Key = `exports/${event_id}/final-${Date.now()}.mp4`;
    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: r2Key,
      Body: fs.readFileSync(outputFile),
      ContentType: 'video/mp4',
    }));

    await query(
      `UPDATE export_jobs SET status = 'done', r2_key = $1, completed_at = NOW() WHERE id = $2`,
      [r2Key, export_job_id]
    );

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  } catch (err) {
    await query(
      `UPDATE export_jobs SET status = 'failed', error = $1 WHERE id = $2`,
      [String(err), export_job_id]
    );
    throw err;
  }
}, { connection });
```

**Step 4: Create export route**

```typescript
// backend/src/routes/export.ts
import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { query } from '../db';
import { exportQueue } from '../lib/queue';
import { getDownloadUrl } from '../lib/r2';

const router = Router();

router.post('/:event_id', requireAuth, async (req: AuthRequest, res: Response) => {
  const [event] = await query(
    'SELECT id FROM events WHERE id = $1 AND owner_id = $2',
    [req.params.event_id, req.dbUserId]
  );
  if (!event) return res.status(403).json({ error: 'Not your event' });

  const [job] = await query<{ id: string }>(
    `INSERT INTO export_jobs (event_id) VALUES ($1) RETURNING id`,
    [req.params.event_id]
  );

  await exportQueue.add('export', { export_job_id: job.id, event_id: req.params.event_id });
  res.json({ export_job_id: job.id });
});

router.get('/:event_id/status', requireAuth, async (req: AuthRequest, res: Response) => {
  const [job] = await query<{ status: string; r2_key: string }>(
    `SELECT ej.* FROM export_jobs ej
     JOIN events e ON e.id = ej.event_id
     WHERE ej.event_id = $1 AND e.owner_id = $2
     ORDER BY ej.created_at DESC LIMIT 1`,
    [req.params.event_id, req.dbUserId]
  );
  if (!job) return res.status(404).json({ error: 'No export found' });

  const result: Record<string, unknown> = { ...job };
  if (job.status === 'done' && job.r2_key) {
    result.download_url = await getDownloadUrl(job.r2_key);
  }
  res.json(result);
});

export default router;
```

**Step 5: Register in index.ts**

```typescript
import exportRoutes from './routes/export';
app.use('/api/export', exportRoutes);
```

**Step 6: Commit**

```bash
git add backend/src/lib/queue.ts backend/src/workers/ backend/src/routes/export.ts backend/src/index.ts
git commit -m "feat: BullMQ workers for auto-generate timeline and FFmpeg export"
```

---

## Task 8: Edit Project API (Timeline Save)

**Files:**
- Create: `backend/src/routes/edit.ts`
- Modify: `backend/src/index.ts`

**Step 1: Create edit router**

```typescript
// backend/src/routes/edit.ts
import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { query } from '../db';

const router = Router();

// GET /edit/:event_id
router.get('/:event_id', requireAuth, async (req: AuthRequest, res: Response) => {
  const [event] = await query(
    'SELECT id FROM events WHERE id = $1 AND owner_id = $2',
    [req.params.event_id, req.dbUserId]
  );
  if (!event) return res.status(403).json({ error: 'Not your event' });

  const [project] = await query(
    'SELECT * FROM edit_projects WHERE event_id = $1',
    [req.params.event_id]
  );
  if (!project) return res.status(404).json({ error: 'No edit project yet' });
  res.json(project);
});

// PATCH /edit/:event_id — save timeline changes
router.patch('/:event_id', requireAuth, async (req: AuthRequest, res: Response) => {
  const [event] = await query(
    'SELECT id FROM events WHERE id = $1 AND owner_id = $2',
    [req.params.event_id, req.dbUserId]
  );
  if (!event) return res.status(403).json({ error: 'Not your event' });

  const { timeline_json } = req.body;
  if (!timeline_json) return res.status(400).json({ error: 'timeline_json required' });

  const [project] = await query(
    `UPDATE edit_projects
     SET timeline_json = $1, auto_generated = false, updated_at = NOW()
     WHERE event_id = $2 RETURNING *`,
    [JSON.stringify(timeline_json), req.params.event_id]
  );
  res.json(project);
});

export default router;
```

**Step 2: Register in index.ts**

```typescript
import editRoutes from './routes/edit';
app.use('/api/edit', editRoutes);
```

**Step 3: Commit**

```bash
git add backend/src/routes/edit.ts backend/src/index.ts
git commit -m "feat: edit project API — get and save timeline_json"
```

---

## Task 9: Web Dashboard — Next.js Setup

**Files:**
- Create: `web/` (Next.js app)

**Step 1: Initialize Next.js**

```bash
cd C:\Users\Lior\Desktop\Mosaic
npx create-next-app@latest web --typescript --tailwind --app --no-src-dir --import-alias "@/*"
cd web
npm install @clerk/nextjs axios
npm install @xzdarcy/react-timeline-editor
npm install react-qrcode-logo
```

**Step 2: Configure Clerk in web/middleware.ts**

```typescript
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)']);

export default clerkMiddleware((auth, req) => {
  if (!isPublicRoute(req)) auth().protect();
});

export const config = { matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'] };
```

**Step 3: Create web/app/layout.tsx with ClerkProvider**

```tsx
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="he" dir="rtl">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
```

**Step 4: Create API client web/lib/api.ts**

```typescript
import axios from 'axios';

export const api = axios.create({ baseURL: process.env.NEXT_PUBLIC_BACKEND_URL });

api.interceptors.request.use(async (config) => {
  // Token injected per-request from Clerk's useAuth hook — see components
  return config;
});
```

**Step 5: Commit**

```bash
git add web/
git commit -m "feat: Next.js web dashboard scaffold with Clerk auth"
```

---

## Task 10: Web Dashboard — Event Management Pages

**Files:**
- Create: `web/app/dashboard/page.tsx`
- Create: `web/app/dashboard/events/new/page.tsx`
- Create: `web/app/dashboard/events/[id]/page.tsx`
- Create: `web/components/EventCard.tsx`
- Create: `web/components/CreateEventForm.tsx`

**Step 1: Create dashboard home (event list)**

```tsx
// web/app/dashboard/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { api } from '@/lib/api';
import EventCard from '@/components/EventCard';
import Link from 'next/link';

export default function Dashboard() {
  const { getToken } = useAuth();
  const [events, setEvents] = useState([]);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      const res = await api.get('/api/events', { headers: { Authorization: `Bearer ${token}` } });
      setEvents(res.data);
    })();
  }, []);

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">האירועים שלי</h1>
        <Link href="/dashboard/events/new"
          className="bg-black text-white px-6 py-2 rounded-lg hover:bg-gray-800">
          + אירוע חדש
        </Link>
      </div>
      <div className="grid gap-4">
        {events.map((event: { id: string }) => <EventCard key={event.id} event={event} />)}
      </div>
    </div>
  );
}
```

**Step 2: Create EventCard component**

```tsx
// web/components/EventCard.tsx
import Link from 'next/link';

interface Event {
  id: string; name: string; start_time: string; end_time: string; status: string;
}

export default function EventCard({ event }: { event: Event }) {
  const statusColors: Record<string, string> = {
    upcoming: 'bg-blue-100 text-blue-800',
    live: 'bg-green-100 text-green-800',
    ended: 'bg-gray-100 text-gray-600',
  };

  return (
    <Link href={`/dashboard/events/${event.id}`}>
      <div className="border rounded-xl p-6 hover:shadow-md transition-shadow cursor-pointer">
        <div className="flex justify-between items-start">
          <h2 className="text-xl font-semibold">{event.name}</h2>
          <span className={`text-sm px-3 py-1 rounded-full ${statusColors[event.status]}`}>
            {event.status}
          </span>
        </div>
        <p className="text-gray-500 mt-2 text-sm">
          {new Date(event.start_time).toLocaleString('he-IL')}
        </p>
      </div>
    </Link>
  );
}
```

**Step 3: Create new event form**

```tsx
// web/app/dashboard/events/new/page.tsx
'use client';
import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function NewEvent() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ name: '', start_time: '', end_time: '', lat: '', lng: '' });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = await getToken();
    const res = await api.post('/api/events', {
      ...form,
      lat: form.lat ? Number(form.lat) : undefined,
      lng: form.lng ? Number(form.lng) : undefined,
    }, { headers: { Authorization: `Bearer ${token}` } });
    router.push(`/dashboard/events/${res.data.id}`);
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">אירוע חדש</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input required placeholder="שם האירוע" value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
          className="w-full border rounded-lg p-3 text-right" />
        <div className="grid grid-cols-2 gap-4">
          <input required type="datetime-local" value={form.start_time}
            onChange={e => setForm({ ...form, start_time: e.target.value })}
            className="border rounded-lg p-3" />
          <input required type="datetime-local" value={form.end_time}
            onChange={e => setForm({ ...form, end_time: e.target.value })}
            className="border rounded-lg p-3" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <input placeholder="קו רוחב (lat)" value={form.lat}
            onChange={e => setForm({ ...form, lat: e.target.value })}
            className="border rounded-lg p-3" />
          <input placeholder="קו אורך (lng)" value={form.lng}
            onChange={e => setForm({ ...form, lng: e.target.value })}
            className="border rounded-lg p-3" />
        </div>
        <button type="submit" className="w-full bg-black text-white py-3 rounded-lg hover:bg-gray-800">
          צור אירוע
        </button>
      </form>
    </div>
  );
}
```

**Step 4: Commit**

```bash
git add web/
git commit -m "feat: dashboard event list, create form, EventCard component"
```

---

## Task 11: Web Dashboard — Timeline Editor

**Files:**
- Create: `web/app/dashboard/events/[id]/editor/page.tsx`
- Create: `web/components/TimelineEditor.tsx`
- Create: `web/components/AlternativePicker.tsx`

**Step 1: Create TimelineEditor component**

```tsx
// web/components/TimelineEditor.tsx
'use client';
import { useEffect, useRef, useState } from 'react';

interface Clip {
  media_item_id: string;
  synced_timestamp: string;
  duration: number;
  alternatives: { media_item_id: string; synced_timestamp: string }[];
  download_url?: string;
}

interface Props {
  clips: Clip[];
  onClipChange: (index: number, newMediaId: string) => void;
  onSave: () => void;
}

export default function TimelineEditor({ clips, onClipChange, onSave }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const currentClip = clips[currentIndex];

  useEffect(() => {
    if (videoRef.current && currentClip?.download_url) {
      videoRef.current.src = currentClip.download_url;
      videoRef.current.play().catch(() => {});
    }
  }, [currentIndex, currentClip]);

  return (
    <div className="flex flex-col gap-4">
      {/* Preview */}
      <div className="bg-black rounded-xl overflow-hidden aspect-video">
        <video ref={videoRef} className="w-full h-full object-contain" controls />
      </div>

      {/* Timeline strip */}
      <div className="flex gap-2 overflow-x-auto p-2 bg-gray-100 rounded-xl">
        {clips.map((clip, i) => (
          <button key={clip.media_item_id} onClick={() => setCurrentIndex(i)}
            className={`flex-shrink-0 w-20 h-14 rounded-lg border-2 overflow-hidden relative
              ${i === currentIndex ? 'border-blue-500' : 'border-transparent'}`}>
            <div className="w-full h-full bg-gray-300 flex items-center justify-center text-xs text-gray-600">
              {new Date(clip.synced_timestamp).toLocaleTimeString('he-IL')}
            </div>
            {clip.alternatives.length > 0 && (
              <span className="absolute top-1 right-1 bg-blue-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                {clip.alternatives.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Alternatives for current clip */}
      {currentClip?.alternatives.length > 0 && (
        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-sm font-medium mb-2">זוויות נוספות בנקודת זמן זו:</p>
          <div className="flex gap-2">
            {currentClip.alternatives.map((alt) => (
              <button key={alt.media_item_id}
                onClick={() => onClipChange(currentIndex, alt.media_item_id)}
                className="px-4 py-2 bg-white border rounded-lg text-sm hover:bg-blue-50 hover:border-blue-400">
                זווית {new Date(alt.synced_timestamp).toLocaleTimeString('he-IL')}
              </button>
            ))}
          </div>
        </div>
      )}

      <button onClick={onSave}
        className="bg-black text-white py-3 rounded-xl font-medium hover:bg-gray-800">
        שמור עריכה
      </button>
    </div>
  );
}
```

**Step 2: Create editor page**

```tsx
// web/app/dashboard/events/[id]/editor/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { api } from '@/lib/api';
import TimelineEditor from '@/components/TimelineEditor';

interface Clip {
  media_item_id: string;
  synced_timestamp: string;
  duration: number;
  alternatives: { media_item_id: string; synced_timestamp: string }[];
  download_url?: string;
}

export default function EditorPage({ params }: { params: { id: string } }) {
  const { getToken } = useAuth();
  const [clips, setClips] = useState<Clip[]>([]);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      const headers = { Authorization: `Bearer ${token}` };

      const [projectRes, mediaRes] = await Promise.all([
        api.get(`/api/edit/${params.id}`, { headers }),
        api.get(`/api/media/event/${params.id}`, { headers }),
      ]);

      const mediaMap = Object.fromEntries(
        mediaRes.data.map((m: { id: string; download_url: string }) => [m.id, m.download_url])
      );

      const clipsWithUrls = projectRes.data.timeline_json.clips.map((c: Clip) => ({
        ...c,
        download_url: mediaMap[c.media_item_id],
      }));

      setClips(clipsWithUrls);
    })();
  }, [params.id]);

  function handleClipChange(index: number, newMediaId: string) {
    setClips((prev) => prev.map((c, i) => i === index ? { ...c, media_item_id: newMediaId } : c));
  }

  async function handleSave() {
    setSaving(true);
    const token = await getToken();
    await api.patch(`/api/edit/${params.id}`,
      { timeline_json: { clips } },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    setSaving(false);
  }

  async function handleExport() {
    setExporting(true);
    const token = await getToken();
    await api.post(`/api/export/${params.id}`, {}, { headers: { Authorization: `Bearer ${token}` } });
    alert('הייצוא התחיל — תקבל הודעה כשהסרטון יהיה מוכן');
    setExporting(false);
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">עורך וידאו</h1>
        <button onClick={handleExport} disabled={exporting}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {exporting ? 'מייצא...' : 'ייצא סרטון'}
        </button>
      </div>
      {clips.length > 0
        ? <TimelineEditor clips={clips} onClipChange={handleClipChange} onSave={handleSave} />
        : <p className="text-gray-400 text-center py-20">ממתין לתוכן מהמשתתפים...</p>
      }
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add web/
git commit -m "feat: timeline editor with multi-angle switcher and export trigger"
```

---

## Task 12: Web Dashboard — Event Page with QR

**Files:**
- Create: `web/app/dashboard/events/[id]/page.tsx`

**Step 1: Create event detail page**

```tsx
// web/app/dashboard/events/[id]/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { api } from '@/lib/api';
import { QRCodeSVG } from 'qrcode.react';
import Link from 'next/link';

interface Event {
  id: string; name: string; start_time: string; end_time: string;
  status: string; invite_link: string; qr_code: string;
}

export default function EventPage({ params }: { params: { id: string } }) {
  const { getToken } = useAuth();
  const [event, setEvent] = useState<Event | null>(null);
  const [mediaCount, setMediaCount] = useState(0);

  const inviteUrl = event ? `${process.env.NEXT_PUBLIC_APP_URL}/join/${event.invite_link}` : '';

  useEffect(() => {
    (async () => {
      const token = await getToken();
      const headers = { Authorization: `Bearer ${token}` };
      const [eventRes, mediaRes] = await Promise.all([
        api.get(`/api/events`, { headers }),
        event ? api.get(`/api/media/event/${params.id}`, { headers }) : Promise.resolve({ data: [] }),
      ]);
      const found = eventRes.data.find((e: Event) => e.id === params.id);
      setEvent(found);
      setMediaCount(mediaRes.data.length);
    })();
  }, [params.id]);

  if (!event) return <div className="p-8">טוען...</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">{event.name}</h1>
      <p className="text-gray-500 mb-8">{new Date(event.start_time).toLocaleString('he-IL')}</p>

      <div className="grid grid-cols-2 gap-8">
        {/* QR Code */}
        <div className="border rounded-xl p-6 flex flex-col items-center gap-4">
          <h2 className="font-semibold text-lg">הצג למשתתפים</h2>
          <QRCodeSVG value={inviteUrl} size={200} />
          <p className="text-xs text-gray-400 text-center break-all">{inviteUrl}</p>
          <button onClick={() => navigator.clipboard.writeText(inviteUrl)}
            className="text-sm text-blue-600 hover:underline">
            העתק קישור
          </button>
        </div>

        {/* Stats + actions */}
        <div className="flex flex-col gap-4">
          <div className="border rounded-xl p-6">
            <p className="text-4xl font-bold">{mediaCount}</p>
            <p className="text-gray-500">קבצים הועלו</p>
          </div>
          <Link href={`/dashboard/events/${params.id}/editor`}
            className="border rounded-xl p-6 hover:bg-gray-50 text-center block">
            <p className="text-lg font-semibold">✂️ עריכת סרטון</p>
            <p className="text-gray-500 text-sm mt-1">פתח את עורך הוידאו</p>
          </Link>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add web/app/dashboard/events/
git commit -m "feat: event detail page with QR code and media count"
```

---

## Task 13: Mobile App — Expo Setup

**Files:**
- Create: `mobile/` (Expo app)

**Step 1: Initialize Expo**

```bash
cd C:\Users\Lior\Desktop\Mosaic
npx create-expo-app mobile --template blank-typescript
cd mobile
npx expo install expo-location expo-notifications expo-media-library expo-camera expo-image-picker
npm install @clerk/clerk-expo expo-secure-store axios
```

**Step 2: Create mobile/app/_layout.tsx with Clerk**

```tsx
import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import * as SecureStore from 'expo-secure-store';
import { Slot } from 'expo-router';

const tokenCache = {
  async getToken(key: string) { return SecureStore.getItemAsync(key); },
  async saveToken(key: string, value: string) { return SecureStore.setItemAsync(key, value); },
};

export default function RootLayout() {
  return (
    <ClerkProvider
      publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!}
      tokenCache={tokenCache}>
      <Slot />
    </ClerkProvider>
  );
}
```

**Step 3: Create mobile/lib/api.ts**

```typescript
import axios from 'axios';

export const api = axios.create({ baseURL: process.env.EXPO_PUBLIC_BACKEND_URL });
```

**Step 4: Commit**

```bash
git add mobile/
git commit -m "feat: Expo mobile app scaffold with Clerk auth"
```

---

## Task 14: Mobile App — Event Join + GPS

**Files:**
- Create: `mobile/app/(tabs)/index.tsx`
- Create: `mobile/app/join/[code].tsx`
- Create: `mobile/lib/geofence.ts`

**Step 1: Create geofence service**

```typescript
// mobile/lib/geofence.ts
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { api } from './api';

export async function setupGeofencing(token: string) {
  const { status } = await Location.requestBackgroundPermissionsAsync();
  if (status !== 'granted') return;

  await Notifications.requestPermissionsAsync();

  // Poll every time app foregrounds — geofencing for bg
  const location = await Location.getCurrentPositionAsync({});
  const { latitude: lat, longitude: lng } = location.coords;

  const res = await api.get('/api/events/nearby', {
    params: { lat, lng, radius: 500 },
    headers: { Authorization: `Bearer ${token}` },
  });

  for (const event of res.data) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `אירוע קרוב: ${event.name}`,
        body: 'הצטרף לשיתוף תמונות וסרטונים',
        data: { event_id: event.id, invite_link: event.invite_link },
      },
      trigger: null, // immediate
    });
  }
}
```

**Step 2: Create home tab (event list + join)**

```tsx
// mobile/app/(tabs)/index.tsx
import { View, Text, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { setupGeofencing } from '@/lib/geofence';

export default function HomeScreen() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [events, setEvents] = useState<{ id: string; name: string; start_time: string }[]>([]);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      await setupGeofencing(token!);
      // Load joined events
      const res = await api.get('/api/events', { headers: { Authorization: `Bearer ${token}` } });
      setEvents(res.data);
    })();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Mosaic</Text>
      <FlatList
        data={events}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => router.push(`/event/${item.id}`)}>
            <Text style={styles.eventName}>{item.name}</Text>
            <Text style={styles.eventTime}>{new Date(item.start_time).toLocaleString('he-IL')}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#fff' },
  title: { fontSize: 32, fontWeight: 'bold', marginBottom: 24, textAlign: 'right' },
  card: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 16, marginBottom: 12 },
  eventName: { fontSize: 18, fontWeight: '600', textAlign: 'right' },
  eventTime: { color: '#6b7280', marginTop: 4, textAlign: 'right' },
});
```

**Step 3: Commit**

```bash
git add mobile/
git commit -m "feat: mobile home screen with geofencing and event list"
```

---

## Task 15: Mobile App — Gallery Picker + Upload

**Files:**
- Create: `mobile/app/event/[id]/upload.tsx`

**Step 1: Create upload screen**

```tsx
// mobile/app/event/[id]/upload.tsx
import { View, Text, FlatList, Image, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import * as MediaLibrary from 'expo-media-library';
import axios from 'axios';
import { api } from '@/lib/api';

interface Asset {
  id: string; uri: string; creationTime: number; duration: number;
  width: number; height: number; mediaType: string; filename: string;
  selected: boolean;
}

export default function UploadScreen() {
  const { id: eventId, start_time, end_time } = useLocalSearchParams<{
    id: string; start_time: string; end_time: string;
  }>();
  const { getToken } = useAuth();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') return;

      const startMs = new Date(start_time).getTime();
      const endMs = new Date(end_time).getTime();

      const media = await MediaLibrary.getAssetsAsync({
        mediaType: ['photo', 'video'],
        createdAfter: startMs,
        createdBefore: endMs,
        sortBy: 'creationTime',
      });

      setAssets(media.assets.map((a) => ({ ...a, selected: true })));
    })();
  }, []);

  function toggleSelect(id: string) {
    setAssets((prev) => prev.map((a) => a.id === id ? { ...a, selected: !a.selected } : a));
  }

  async function handleUpload() {
    const selected = assets.filter((a) => a.selected);
    if (!selected.length) return Alert.alert('בחר לפחות קובץ אחד');

    setUploading(true);
    const token = await getToken();
    const headers = { Authorization: `Bearer ${token}` };

    for (const asset of selected) {
      try {
        const contentType = asset.mediaType === 'video' ? 'video/mp4' : 'image/jpeg';
        const { data } = await api.post('/api/media/upload-url', {
          event_id: eventId,
          type: asset.mediaType === 'video' ? 'video' : 'photo',
          content_type: contentType,
          raw_timestamp: new Date(asset.creationTime).toISOString(),
          duration_ms: asset.duration ? Math.round(asset.duration * 1000) : undefined,
          width: asset.width,
          height: asset.height,
        }, { headers });

        // Direct upload to R2
        const fileContent = await fetch(asset.uri);
        const blob = await fileContent.blob();
        await axios.put(data.upload_url, blob, { headers: { 'Content-Type': contentType } });

        // Confirm upload
        await api.post(`/api/media/${data.media_id}/confirm`, {}, { headers });
      } catch (e) {
        console.error('Upload failed for', asset.id, e);
      }
    }

    setUploading(false);
    Alert.alert('הושלם!', `${selected.length} קבצים הועלו בהצלחה`);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>בחר מה לשתף</Text>
      <Text style={styles.subtitle}>{assets.length} קבצים מהאירוע</Text>

      <FlatList
        data={assets}
        numColumns={3}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => toggleSelect(item.id)} style={styles.assetContainer}>
            <Image source={{ uri: item.uri }} style={styles.asset} />
            {item.selected && (
              <View style={styles.checkmark}><Text style={styles.check}>✓</Text></View>
            )}
          </TouchableOpacity>
        )}
      />

      <TouchableOpacity
        style={[styles.uploadBtn, uploading && styles.uploading]}
        onPress={handleUpload}
        disabled={uploading}>
        <Text style={styles.uploadText}>
          {uploading ? 'מעלה...' : `העלה ${assets.filter(a => a.selected).length} קבצים`}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: 'bold', padding: 20, textAlign: 'right' },
  subtitle: { color: '#6b7280', paddingHorizontal: 20, marginBottom: 12, textAlign: 'right' },
  assetContainer: { flex: 1/3, aspectRatio: 1, padding: 1, position: 'relative' },
  asset: { flex: 1 },
  checkmark: { position: 'absolute', top: 4, right: 4, backgroundColor: '#3b82f6',
    borderRadius: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  check: { color: 'white', fontWeight: 'bold', fontSize: 14 },
  uploadBtn: { margin: 20, backgroundColor: '#000', padding: 16, borderRadius: 12, alignItems: 'center' },
  uploading: { backgroundColor: '#6b7280' },
  uploadText: { color: 'white', fontSize: 16, fontWeight: '600' },
});
```

**Step 2: Commit**

```bash
git add mobile/app/event/
git commit -m "feat: gallery picker with time-filtered assets and direct R2 upload"
```

---

## Task 16: Final Push to GitHub

**Step 1: Verify everything builds**

```bash
# Backend
cd C:\Users\Lior\Desktop\Mosaic\backend && npm run build

# Web
cd C:\Users\Lior\Desktop\Mosaic\web && npm run build

# Check no secrets in repo
grep -r "sk_" . --include="*.ts" --include="*.tsx" --exclude-dir=node_modules
```

**Step 2: Final commit and push**

```bash
cd C:\Users\Lior\Desktop\Mosaic
git push origin master
```

Expected: all files pushed to https://github.com/lior454/mosaic

---

## Environment Setup Checklist

Before running anything, create `backend/.env` with:
```
DATABASE_URL=          # Neon PostgreSQL connection string
R2_ACCOUNT_ID=         # Cloudflare R2 account ID
R2_ACCESS_KEY_ID=      # R2 access key
R2_SECRET_ACCESS_KEY=  # R2 secret key
R2_BUCKET_NAME=mosaic-media
REDIS_URL=             # Upstash Redis URL
CLERK_SECRET_KEY=      # From Clerk dashboard
CLERK_WEBHOOK_SECRET=  # From Clerk webhook config
FRONTEND_URL=http://localhost:3000
```

And `web/.env.local`:
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

And `mobile/.env`:
```
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=
EXPO_PUBLIC_BACKEND_URL=http://localhost:3001
```

**Required external services to set up:**
1. [Neon](https://neon.tech) — free PostgreSQL
2. [Cloudflare R2](https://dash.cloudflare.com) — free storage tier
3. [Upstash](https://upstash.com) — free Redis
4. [Clerk](https://clerk.com) — free auth (configure Google + Apple login)
