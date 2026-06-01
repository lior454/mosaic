import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { query } from '../db';

const router = Router();

// GET /api/edit/:event_id — get the edit project for an event
router.get('/:event_id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
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
    return res.json(project);
  } catch (err) {
    console.error('GET /edit error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/edit/:event_id — save timeline changes
router.patch('/:event_id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const [event] = await query(
      'SELECT id FROM events WHERE id = $1 AND owner_id = $2',
      [req.params.event_id, req.dbUserId]
    );
    if (!event) return res.status(403).json({ error: 'Not your event' });

    const { timeline_json } = req.body;
    if (!timeline_json) return res.status(400).json({ error: 'timeline_json required' });
    if (typeof timeline_json !== 'object' || !Array.isArray(timeline_json.clips)) {
      return res.status(400).json({ error: 'timeline_json must have a clips array' });
    }

    const [project] = await query(
      `UPDATE edit_projects
       SET timeline_json = $1, auto_generated = false, updated_at = NOW()
       WHERE event_id = $2
       RETURNING *`,
      [JSON.stringify(timeline_json), req.params.event_id]
    );
    if (!project) return res.status(404).json({ error: 'No edit project to update' });
    return res.json(project);
  } catch (err) {
    console.error('PATCH /edit error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
