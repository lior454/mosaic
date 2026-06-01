import { Worker } from 'bullmq';
import { connection } from '../lib/queue';
import { query } from '../db';
import { getDownloadUrl, r2 } from '../lib/r2';
import { execSync } from 'child_process';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import os from 'os';

interface TimelineClip {
  media_item_id: string;
  duration: number;
}

interface TimelineJson {
  clips: TimelineClip[];
}

new Worker(
  'export',
  async (job) => {
    const { export_job_id, event_id } = job.data as {
      export_job_id: string;
      event_id: string;
    };

    await query(`UPDATE export_jobs SET status = 'processing' WHERE id = $1`, [export_job_id]);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-'));

    try {
      const [project] = await query<{ timeline_json: TimelineJson }>(
        'SELECT timeline_json FROM edit_projects WHERE event_id = $1',
        [event_id]
      );

      if (!project) throw new Error('No edit project found for event');

      const listFile = path.join(tmpDir, 'list.txt');
      const outputFile = path.join(tmpDir, 'output.mp4');
      const lines: string[] = [];

      for (const clip of project.timeline_json.clips) {
        const [media] = await query<{ r2_key: string }>(
          'SELECT r2_key FROM media_items WHERE id = $1',
          [clip.media_item_id]
        );
        if (!media) continue;

        const url = await getDownloadUrl(media.r2_key);
        const localPath = path.join(tmpDir, `${clip.media_item_id}.mp4`);
        execSync(`curl -sf -o "${localPath}" "${url}"`, { timeout: 60000 });
        lines.push(`file '${localPath}'`);
        lines.push(`duration ${(clip.duration / 1000).toFixed(3)}`);
      }

      if (!lines.length) throw new Error('No clips to render');

      fs.writeFileSync(listFile, lines.join('\n'));
      execSync(`ffmpeg -f concat -safe 0 -i "${listFile}" -c copy "${outputFile}" -y`, {
        timeout: 300000,
      });

      const r2Key = `exports/${event_id}/final-${Date.now()}.mp4`;
      await r2.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME!,
          Key: r2Key,
          Body: fs.readFileSync(outputFile),
          ContentType: 'video/mp4',
        })
      );

      await query(
        `UPDATE export_jobs SET status = 'done', r2_key = $1, completed_at = NOW() WHERE id = $2`,
        [r2Key, export_job_id]
      );
    } catch (err) {
      await query(
        `UPDATE export_jobs SET status = 'failed', error = $1 WHERE id = $2`,
        [String(err), export_job_id]
      );
      throw err;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  },
  { connection }
);
