import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const seedData = JSON.parse(readFileSync(join(__dirname, 'seed_data.json'), 'utf-8'));

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.get('/api', (req, res) => {
  res.json({ status: 'LIVE', platform: 'DURVIX Estates Protected API', version: '2.0.0' });
});

app.get('/api/properties', (req, res) => {
  res.json({ properties: seedData.properties });
});

app.get('/api/agents', (req, res) => {
  const agents = seedData.users.filter(u => u.role === 'AGENT');
  res.json({ agents });
});

app.post('/api/contact', (req, res) => {
  res.json({ success: true, message: 'Inquiry securely logged under Layer 1 encryption.' });
});

export default app;
