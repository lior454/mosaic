import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { query } from '../db';

const router = Router();

router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { name, start_time, end_time, lat, lng } = req.body;
    if (!name || !start_time || !end_time) {
      return res.status(400).json({ error: 'name, start_time, end_time required' });
    }
    if (isNaN(Date.parse(start_time)) || isNaN(Date.parse(end_time))) {
      return res.status(400).json({ error: 'start_time and end_time must be valid ISO dates' });
    }
    if (lat !== undefined && isNaN(Number(lat))) {
      return res.status(400).json({ error: 'lat must be a number' });
    }
    if (lng !== undefined && isNaN(Number(lng))) {
      return res.status(400).json({ error: 'lng must be a number' });
    }

    const qr_code = uuidv4();
    const invite_link = uuidv4();

    const [event] = await query<Record<string, unknown>>(
      `INSERT INTO events (owner_id, name, start_time, end_time, lat, lng, qr_code, invite_link)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.dbUserId, name, start_time, end_time, lat ?? null, lng ?? null, qr_code, invite_link]
    );

    return res.status(201).json(event);
  } catch (err) {
    console.error('POST /events error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const events = await query(
      'SELECT * FROM events WHERE owner_id = $1 ORDER BY start_time DESC',
      [req.dbUserId]
    );
    return res.json(events);
  } catch (err) {
    console.error('GET /events error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/nearby', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { lat, lng, radius = 500 } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });
    if (isNaN(Number(lat)) || isNaN(Number(lng))) {
      return res.status(400).json({ error: 'lat and lng must be numbers' });
    }

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
    return res.json(events);
  } catch (err) {
    console.error('GET /events/nearby error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/join/:code', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const [event] = await query(
      'SELECT * FROM events WHERE invite_link = $1 OR qr_code = $1',
      [req.params.code]
    );
    if (!event) return res.status(404).json({ error: 'Event not found' });
    return res.json(event);
  } catch (err) {
    console.error('GET /events/join error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/join', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const [event] = await query('SELECT * FROM events WHERE id = $1', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const { device_time } = req.body;
    const serverTime = Date.now();
    const clockDelta = device_time && !isNaN(Number(device_time))
      ? serverTime - Number(device_time)
      : 0;

    await query(
      `INSERT INTO event_participants (event_id, user_id, clock_delta_ms)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id, user_id) DO UPDATE SET clock_delta_ms = $3`,
      [req.params.id, req.dbUserId, clockDelta]
    );

    return res.json({ event, clock_delta_ms: clockDelta });
  } catch (err) {
    console.error('POST /events/:id/join error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
