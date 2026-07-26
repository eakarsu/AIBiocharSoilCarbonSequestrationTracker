'use strict';
const crypto = require('crypto');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const { authenticateToken } = require('../middleware/auth');
const { MrvError, calculateMrvRecord, verifyRecord } = require('../domain/mrvLifecycle');
const router = express.Router();

const actorContext = (db, id) => db.prepare('SELECT id, role, organization FROM users WHERE id = ?').get(id);
const tenantFor = (actor) => actor.organization ? `organization:${actor.organization}` : `user:${actor.id}`;

router.post('/', authenticateToken, (req, res, next) => {
  try {
    const key = req.get('Idempotency-Key');
    if (!key || key.length > 200) return res.status(400).json({ error: 'A valid Idempotency-Key header is required' });
    const db = getDb();
    const actor = actorContext(db, req.user.id);
    if (!actor) return res.status(401).json({ error: 'User no longer exists' });
    const tenantId = tenantFor(actor);
    const requestHash = crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
    const existing = db.prepare('SELECT * FROM mrv_workflows WHERE tenant_id=? AND idempotency_key=?').get(tenantId, key);
    if (existing) {
      if (existing.request_hash !== requestHash) return res.status(409).json({ error: 'Idempotency-Key was already used with different input' });
      return res.json({ workflow: { ...existing, record: JSON.parse(existing.record_json) }, replayed: true });
    }
    const record = { ...calculateMrvRecord(req.body), projectOrganization: actor.organization || null };
    const id = uuidv4();
    db.transaction(() => {
      db.prepare(`INSERT INTO mrv_workflows (id,tenant_id,idempotency_key,request_hash,project_id,status,record_json,created_by)
        VALUES (?,?,?,?,?,?,?,?)`).run(id, tenantId, key, requestHash, record.projectId, record.status, JSON.stringify(record), actor.id);
      db.prepare(`INSERT INTO mrv_workflow_events (id,workflow_id,tenant_id,actor_id,event_type,to_status,evidence_hash)
        VALUES (?,?,?,?,?,?,?)`).run(uuidv4(), id, tenantId, actor.id, 'mrv.created', record.status, record.recordHash);
    })();
    res.status(201).json({ workflow: { id, tenant_id: tenantId, status: record.status, record } });
  } catch (error) {
    if (error instanceof MrvError) return res.status(422).json({ error: error.message, code: error.code });
    if (/no such table/.test(error.message)) return res.status(503).json({ error: 'Run npm run db:migrate before creating workflows', code: 'MIGRATION_REQUIRED' });
    next(error);
  }
});

router.get('/:id', authenticateToken, (req, res, next) => {
  try {
    const db = getDb(); const actor = actorContext(db, req.user.id); if (!actor) return res.status(401).json({ error: 'User no longer exists' });
    const row = db.prepare('SELECT * FROM mrv_workflows WHERE id=? AND tenant_id=?').get(req.params.id, tenantFor(actor));
    if (!row) return res.status(404).json({ error: 'Workflow not found' });
    const events = db.prepare('SELECT * FROM mrv_workflow_events WHERE workflow_id=? ORDER BY created_at').all(row.id);
    res.json({ workflow: { ...row, record: JSON.parse(row.record_json), events } });
  } catch (error) { next(error); }
});

router.post('/:id/verify', authenticateToken, (req, res, next) => {
  try {
    const db = getDb(); const actor = actorContext(db, req.user.id); if (!actor) return res.status(401).json({ error: 'User no longer exists' });
    const row = db.prepare('SELECT * FROM mrv_workflows WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Workflow not found' });
    const record = verifyRecord(JSON.parse(row.record_json), actor);
    db.transaction(() => {
      const result = db.prepare(`UPDATE mrv_workflows SET status=?,record_json=?,verified_by=?,version=version+1,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND version=?`).run(record.status, JSON.stringify(record), actor.id, row.id, row.version);
      if (result.changes !== 1) throw new MrvError('CONCURRENT_CHANGE', 'workflow was concurrently modified');
      db.prepare(`INSERT INTO mrv_workflow_events (id,workflow_id,tenant_id,actor_id,event_type,from_status,to_status,evidence_hash)
        VALUES (?,?,?,?,?,?,?,?)`).run(uuidv4(), row.id, row.tenant_id, actor.id, 'mrv.verified', row.status, record.status, record.recordHash);
    })();
    res.json({ workflow: { id: row.id, status: record.status, record } });
  } catch (error) {
    if (error instanceof MrvError) return res.status(error.code === 'FORBIDDEN' || error.code === 'INDEPENDENCE_REQUIRED' ? 403 : 409).json({ error: error.message, code: error.code });
    next(error);
  }
});

module.exports = router;
