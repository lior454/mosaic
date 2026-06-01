import { Queue } from 'bullmq';

// Pass connection options directly so BullMQ uses its own bundled ioredis.
// Avoids version mismatch when a separate ioredis is also installed.
const redisUrl = new URL(process.env.REDIS_URL || 'redis://localhost:6379');

const connectionOptions = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port) || 6379,
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null as null,
};

export const connection = connectionOptions;

export const autoGenerateQueue = new Queue('auto-generate', { connection });
export const exportQueue = new Queue('export', { connection });
