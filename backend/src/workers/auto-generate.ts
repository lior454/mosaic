import { Worker } from 'bullmq';
import { connection } from '../lib/queue';
import { query } from '../db';

interface MediaRow {
  id: string;
  synced_timestamp: string | null;
  type: string;
  duration_ms: number | null;
}

interface TimelineClip {
  media_item_id: string;
  synced_timestamp: string | null;
  duration: number;
  alternatives: { media_item_id: string; synced_timestamp: string | null }[];
}

new Worker(
  'auto-generate',
  async (job) => {
    const { event_id } = job.data as { event_id: string };

    const items = await query<MediaRow>(
      `SELECT id, synced_timestamp, type, duration_ms
       FROM media_items
       WHERE event_id = $1 AND status = 'uploaded'
       ORDER BY synced_timestamp ASC NULLS LAST`,
      [event_id]
    );

    if (!items.length) return;

    const WINDOW_MS = 3000;
    const clips: TimelineClip[] = [];
    const used = new Set<string>();

    for (const item of items) {
      if (used.has(item.id)) continue;
      const ts = item.synced_timestamp ? new Date(item.synced_timestamp).getTime() : null;

      const alternatives = ts !== null
        ? items.filter((other) => {
            if (other.id === item.id || used.has(other.id)) return false;
            const otherTs = other.synced_timestamp
              ? new Date(other.synced_timestamp).getTime()
              : null;
            return otherTs !== null && Math.abs(otherTs - ts) <= WINDOW_MS;
          })
        : [];

      clips.push({
        media_item_id: item.id,
        synced_timestamp: item.synced_timestamp,
        duration: item.duration_ms ?? 3000,
        alternatives: alternatives.map((a) => ({
          media_item_id: a.id,
          synced_timestamp: a.synced_timestamp,
        })),
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
  },
  { connection }
);
