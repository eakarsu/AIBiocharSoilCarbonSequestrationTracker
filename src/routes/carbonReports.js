'use strict';

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

function paginate(req) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

router.use(authenticateToken);

// GET /api/carbon-reports?page=1&limit=20&field_id=xxx&status=pending
router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const { page, limit, offset } = paginate(req);
    const userId = req.user.id;

    let where = 'r.user_id = ?';
    const params = [userId];

    if (req.query.field_id) { where += ' AND r.field_id = ?'; params.push(req.query.field_id); }
    if (req.query.status) { where += ' AND r.verification_status = ?'; params.push(req.query.status); }

    const total = db.prepare(`SELECT COUNT(*) as count FROM carbon_reports r WHERE ${where}`).get(...params).count;
    const rows = db.prepare(`
      SELECT r.*, f.name as field_name, f.area_hectares
      FROM carbon_reports r
      JOIN fields f ON f.id = r.field_id
      WHERE ${where}
      ORDER BY r.created_at DESC
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

// GET /api/carbon-reports/:id
router.get('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT r.*, f.name as field_name, f.area_hectares, f.soil_type, f.climate_zone
      FROM carbon_reports r
      JOIN fields f ON f.id = r.field_id
      WHERE r.id = ? AND r.user_id = ?
    `).get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Carbon report not found' });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

