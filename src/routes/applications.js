'use strict';

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const { authenticateToken } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

function paginate(req) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

router.use(authenticateToken);

// GET /api/applications?page=1&limit=20&field_id=xxx
router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const { page, limit, offset } = paginate(req);
    const userId = req.user.id;
    const fieldFilter = req.query.field_id ? 'AND a.field_id = ?' : '';
    const params = req.query.field_id ? [userId, req.query.field_id] : [userId];

    // If field_id given, verify ownership
    if (req.query.field_id) {
      const field = db.prepare('SELECT id FROM fields WHERE id = ? AND user_id = ?').get(req.query.field_id, userId);
      if (!field) return res.status(404).json({ error: 'Field not found' });
    }

    const countParams = [...params];
    const total = db.prepare(`SELECT COUNT(*) as count FROM biochar_applications a WHERE a.user_id = ? ${fieldFilter}`).get(...countParams).count;

    const rows = db.prepare(`
      SELECT a.*, f.name as field_name
      FROM biochar_applications a
      JOIN fields f ON f.id = a.field_id
      WHERE a.user_id = ? ${fieldFilter}
      ORDER BY a.application_date DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/applications/:id
router.get('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT a.*, f.name as field_name
      FROM biochar_applications a
      JOIN fields f ON f.id = a.field_id
      WHERE a.id = ? AND a.user_id = ?
    `).get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Application not found' });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

// POST /api/applications
router.post('/', validate(schemas.application), (req, res, next) => {
  try {
    const db = getDb();
    // Verify field ownership
    const field = db.prepare('SELECT id FROM fields WHERE id = ? AND user_id = ?').get(req.body.field_id, req.user.id);
    if (!field) return res.status(404).json({ error: 'Field not found' });

    const id = uuidv4();
    const { field_id, application_date, biochar_type, biochar_source, quantity_kg, application_depth_cm, application_method, carbon_content_percent, notes } = req.body;

    db.prepare(`
      INSERT INTO biochar_applications (id, field_id, user_id, application_date, biochar_type, biochar_source, quantity_kg, application_depth_cm, application_method, carbon_content_percent, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, field_id, req.user.id, application_date, biochar_type, biochar_source ?? null, quantity_kg, application_depth_cm ?? null, application_method ?? null, carbon_content_percent ?? null, notes ?? null);

    const row = db.prepare('SELECT * FROM biochar_applications WHERE id = ?').get(id);
    res.status(201).json({ data: row, message: 'Biochar application recorded' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/applications/:id
router.put('/:id', validate(schemas.application), (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM biochar_applications WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!existing) return res.status(404).json({ error: 'Application not found' });

    const { field_id, application_date, biochar_type, biochar_source, quantity_kg, application_depth_cm, application_method, carbon_content_percent, notes } = req.body;
    db.prepare(`
      UPDATE biochar_applications
      SET field_id=?, application_date=?, biochar_type=?, biochar_source=?, quantity_kg=?, application_depth_cm=?, application_method=?, carbon_content_percent=?, notes=?, updated_at=CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(field_id, application_date, biochar_type, biochar_source ?? null, quantity_kg, application_depth_cm ?? null, application_method ?? null, carbon_content_percent ?? null, notes ?? null, req.params.id, req.user.id);

    const updated = db.prepare('SELECT * FROM biochar_applications WHERE id = ?').get(req.params.id);
    res.json({ data: updated, message: 'Application updated successfully' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/applications/:id
router.delete('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM biochar_applications WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!existing) return res.status(404).json({ error: 'Application not found' });
    db.prepare('DELETE FROM biochar_applications WHERE id = ?').run(req.params.id);
    res.json({ message: 'Application deleted' });
  } catch (err) {
    next(err);
  }
});

// GET /api/applications/stats/summary — aggregated stats per biochar type
router.get('/stats/summary', (req, res, next) => {
  try {
    const db = getDb();
    const stats = db.prepare(`
      SELECT
        biochar_type,
        COUNT(*) as application_count,
        SUM(quantity_kg) as total_kg,
        AVG(quantity_kg) as avg_kg,
        AVG(carbon_content_percent) as avg_carbon_pct,
        MIN(application_date) as first_application,
        MAX(application_date) as last_application
      FROM biochar_applications
      WHERE user_id = ?
      GROUP BY biochar_type
      ORDER BY total_kg DESC
    `).all(req.user.id);
    res.json({ data: stats });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
