const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;
const DB_FILE = path.join(__dirname, 'vault-data.json');
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.VAULT_ADMIN_KEY || 'prime';

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Admin-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function ensureDbFile() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ codes: {} }, null, 2), 'utf8');
    console.log('DB file created:', DB_FILE);
  }
}

function readDb() {
  ensureDbFile();
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    // migrate legacy `tokens` -> `codes`, map used/opened -> revealed
    if (parsed.tokens && !parsed.codes) {
      parsed.codes = {};
      for (const k of Object.keys(parsed.tokens)) {
        const t = parsed.tokens[k];
        parsed.codes[k] = {
          reward: t.reward || null,
          revealed: !!(t.used || t.opened),
          clientName: t.clientName || '',
          createdAt: t.createdAt || new Date().toISOString(),
          revealedAt: (t.openedAt || (t.used ? new Date().toISOString() : null)) || null
        };
      }
      delete parsed.tokens;
      fs.writeFileSync(DB_FILE, JSON.stringify(parsed, null, 2), 'utf8');
      console.log('Migrated legacy tokens -> codes');
    }
    if (parsed.codes && typeof parsed.codes === 'object') {
      for (const codeKey of Object.keys(parsed.codes)) {
        const codeEntry = parsed.codes[codeKey];
        if (codeEntry && typeof codeEntry === 'object') {
          const revealed = !!(codeEntry.revealed || codeEntry.used || codeEntry.opened);
          codeEntry.revealed = revealed;
          if (revealed && !codeEntry.revealedAt) {
            codeEntry.revealedAt = null;
          }
          delete codeEntry.used;
          delete codeEntry.opened;
        }
      }
    }
    if (!parsed.codes || typeof parsed.codes !== 'object') parsed.codes = {};
    return parsed;
  } catch (err) {
    console.error('Failed to parse DB, resetting:', err);
    const empty = { codes: {} };
    fs.writeFileSync(DB_FILE, JSON.stringify(empty, null, 2), 'utf8');
    return empty;
  }
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function findCode(code) {
  const db = readDb();
  const entry = db.codes[code];
  if (!entry) return null;
  return Object.assign({ code }, entry);
}

function saveCode(code, data) {
  const db = readDb();
  if (db.codes[code]) throw new Error('Code already exists');
  db.codes[code] = {
    reward: data.reward || null,
    revealed: !!data.revealed,
    clientName: data.clientName || '',
    createdAt: data.createdAt || new Date().toISOString(),
    revealedAt: data.revealedAt || null
  };
  writeDb(db);
  const verify = readDb();
  if (!verify.codes || !verify.codes[code]) throw new Error('Failed to persist code');
}

function updateCode(code, updates) {
  const db = readDb();
  if (!db.codes[code]) throw new Error('Code not found');
  db.codes[code] = Object.assign({}, db.codes[code], updates);
  writeDb(db);
  const verify = readDb();
  if (!verify.codes[code]) throw new Error('Failed to persist update');
}

function isAdminAuthorized(req) {
  const adminKey = req.headers['x-admin-key'] || '';
  return adminKey === ADMIN_KEY;
}

// Serve static files
app.use(express.static(ROOT_DIR));

// Health
app.get('/health', (req, res) => res.send('OK'));

// Admin: generate code
app.post('/api/vault/generate-code', (req, res) => {
  if (!isAdminAuthorized(req)) return res.status(401).json({ success: false, message: 'Unauthorized' });
  const { code, reward, clientName } = req.body || {};
  if (!code || !reward) return res.status(400).json({ success: false, message: 'Missing code or reward' });
  try {
    saveCode(code, { reward, clientName, revealed: false });
    return res.json({ success: true });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

// Redeem code
app.post('/api/vault/redeem-code', (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ success: false, message: 'Missing code' });
  const entry = findCode(code);
  if (!entry) return res.status(404).json({ success: false, message: 'Invalid code' });
  if (entry.revealed) return res.json({ success: false, message: 'Code already used', revealed: true, reward: entry.reward });
  try {
    const revealedAt = new Date().toISOString();
    updateCode(code, { revealed: true, revealedAt });
    const saved = findCode(code);
    return res.json({ success: true, reward: saved.reward });
  } catch (err) {
    console.error('Redeem error:', err);
    return res.status(500).json({ success: false, message: 'Failed to redeem code' });
  }
});

// Code status
app.get('/api/vault/code-status/:code', (req, res) => {
  const code = req.params.code;
  if (!code) return res.status(400).json({ success: false, message: 'Missing code' });
  const entry = findCode(code);
  if (!entry) return res.status(200).json({ exists: false });
  return res.json({ exists: true, revealed: !!entry.revealed, reward: entry.reward });
});

// Admin list
app.get('/api/vault/list', (req, res) => {
  if (!isAdminAuthorized(req)) return res.status(401).json({ success: false, message: 'Unauthorized' });
  const db = readDb();
  const list = Object.entries(db.codes).map(([k, v]) => ({ code: k, ...v }));
  res.json({ success: true, vaults: list });
});

app.get('/easter-egg', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'easter-egg.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'admin-vault-control.html'));
});

// Fallback to index
app.get('*', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Vault server running on http://localhost:${PORT}`);
});