// POST /api/carbon-reports — auto-calculate from applications if not provided
router.post('/', validate(schemas.carbonReport), (req, res, next) => {
  try {
    const db = getDb();
    const field = db.prepare('SELECT id FROM fields WHERE id = ? AND user_id = ?').get(req.body.field_id, req.user.id);
    if (!field) return res.status(404).json({ error: 'Field not found' });

    const { field_id, report_period_start, report_period_end, methodology, notes } = req.body;
    let { total_biochar_applied_kg, estimated_carbon_sequestered_tco2e, baseline_carbon_tco2e, net_carbon_credits } = req.body;

    // Auto-calculate from applications in period if not provided
    if (!total_biochar_applied_kg) {
      const apps = db.prepare(`
        SELECT SUM(quantity_kg) as total, AVG(carbon_content_percent) as avg_c
        FROM biochar_applications
        WHERE field_id = ? AND application_date BETWEEN ? AND ?
      `).get(field_id, report_period_start, report_period_end);
      total_biochar_applied_kg = apps.total || 0;
      if (!estimated_carbon_sequestered_tco2e) {
        const avgC = apps.avg_c || 70;
        estimated_carbon_sequestered_tco2e = (total_biochar_applied_kg / 1000) * (avgC / 100) * 3.67 * 0.9;
      }
    }

    if (!baseline_carbon_tco2e) baseline_carbon_tco2e = 0;
    if (!net_carbon_credits) net_carbon_credits = (estimated_carbon_sequestered_tco2e || 0) - baseline_carbon_tco2e;

    const id = uuidv4();
    db.prepare(`
      INSERT INTO carbon_reports (id, field_id, user_id, report_period_start, report_period_end, total_biochar_applied_kg, estimated_carbon_sequestered_tco2e, baseline_carbon_tco2e, net_carbon_credits, methodology, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, field_id, req.user.id, report_period_start, report_period_end, total_biochar_applied_kg, estimated_carbon_sequestered_tco2e, baseline_carbon_tco2e, net_carbon_credits, methodology || 'Biochar Carbon Removal', notes ?? null);

    const row = db.prepare('SELECT * FROM carbon_reports WHERE id = ?').get(id);
    res.status(201).json({ data: row, message: 'Carbon report created' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/carbon-reports/:id
router.put('/:id', validate(schemas.carbonReport), (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT id, verification_status FROM carbon_reports WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!existing) return res.status(404).json({ error: 'Carbon report not found' });
    if (existing.verification_status === 'verified') {
      return res.status(409).json({ error: 'Cannot edit a verified report' });
    }

    const { field_id, report_period_start, report_period_end, total_biochar_applied_kg, estimated_carbon_sequestered_tco2e, baseline_carbon_tco2e, net_carbon_credits, methodology, notes } = req.body;
    db.prepare(`
      UPDATE carbon_reports
      SET field_id=?, report_period_start=?, report_period_end=?, total_biochar_applied_kg=?, estimated_carbon_sequestered_tco2e=?, baseline_carbon_tco2e=?, net_carbon_credits=?, methodology=?, notes=?, updated_at=CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(field_id, report_period_start, report_period_end, total_biochar_applied_kg ?? null, estimated_carbon_sequestered_tco2e ?? null, baseline_carbon_tco2e ?? null, net_carbon_credits ?? null, methodology || 'Biochar Carbon Removal', notes ?? null, req.params.id, req.user.id);

    const updated = db.prepare('SELECT * FROM carbon_reports WHERE id = ?').get(req.params.id);
    res.json({ data: updated, message: 'Carbon report updated' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/carbon-reports/:id
router.delete('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT id, verification_status FROM carbon_reports WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!existing) return res.status(404).json({ error: 'Carbon report not found' });
    if (existing.verification_status === 'verified') {
      return res.status(409).json({ error: 'Cannot delete a verified report' });
    }
    db.prepare('DELETE FROM carbon_reports WHERE id = ?').run(req.params.id);
    res.json({ message: 'Carbon report deleted' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/carbon-reports/:id/verify — admin/researcher only
router.put('/:id/verify', validate(schemas.verification), requireRole('admin', 'researcher'), (req, res, next) => {
  try {
    const db = getDb();
    const report = db.prepare('SELECT id FROM carbon_reports WHERE id = ?').get(req.params.id);
    if (!report) return res.status(404).json({ error: 'Carbon report not found' });

    const { verification_status, verified_by, notes } = req.body;
    const verifiedAt = verification_status === 'verified' ? new Date().toISOString() : null;

    db.prepare(`
      UPDATE carbon_reports
      SET verification_status=?, verified_by=?, verified_at=?, notes=COALESCE(?, notes), updated_at=CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(verification_status, verified_by ?? null, verifiedAt, notes ?? null, req.params.id);

    const updated = db.prepare('SELECT * FROM carbon_reports WHERE id = ?').get(req.params.id);
    res.json({ data: updated, message: `Report ${verification_status}` });
  } catch (err) {
    next(err);
  }
});

// GET /api/carbon-reports/:id/export — JSON export with all supporting data
router.get('/:id/export', (req, res, next) => {
  try {
    const db = getDb();
    const report = db.prepare(`
      SELECT r.*, f.name as field_name, f.area_hectares, f.soil_type, f.climate_zone, f.location_lat, f.location_lng,
             u.name as user_name, u.email as user_email, u.organization
      FROM carbon_reports r
      JOIN fields f ON f.id = r.field_id
      JOIN users u ON u.id = r.user_id
      WHERE r.id = ? AND r.user_id = ?
    `).get(req.params.id, req.user.id);
    if (!report) return res.status(404).json({ error: 'Carbon report not found' });

    const applications = db.prepare(`
      SELECT * FROM biochar_applications
      WHERE field_id = ? AND application_date BETWEEN ? AND ?
      ORDER BY application_date ASC
    `).all(report.field_id, report.report_period_start, report.report_period_end);

    const soilSamples = db.prepare(`
      SELECT * FROM soil_samples
      WHERE field_id = ? AND sample_date BETWEEN ? AND ?
      ORDER BY sample_date ASC
    `).all(report.field_id, report.report_period_start, report.report_period_end);

    const aiResults = db.prepare(`
      SELECT analysis_type, model, result_json, tokens_used, created_at
      FROM ai_results
      WHERE entity_id = ? AND entity_type = 'carbon_report'
      ORDER BY created_at DESC LIMIT 5
    `).all(report.id).map(r => ({ ...r, result_json: JSON.parse(r.result_json) }));

    const exportData = {
      report_metadata: {
        export_date: new Date().toISOString(),
        methodology_version: '1.0',
        standard: report.methodology,
      },
      report,
      supporting_data: {
        biochar_applications: applications,
        soil_samples: soilSamples,
        ai_analyses: aiResults,
      },
      carbon_calculations: {
        total_biochar_tonnes: (report.total_biochar_applied_kg || 0) / 1000,
        gross_sequestration_tco2e: report.estimated_carbon_sequestered_tco2e,
        baseline_emissions_tco2e: report.baseline_carbon_tco2e,
        net_removals_tco2e: report.net_carbon_credits,
        per_hectare_tco2e: report.net_carbon_credits && report.area_hectares
          ? (report.net_carbon_credits / report.area_hectares).toFixed(4)
          : null,
      },
    };

    res.setHeader('Content-Disposition', `attachment; filename="carbon-report-${report.id}.json"`);
    res.json(exportData);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
