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

// All routes require auth
router.use(authenticateToken);

// GET /api/fields?page=1&limit=20
router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const { page, limit, offset } = paginate(req);
    const userId = req.user.id;

    const total = db.prepare('SELECT COUNT(*) as count FROM fields WHERE user_id = ?').get(userId).count;
    const fields = db.prepare(`
      SELECT f.*,
        (SELECT COUNT(*) FROM biochar_applications WHERE field_id = f.id) as application_count,
        (SELECT COUNT(*) FROM soil_samples WHERE field_id = f.id) as sample_count,
        (SELECT COUNT(*) FROM carbon_reports WHERE field_id = f.id) as report_count
      FROM fields f
      WHERE f.user_id = ?
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?
    `).all(userId, limit, offset);

    res.json({
      data: fields,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/fields/:id
router.get('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const field = db.prepare(`
      SELECT f.*,
        (SELECT COUNT(*) FROM biochar_applications WHERE field_id = f.id) as application_count,
        (SELECT COUNT(*) FROM soil_samples WHERE field_id = f.id) as sample_count,
        (SELECT COUNT(*) FROM carbon_reports WHERE field_id = f.id) as report_count,
        (SELECT SUM(quantity_kg) FROM biochar_applications WHERE field_id = f.id) as total_biochar_kg,
        (SELECT MAX(sample_date) FROM soil_samples WHERE field_id = f.id) as last_sample_date
      FROM fields f
      WHERE f.id = ? AND f.user_id = ?
    `).get(req.params.id, req.user.id);

    if (!field) return res.status(404).json({ error: 'Field not found' });
    res.json({ data: field });
  } catch (err) {
    next(err);
  }
});

// POST /api/fields
router.post('/', validate(schemas.field), (req, res, next) => {
  try {
    const db = getDb();
    const id = uuidv4();
    const { name, location_lat, location_lng, area_hectares, soil_type, climate_zone, description } = req.body;

    db.prepare(`
      INSERT INTO fields (id, user_id, name, location_lat, location_lng, area_hectares, soil_type, climate_zone, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user.id, name, location_lat ?? null, location_lng ?? null, area_hectares, soil_type ?? null, climate_zone ?? null, description ?? null);

    const field = db.prepare('SELECT * FROM fields WHERE id = ?').get(id);
    res.status(201).json({ data: field, message: 'Field created successfully' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/fields/:id
router.put('/:id', validate(schemas.field), (req, res, next) => {
  try {
    const db = getDb();
    const field = db.prepare('SELECT id FROM fields WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!field) return res.status(404).json({ error: 'Field not found' });

    const { name, location_lat, location_lng, area_hectares, soil_type, climate_zone, description } = req.body;
    db.prepare(`
      UPDATE fields SET name=?, location_lat=?, location_lng=?, area_hectares=?, soil_type=?, climate_zone=?, description=?, updated_at=CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(name, location_lat ?? null, location_lng ?? null, area_hectares, soil_type ?? null, climate_zone ?? null, description ?? null, req.params.id, req.user.id);

    const updated = db.prepare('SELECT * FROM fields WHERE id = ?').get(req.params.id);
    res.json({ data: updated, message: 'Field updated successfully' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/fields/:id
router.delete('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const field = db.prepare('SELECT id FROM fields WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!field) return res.status(404).json({ error: 'Field not found' });

    db.prepare('DELETE FROM fields WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ message: 'Field deleted successfully' });
  } catch (err) {
    next(err);
  }
});

// GET /api/fields/:id/summary — carbon summary for a field
router.get('/:id/summary', (req, res, next) => {
  try {
    const db = getDb();
    const field = db.prepare('SELECT * FROM fields WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!field) return res.status(404).json({ error: 'Field not found' });

    const applications = db.prepare('SELECT * FROM biochar_applications WHERE field_id = ? ORDER BY application_date DESC').all(req.params.id);
    const samples = db.prepare('SELECT * FROM soil_samples WHERE field_id = ? ORDER BY sample_date DESC').all(req.params.id);
    const reports = db.prepare('SELECT * FROM carbon_reports WHERE field_id = ? ORDER BY created_at DESC').all(req.params.id);

    const totalBiocharKg = applications.reduce((s, a) => s + a.quantity_kg, 0);
    // Illustrative, unverified estimate only; governed MRV requires measured evidence.
    const estimatedTco2e = applications.reduce((s, a) => {
      const cPct = a.carbon_content_percent || 70;
      return s + (a.quantity_kg / 1000) * (cPct / 100) * 3.67 * 0.9; // 90% permanence
    }, 0);

    const latestSoc = samples.length > 0 ? samples[0].organic_carbon_percent : null;

    res.json({
      data: {
        field,
        totals: {
          total_biochar_kg: Math.round(totalBiocharKg * 100) / 100,
          estimated_sequestered_tco2e: Math.round(estimatedTco2e * 100) / 100,
          estimate_status: 'unverified_not_for_issuance',
          application_count: applications.length,
          sample_count: samples.length,
          report_count: reports.length,
          latest_soc_percent: latestSoc,
        },
        recent_applications: applications.slice(0, 5),
        recent_samples: samples.slice(0, 5),
        recent_reports: reports.slice(0, 3),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
