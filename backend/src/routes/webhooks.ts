import { Router, Request, Response } from 'express';
import { Webhook } from 'svix';
import { query } from '../db';

const router = Router();

router.post('/clerk', async (req: Request, res: Response) => {
  const wh = new Webhook(process.env.CLERK_WEBHOOK_SECRET!);

  let event: {
    type: string;
    data: {
      id: string;
      email_addresses: { email_address: string }[];
      first_name?: string;
      last_name?: string;
    };
  };

  try {
    event = wh.verify(req.body as Buffer, {
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
