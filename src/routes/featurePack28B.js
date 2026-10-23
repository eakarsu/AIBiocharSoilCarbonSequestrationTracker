'use strict';
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const { authenticateToken } = require('../middleware/auth');
const core = require('../featurePack28B');
let ensured = false;
function ensure(db) { if (ensured) return; db.exec(`CREATE TABLE IF NOT EXISTS feature_pack_tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, status TEXT DEFAULT 'todo', priority TEXT DEFAULT 'medium', assignee TEXT, related_type TEXT, related_id TEXT, owner TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`); ensured = true; }
const store = {
  async list(owner) { const db = getDb(); ensure(db); return db.prepare('SELECT * FROM feature_pack_tasks WHERE owner=? ORDER BY created_at DESC').all(owner); },
  async create(d) { const db = getDb(); ensure(db); const id = uuidv4(); db.prepare(`INSERT INTO feature_pack_tasks (id,title,description,status,priority,assignee,related_type,related_id,owner) VALUES (?,?,?,?,?,?,?,?,?)`).run(id, d.title, d.description||null, d.status||'todo', d.priority||'medium', d.assignee||null, d.related_type||null, d.related_id||null, d.owner); return db.prepare('SELECT * FROM feature_pack_tasks WHERE id=?').get(id); },
  async update(id, d, owner) { const db = getDb(); ensure(db); const cur = db.prepare('SELECT * FROM feature_pack_tasks WHERE id=? AND owner=?').get(id, owner); if (!cur) return null; const m = { ...cur, ...d }; db.prepare(`UPDATE feature_pack_tasks SET title=?,description=?,status=?,priority=?,assignee=?,related_type=?,related_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner=?`).run(m.title, m.description, m.status, m.priority, m.assignee, m.related_type, m.related_id, id, owner); return db.prepare('SELECT * FROM feature_pack_tasks WHERE id=?').get(id); },
};
async function listMainRecords(req) { const db = getDb(); return db.prepare('SELECT * FROM fields WHERE user_id=? ORDER BY created_at DESC LIMIT 5000').all(req.user.id); }
module.exports = core.createFeaturePackRouter({ auth: authenticateToken, store, listMainRecords, aiFeatures: core.AI_FEATURES, mainName: 'fields', exportFilename: 'fields', searchFields: ['name','soil_type','climate_zone','crop_type','description'], filterFields: ['soil_type','crop_type','climate_zone'] });
module.exports.store = store; module.exports.listMainRecords = listMainRecords;
