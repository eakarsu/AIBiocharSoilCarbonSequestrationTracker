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

// GET /api/soil-samples?page=1&limit=20&field_id=xxx
router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const { page, limit, offset } = paginate(req);
    const userId = req.user.id;
    const fieldFilter = req.query.field_id ? 'AND s.field_id = ?' : '';
    const params = req.query.field_id ? [userId, req.query.field_id] : [userId];

    const total = db.prepare(`SELECT COUNT(*) as count FROM soil_samples s WHERE s.user_id = ? ${fieldFilter}`).get(...params).count;
    const rows = db.prepare(`
      SELECT s.*, f.name as field_name
      FROM soil_samples s
      JOIN fields f ON f.id = s.field_id
      WHERE s.user_id = ? ${fieldFilter}
      ORDER BY s.sample_date DESC
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

// GET /api/soil-samples/:id
router.get('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT s.*, f.name as field_name
      FROM soil_samples s
      JOIN fields f ON f.id = s.field_id
      WHERE s.id = ? AND s.user_id = ?
    `).get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Soil sample not found' });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

// POST /api/soil-samples
router.post('/', validate(schemas.soilSample), (req, res, next) => {
  try {
    const db = getDb();
    const field = db.prepare('SELECT id FROM fields WHERE id = ? AND user_id = ?').get(req.body.field_id, req.user.id);
    if (!field) return res.status(404).json({ error: 'Field not found' });

    const id = uuidv4();
    const { field_id, sample_date, depth_cm, organic_carbon_percent, bulk_density_g_cm3, ph, nitrogen_ppm, phosphorus_ppm, potassium_ppm, moisture_percent, microbial_biomass_mg_kg, notes } = req.body;

    db.prepare(`
      INSERT INTO soil_samples (id, field_id, user_id, sample_date, depth_cm, organic_carbon_percent, bulk_density_g_cm3, ph, nitrogen_ppm, phosphorus_ppm, potassium_ppm, moisture_percent, microbial_biomass_mg_kg, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, field_id, req.user.id, sample_date, depth_cm, organic_carbon_percent ?? null, bulk_density_g_cm3 ?? null, ph ?? null, nitrogen_ppm ?? null, phosphorus_ppm ?? null, potassium_ppm ?? null, moisture_percent ?? null, microbial_biomass_mg_kg ?? null, notes ?? null);

    const row = db.prepare('SELECT * FROM soil_samples WHERE id = ?').get(id);
    res.status(201).json({ data: row, message: 'Soil sample recorded' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/soil-samples/:id
router.put('/:id', validate(schemas.soilSample), (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM soil_samples WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!existing) return res.status(404).json({ error: 'Soil sample not found' });

    const { field_id, sample_date, depth_cm, organic_carbon_percent, bulk_density_g_cm3, ph, nitrogen_ppm, phosphorus_ppm, potassium_ppm, moisture_percent, microbial_biomass_mg_kg, notes } = req.body;
    db.prepare(`
      UPDATE soil_samples
      SET field_id=?, sample_date=?, depth_cm=?, organic_carbon_percent=?, bulk_density_g_cm3=?, ph=?, nitrogen_ppm=?, phosphorus_ppm=?, potassium_ppm=?, moisture_percent=?, microbial_biomass_mg_kg=?, notes=?, updated_at=CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(field_id, sample_date, depth_cm, organic_carbon_percent ?? null, bulk_density_g_cm3 ?? null, ph ?? null, nitrogen_ppm ?? null, phosphorus_ppm ?? null, potassium_ppm ?? null, moisture_percent ?? null, microbial_biomass_mg_kg ?? null, notes ?? null, req.params.id, req.user.id);

    const updated = db.prepare('SELECT * FROM soil_samples WHERE id = ?').get(req.params.id);
    res.json({ data: updated, message: 'Soil sample updated' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/soil-samples/:id
router.delete('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM soil_samples WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!existing) return res.status(404).json({ error: 'Soil sample not found' });
    db.prepare('DELETE FROM soil_samples WHERE id = ?').run(req.params.id);
    res.json({ message: 'Soil sample deleted' });
  } catch (err) {
    next(err);
  }
});

// GET /api/soil-samples/trends/:fieldId — trend data for charts
router.get('/trends/:fieldId', (req, res, next) => {
  try {
    const db = getDb();
    const field = db.prepare('SELECT * FROM fields WHERE id = ? AND user_id = ?').get(req.params.fieldId, req.user.id);
    if (!field) return res.status(404).json({ error: 'Field not found' });

    const samples = db.prepare(`
      SELECT sample_date, depth_cm,
        AVG(organic_carbon_percent) as avg_soc,
        AVG(ph) as avg_ph,
        AVG(nitrogen_ppm) as avg_n,
        AVG(phosphorus_ppm) as avg_p,
        AVG(potassium_ppm) as avg_k,
        AVG(moisture_percent) as avg_moisture,
        AVG(microbial_biomass_mg_kg) as avg_microbial
      FROM soil_samples
      WHERE field_id = ? AND user_id = ?
      GROUP BY sample_date
      ORDER BY sample_date ASC
    `).all(req.params.fieldId, req.user.id);

    // Compute soil health score per sample date
    const trendsWithScore = samples.map(s => {
      let score = 0;
      let factors = 0;
      if (s.avg_soc !== null) { score += Math.min(s.avg_soc * 10, 30); factors++; }
      if (s.avg_ph !== null) { score += s.avg_ph >= 6 && s.avg_ph <= 7.5 ? 20 : 10; factors++; }
      if (s.avg_n !== null) { score += Math.min(s.avg_n / 5, 20); factors++; }
      if (s.avg_microbial !== null) { score += Math.min(s.avg_microbial / 50, 30); factors++; }
      const health_score = factors > 0 ? Math.min(Math.round(score), 100) : null;
      return { ...s, health_score };
    });

    res.json({ data: { field, trends: trendsWithScore } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
