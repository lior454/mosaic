import { pool } from './index';
import fs from 'fs';
import path from 'path';

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  await pool.query(sql);
  console.log('Migration complete');
  await pool.end();
}

migrate().catch(console.error);
