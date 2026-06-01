import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { query } from '../db';
import { exportQueue } from '../lib/queue';
import { getDownloadUrl } from '../lib/r2';

const router = Router();

// POST /api/export/:event_id — trigger export for an event
router.post('/:event_id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const [event] = await query(
      'SELECT id FROM events WHERE id = $1 AND owner_id = $2',
      [req.params.event_id, req.dbUserId]
    );
    if (!event) return res.status(403).json({ error: 'Not your event' });

    const [job] = await query<{ id: string }>(
      `INSERT INTO export_jobs (event_id) VALUES ($1) RETURNING id`,
      [req.params.event_id]
    );

    await exportQueue.add('export', {
      export_job_id: job.id,
      event_id: req.params.event_id,
    });

    return res.json({ export_job_id: job.id });
  } catch (err) {
    console.error('POST /export error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/export/:event_id/status — check export status
router.get('/:event_id/status', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const [job] = await query<{ status: string; r2_key: string | null }>(
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
    return res.json(result);
  } catch (err) {
    console.error('GET /export/status error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
