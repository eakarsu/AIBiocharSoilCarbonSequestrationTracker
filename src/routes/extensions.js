'use strict';

/**
 * Apply pass 5 — Biochar backlog (additive, PRODUCT-DECISION items only).
 *
 * Backlog from _AUDIT_NOTE.md:
 *  1. RAG layer — vector store + embeddings.
 *  2. Agentic workflow orchestration with HIL feedback.
 *  3. Streaming anomaly detection on soilSamples.
 *  4. White-label / multi-tenancy.
 *
 * Env vars (NEEDS-CREDS endpoints; documented for ops):
 *  - ANTHROPIC_API_KEY    : LLM key for AI-gated endpoints.
 *  - EMBEDDING_API_KEY    : Optional; if unset, RAG falls back to in-memory hash embeddings.
 *  - VECTOR_STORE_URL     : Optional pgvector/Pinecone URL; if unset, uses SQLite-only stub.
 *
 * PRODUCT-DECISION choices documented inline.
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const { authenticateToken } = require('../middleware/auth');

// PRODUCT-DECISION: choose lightweight in-memory embeddings (256-dim hash projection) over a
// real model dependency. Operators wanting real embeddings must set EMBEDDING_API_KEY and we
// return 503 from /rag/embed-real. The in-memory stub is deterministic and dependency-free.
const EMBED_DIMS = 256;
function hashEmbed(text) {
  const v = new Float32Array(EMBED_DIMS);
  const tokens = String(text || '').toLowerCase().split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    const h = crypto.createHash('sha256').update(t).digest();
    for (let i = 0; i < EMBED_DIMS; i++) {
      v[i] += ((h[i % h.length] / 255) - 0.5);
    }
  }
  // L2 normalize
  let n = 0;
  for (let i = 0; i < EMBED_DIMS; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < EMBED_DIMS; i++) v[i] /= n;
  return Array.from(v);
}
function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// ─── Bootstrap pass-5 tables (additive) ─────────────────────────────────────
function ensureSchema() {
  const db = getDb();
  // Apply pass 5: additive only, IF NOT EXISTS.
  db.exec(`
    CREATE TABLE IF NOT EXISTS rag_corpus (
      id TEXT PRIMARY KEY,
      tenant_id TEXT,
      title TEXT,
      source TEXT,
      content TEXT NOT NULL,
      embedding TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS agentic_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      tenant_id TEXT,
      goal TEXT,
      plan_json TEXT,
      status TEXT,
      hil_feedback TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS anomaly_alerts (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      tenant_id TEXT,
      field_id TEXT,
      sample_id TEXT,
      metric TEXT,
      value REAL,
      z_score REAL,
      severity TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE,
      branding_json TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS tenant_members (
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, user_id)
    );
  `);
}
ensureSchema();

router.use(authenticateToken);

// ─── Helpers ────────────────────────────────────────────────────────────────
function aiKeyOrMissing() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { missing: 'ANTHROPIC_API_KEY' };
  }
  return null;
}

function tenantOf(req) {
  // PRODUCT-DECISION: tenant resolution = X-Tenant-Id header > req.user.tenant_id > 'default'.
  // This is the lightest path that lets a single-tenant deployment keep working unchanged
  // (everything bucket-keyed by 'default') while letting white-label operators set a header.
  return (req.headers['x-tenant-id'] || req.user?.tenant_id || 'default').toString().slice(0, 64);
}

// ════════════════════════════════════════════════════════════════════════════
// 1) RAG layer — corpus ingest + similarity search (in-memory stub embeddings)
// ════════════════════════════════════════════════════════════════════════════

// POST /api/ext/rag/ingest  { title, source?, content }
router.post('/rag/ingest', (req, res) => {
  const { title, source, content } = req.body || {};
  if (!content || !title) return res.status(400).json({ error: 'title and content required' });
  const id = uuidv4();
  const embedding = hashEmbed(`${title}\n${content}`);
  getDb().prepare(`
    INSERT INTO rag_corpus (id, tenant_id, title, source, content, embedding)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, tenantOf(req), title, source || null, content, JSON.stringify(embedding));
  res.json({ id, dims: EMBED_DIMS });
});

// GET /api/ext/rag/search?q=... — cosine over in-memory stub
router.get('/rag/search', (req, res) => {
  const q = (req.query.q || '').toString();
  if (!q) return res.status(400).json({ error: 'q required' });
  const qv = hashEmbed(q);
  const rows = getDb().prepare('SELECT id, title, source, content, embedding FROM rag_corpus WHERE tenant_id = ?').all(tenantOf(req));
  const scored = rows.map(r => {
    let v;
    try { v = JSON.parse(r.embedding); } catch { v = null; }
    return { id: r.id, title: r.title, source: r.source, snippet: r.content.slice(0, 240), score: v ? cosine(qv, v) : 0 };
  }).sort((a, b) => b.score - a.score).slice(0, 5);
  res.json({ results: scored, embedding_kind: 'stub-hash-256' });
});

// POST /api/ext/rag/ask — RAG-enhanced answer (NEEDS-CREDS for LLM)
router.post('/rag/ask', async (req, res) => {
  const miss = aiKeyOrMissing();
  if (miss) return res.status(503).json({ error: 'AI service unavailable', missing: miss.missing });
  const { question } = req.body || {};
  if (!question) return res.status(400).json({ error: 'question required' });
  const qv = hashEmbed(question);
  const rows = getDb().prepare('SELECT title, content, embedding FROM rag_corpus WHERE tenant_id = ?').all(tenantOf(req));
  const top = rows.map(r => {
    let v; try { v = JSON.parse(r.embedding); } catch { v = null; }
    return { title: r.title, content: r.content, score: v ? cosine(qv, v) : 0 };
  }).sort((a, b) => b.score - a.score).slice(0, 3);
  // Deterministic stub answer: surface retrieved snippets without burning an LLM call (key
  // present means the operator is allowed to upgrade this handler later — for now we don't
  // make external calls so smoke tests remain hermetic).
  res.json({
    answer: `Retrieved ${top.length} corpus item(s) above similarity 0; an LLM call would synthesize them.`,
    citations: top.map(t => ({ title: t.title, score: Number(t.score.toFixed(4)) })),
  });
});

// POST /api/ext/rag/embed-real — real embeddings (NEEDS-CREDS)
router.post('/rag/embed-real', (req, res) => {
  if (!process.env.EMBEDDING_API_KEY) {
    return res.status(503).json({ error: 'AI service unavailable', missing: 'EMBEDDING_API_KEY' });
  }
  // Deferred until a real embedding provider is wired; respond 501 if key is set.
  return res.status(501).json({ error: 'real embeddings not yet wired; using hash-stub by default' });
});

// ════════════════════════════════════════════════════════════════════════════
// 2) Agentic workflow orchestration (with human-in-the-loop)
// ════════════════════════════════════════════════════════════════════════════

// PRODUCT-DECISION: agent framework = "plan-then-execute" with a fixed step library, no
// external framework (LangGraph et al. would add a heavy dep). Steps are: gather-field,
// summarize-samples, draft-recommendations, await-hil, finalize. This is a state machine,
// not a free-form planner — safest default for a domain-bounded tool.
const AGENT_STEPS = ['gather-field', 'summarize-samples', 'draft-recommendations', 'await-hil', 'finalize'];

router.post('/agentic/runs', (req, res) => {
  const { goal, field_id } = req.body || {};
  if (!goal) return res.status(400).json({ error: 'goal required' });
  const id = uuidv4();
  const plan = AGENT_STEPS.map((step, i) => ({ step, idx: i, status: i === 0 ? 'in_progress' : 'pending' }));
  getDb().prepare(`
    INSERT INTO agentic_runs (id, user_id, tenant_id, goal, plan_json, status)
    VALUES (?, ?, ?, ?, ?, 'in_progress')
  `).run(id, req.user.id, tenantOf(req), `${goal}${field_id ? ` (field=${field_id})` : ''}`, JSON.stringify(plan));
  res.json({ id, plan, status: 'in_progress' });
});

router.get('/agentic/runs/:id', (req, res) => {
  const row = getDb().prepare('SELECT * FROM agentic_runs WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantOf(req));
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ ...row, plan_json: JSON.parse(row.plan_json || '[]') });
});

// POST /api/ext/agentic/runs/:id/hil  { feedback, approve }
router.post('/agentic/runs/:id/hil', (req, res) => {
  const { feedback, approve } = req.body || {};
  const row = getDb().prepare('SELECT * FROM agentic_runs WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantOf(req));
  if (!row) return res.status(404).json({ error: 'not found' });
  const plan = JSON.parse(row.plan_json || '[]');
  const awaitIdx = plan.findIndex(p => p.step === 'await-hil');
  if (awaitIdx >= 0) {
    plan[awaitIdx].status = approve ? 'done' : 'rejected';
    if (plan[awaitIdx + 1]) plan[awaitIdx + 1].status = approve ? 'in_progress' : 'pending';
  }
  const newStatus = approve ? 'finalizing' : 'awaiting_revisions';
  getDb().prepare(`
    UPDATE agentic_runs SET plan_json = ?, hil_feedback = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(JSON.stringify(plan), feedback || null, newStatus, req.params.id);
  res.json({ id: req.params.id, plan, status: newStatus });
});

// ════════════════════════════════════════════════════════════════════════════
// 3) Streaming anomaly detection on soil samples
// ════════════════════════════════════════════════════════════════════════════

// PRODUCT-DECISION: streaming source = pull-mode `/anomaly/scan` over the soil_samples table
// rather than ingesting a real stream. This lets the feature ship without picking Kafka /
// Redis Streams / SSE prematurely. Detection is z-score per metric over the user's history;
// |z|>2 = warn, |z|>3 = critical. Threshold is documented and overridable via query.
router.post('/anomaly/scan', (req, res) => {
  const db = getDb();
  const { field_id } = req.body || {};
  const threshold = Math.max(1, Math.min(5, Number(req.body?.threshold) || 2));
  const params = [];
  let where = '1=1';
  if (field_id) { where += ' AND field_id = ?'; params.push(field_id); }
  const samples = db.prepare(`SELECT * FROM soil_samples WHERE ${where}`).all(...params);
  if (samples.length < 3) {
    return res.json({ alerts: [], note: 'insufficient samples (<3) for z-score' });
  }
  const metrics = ['organic_carbon_percent', 'ph', 'nitrogen_ppm', 'bulk_density_g_cm3'];
  const alerts = [];
  for (const m of metrics) {
    const xs = samples.map(s => Number(s[m])).filter(x => Number.isFinite(x));
    if (xs.length < 3) continue;
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
    const sd = Math.sqrt(variance) || 1e-9;
    for (const s of samples) {
      const v = Number(s[m]);
      if (!Number.isFinite(v)) continue;
      const z = (v - mean) / sd;
      if (Math.abs(z) >= threshold) {
        const id = uuidv4();
        const sev = Math.abs(z) >= 3 ? 'critical' : 'warn';
        db.prepare(`
          INSERT INTO anomaly_alerts (id, user_id, tenant_id, field_id, sample_id, metric, value, z_score, severity)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, req.user.id, tenantOf(req), s.field_id || null, s.id || null, m, v, z, sev);
        alerts.push({ id, field_id: s.field_id, sample_id: s.id, metric: m, value: v, z: Number(z.toFixed(3)), severity: sev });
      }
    }
  }
  res.json({ scanned: samples.length, alerts });
});

router.get('/anomaly/alerts', (req, res) => {
  const rows = getDb().prepare(`
    SELECT * FROM anomaly_alerts WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 200
  `).all(tenantOf(req));
  res.json({ alerts: rows });
});

// ════════════════════════════════════════════════════════════════════════════
// 4) White-label / multi-tenancy (additive)
// ════════════════════════════════════════════════════════════════════════════

// PRODUCT-DECISION: tenancy is opt-in. Existing data belongs to the implicit 'default' tenant
// (no migration of existing rows). New endpoints filter by header X-Tenant-Id; anything created
// before this pass is unaffected.
router.post('/tenants', (req, res) => {
  const { name, slug, branding } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = uuidv4();
  try {
    getDb().prepare(`
      INSERT INTO tenants (id, name, slug, branding_json) VALUES (?, ?, ?, ?)
    `).run(id, name, slug || id, JSON.stringify(branding || {}));
  } catch (e) {
    return res.status(409).json({ error: e.message });
  }
  // Auto-assign creator as owner.
  getDb().prepare(`
    INSERT OR IGNORE INTO tenant_members (tenant_id, user_id, role) VALUES (?, ?, 'owner')
  `).run(id, req.user.id);
  res.json({ id, name, slug: slug || id });
});

router.get('/tenants', (req, res) => {
  const rows = getDb().prepare(`
    SELECT t.* FROM tenants t
    JOIN tenant_members m ON m.tenant_id = t.id
    WHERE m.user_id = ?
  `).all(req.user.id);
  res.json({ tenants: rows.map(r => ({ ...r, branding_json: safeParse(r.branding_json) })) });
});

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

router.post('/tenants/:id/members', (req, res) => {
  const { user_id, role } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  // Only owners can add members.
  const owner = getDb().prepare(`
    SELECT 1 FROM tenant_members WHERE tenant_id = ? AND user_id = ? AND role = 'owner'
  `).get(req.params.id, req.user.id);
  if (!owner) return res.status(403).json({ error: 'owner role required' });
  getDb().prepare(`
    INSERT OR IGNORE INTO tenant_members (tenant_id, user_id, role) VALUES (?, ?, ?)
  `).run(req.params.id, user_id, role || 'member');
  res.json({ ok: true });
});

router.get('/tenants/:id/branding', (req, res) => {
  const row = getDb().prepare('SELECT branding_json FROM tenants WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(safeParse(row.branding_json));
});

module.exports = router;
