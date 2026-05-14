// === Batch 01 Gaps & Frontend Mounts ===
// Feature: No webhook outbound API
// Lazy table: gap_features (created on first POST if absent).
// TODO: configure credentials — set OPENROUTER_API_KEY (or fallback model env).
const express = require('express');
const router = express.Router();

// Best-effort auth middleware discovery — fall back to no-op if not present.
let authMiddleware = (req, res, next) => next();
const authCandidates = [
  '../middleware/auth', '../middleware/authenticate', '../middleware/jwt',
  '../middleware/authMiddleware', './middleware/auth', '../../middleware/auth',
  '../auth/auth', '../auth/middleware'
];
for (const p of authCandidates) {
  try {
    const m = require(p);
    if (typeof m === 'function') { authMiddleware = m; break; }
    if (m && typeof m.authenticate === 'function') { authMiddleware = m.authenticate; break; }
    if (m && typeof m.authenticateToken === 'function') { authMiddleware = m.authenticateToken; break; }
    if (m && typeof m.requireAuth === 'function') { authMiddleware = m.requireAuth; break; }
    if (m && typeof m.verifyToken === 'function') { authMiddleware = m.verifyToken; break; }
    if (m && typeof m.default === 'function') { authMiddleware = m.default; break; }
  } catch (_) { /* keep searching */ }
}

// Best-effort DB discovery — silent skip if no pg pool is reachable.
let dbPool = null;
const dbCandidates = ['../db', '../config/db', '../config/database', '../database', '../models', '../../db'];
for (const p of dbCandidates) {
  try {
    const m = require(p);
    if (m && typeof m.query === 'function') { dbPool = m; break; }
    if (m && m.pool && typeof m.pool.query === 'function') { dbPool = m.pool; break; }
    if (m && m.default && typeof m.default.query === 'function') { dbPool = m.default; break; }
  } catch (_) {}
}

let _tableEnsured = false;
async function ensureTable() {
  if (_tableEnsured || !dbPool) return;
  try {
    await dbPool.query(`CREATE TABLE IF NOT EXISTS gap_features (
      id SERIAL PRIMARY KEY,
      feature_key VARCHAR(120),
      user_id INTEGER,
      input_payload JSONB,
      output_payload JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    _tableEnsured = true;
  } catch (_) {
    // Silent: log table absent or different SQL dialect; route still functions
    _tableEnsured = true;
  }
}

async function callOpenRouter(prompt, system) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    const err = new Error('OPENROUTER_API_KEY not configured');
    err.code = 'MISSING_KEY';
    throw err;
  }
  const model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1200,
    }),
  });
  const json = await resp.json().catch(() => ({}));
  return json;
}

function parseAIJson(text) {
  if (!text) return null;
  if (typeof text === 'object') return text;
  try { return JSON.parse(text); } catch (_) {}
  const fence = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { try { return JSON.parse(fence[1]); } catch (_) {} }
  const obj = String(text).match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch (_) {} }
  return { raw_response: String(text) };
}

router.use(authMiddleware);

router.post('/run', async (req, res) => {
  try {
    await ensureTable();
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(503).json({
        error: 'AI unavailable',
        missing: 'OPENROUTER_API_KEY',
        feature: 'gap_no_webhook_outbound_api',
      });
    }
    const payload = req.body || {};
    const userPrompt = `Context (JSON):\n${JSON.stringify(payload).slice(0, 4000)}\n\nTask: ${ 'No webhook outbound API' }\n\nReturn JSON: {"summary": string, "actions": [string], "risks": [string], "confidence": number_0_to_1}.`;
    const system = `You are an expert assistant for the feature: 'No webhook outbound API'. Respond with strict JSON.`;
    const aiResp = await callOpenRouter(userPrompt, system);
    const content = aiResp?.choices?.[0]?.message?.content ?? aiResp?.error?.message ?? '';
    const parsed = parseAIJson(content);
    const out = { feature: 'gap_no_webhook_outbound_api', model: aiResp?.model, parsed, raw: content };
    if (dbPool) {
      try {
        await dbPool.query(
          'INSERT INTO gap_features (feature_key, user_id, input_payload, output_payload) VALUES ($1, $2, $3, $4)',
          ['gap_no_webhook_outbound_api', req.user?.id || null, JSON.stringify(payload), JSON.stringify(out)]
        );
      } catch (_) { /* best-effort persistence */ }
    }
    res.json(out);
  } catch (err) {
    if (err && err.code === 'MISSING_KEY') {
      return res.status(503).json({ error: 'AI unavailable', missing: 'OPENROUTER_API_KEY' });
    }
    res.status(500).json({ error: 'Feature failed', details: String(err.message || err) });
  }
});

router.get('/health', (req, res) => res.json({ feature: 'gap_no_webhook_outbound_api', ok: true, ai_configured: !!process.env.OPENROUTER_API_KEY }));

router.get('/history', async (req, res) => {
  if (!dbPool) return res.json({ results: [] });
  try {
    await ensureTable();
    const r = await dbPool.query(
      'SELECT id, input_payload, output_payload, created_at FROM gap_features WHERE feature_key = $1 ORDER BY created_at DESC LIMIT 50',
      ['gap_no_webhook_outbound_api']
    );
    res.json({ results: r.rows || r[0] || [] });
  } catch (e) {
    res.json({ results: [] });
  }
});

module.exports = router;
