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
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use(limiter as unknown as express.RequestHandler);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(Number(PORT), '0.0.0.0', () => console.log(`Backend running on port ${PORT}`));

export default app;
