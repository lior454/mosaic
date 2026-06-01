import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { query } from '../db';
import { getUploadUrl, getDownloadUrl } from '../lib/r2';

const router = Router();

// POST /api/media/upload-url — get a signed URL for direct upload to R2
router.post('/upload-url', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { event_id, type, content_type, raw_timestamp, duration_ms, width, height, file_size_bytes } = req.body;

    if (!event_id || !type || !content_type) {
      return res.status(400).json({ error: 'event_id, type, content_type required' });
    }
    if (!['photo', 'video'].includes(type)) {
      return res.status(400).json({ error: 'type must be photo or video' });
    }

    // Verify the user is a participant of this event
    const [participant] = await query<{ clock_delta_ms: number }>(
      'SELECT clock_delta_ms FROM event_participants WHERE event_id = $1 AND user_id = $2',
      [event_id, req.dbUserId]
    );
    if (!participant) {
      return res.status(403).json({ error: 'Not a participant of this event' });
    }

    const ext = content_type.split('/')[1]?.split(';')[0] || 'bin';
    const r2_key = `events/${event_id}/${uuidv4()}.${ext}`;

    // Compute synced timestamp: subtract clock delta to align to server time
    const rawTs = raw_timestamp ? new Date(raw_timestamp) : null;
    const syncedTs = rawTs && !isNaN(rawTs.getTime())
      ? new Date(rawTs.getTime() - participant.clock_delta_ms)
      : null;

    const [media] = await query<{ id: string }>(
      `INSERT INTO media_items
         (event_id, uploader_id, r2_key, raw_timestamp, synced_timestamp, type, duration_ms, width, height, file_size_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        event_id,
        req.dbUserId,
        r2_key,
        rawTs,
        syncedTs,
        type,
        duration_ms ?? null,
        width ?? null,
        height ?? null,
        file_size_bytes ?? null,
      ]
    );

    const upload_url = await getUploadUrl(r2_key, content_type);
    return res.json({ media_id: media.id, upload_url, r2_key });
  } catch (err) {
    console.error('POST /media/upload-url error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/media/:id/confirm — mark a media item as uploaded
router.post('/:id/confirm', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `UPDATE media_items SET status = 'uploaded'
       WHERE id = $1 AND uploader_id = $2
       RETURNING id`,
      [req.params.id, req.dbUserId]
    );
    if (!result.length) {
      return res.status(404).json({ error: 'Media item not found or not yours' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /media/:id/confirm error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/media/event/:event_id — list uploaded media for an event (owner only)
router.get('/event/:event_id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    // Only the event owner can list all media
    const [event] = await query(
      'SELECT id FROM events WHERE id = $1 AND owner_id = $2',
      [req.params.event_id, req.dbUserId]
    );
    if (!event) return res.status(403).json({ error: 'Not your event' });

    const items = await query<{ r2_key: string }>(
      `SELECT * FROM media_items
       WHERE event_id = $1 AND status = 'uploaded'
       ORDER BY synced_timestamp ASC NULLS LAST`,
      [req.params.event_id]
    );

    // Attach short-lived signed download URLs
    const withUrls = await Promise.all(
      items.map(async (item) => ({
        ...item,
        download_url: await getDownloadUrl(item.r2_key),
      }))
    );

    return res.json(withUrls);
  } catch (err) {
    console.error('GET /media/event error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
