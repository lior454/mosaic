import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { query } from '../db';

const router = Router();

// POST /api/events — create event (owner only)
router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const { name, start_time, end_time, lat, lng } = req.body;
  if (!name || !start_time || !end_time) {
    return res.status(400).json({ error: 'name, start_time, end_time required' });
  }

  const qr_code = uuidv4();
  const invite_link = uuidv4();

  const [event] = await query<Record<string, unknown>>(
    `INSERT INTO events (owner_id, name, start_time, end_time, lat, lng, qr_code, invite_link)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.dbUserId, name, start_time, end_time, lat ?? null, lng ?? null, qr_code, invite_link]
  );

  res.status(201).json(event);
});

// GET /api/events — list owner's events
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const events = await query(
    'SELECT * FROM events WHERE owner_id = $1 ORDER BY start_time DESC',
    [req.dbUserId]
  );
  res.json(events);
});

// GET /api/events/nearby — find events near a location
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

// GET /api/events/join/:code — get event by invite_link or qr_code
router.get('/join/:code', requireAuth, async (req: AuthRequest, res: Response) => {
  const [event] = await query(
    'SELECT * FROM events WHERE invite_link = $1 OR qr_code = $1',
    [req.params.code]
  );
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json(event);
});

// POST /api/events/:id/join — participant joins event, records clock delta
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
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json({ event, clock_delta_ms: clockDelta });
});

export default router;
