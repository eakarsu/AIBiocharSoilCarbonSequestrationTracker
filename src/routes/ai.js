'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');
const { authenticateToken } = require('../middleware/auth');
const { aiRateLimiter } = require('../middleware/rateLimiter');
const aiService = require('../services/aiService');

// All AI routes require auth + rate limiting
router.use(authenticateToken);
router.use(aiRateLimiter);

// POST /api/ai/analyze-sequestration — full carbon sequestration analysis for a field
router.post('/analyze-sequestration', async (req, res, next) => {
  try {
    const { field_id } = req.body;
    if (!field_id) return res.status(400).json({ error: 'field_id required' });

    const db = getDb();
    const field = db.prepare('SELECT * FROM fields WHERE id = ? AND user_id = ?').get(field_id, req.user.id);
    if (!field) return res.status(404).json({ error: 'Field not found' });

    const applications = db.prepare('SELECT * FROM biochar_applications WHERE field_id = ? ORDER BY application_date DESC').all(field_id);
    const soilSamples = db.prepare('SELECT * FROM soil_samples WHERE field_id = ? ORDER BY sample_date DESC').all(field_id);

    const { result, resultId, tokensUsed } = await aiService.analyzeSequestration({
      field, applications, soilSamples, userId: req.user.id,
    });

    res.json({
      data: result,
      meta: { result_id: resultId, tokens_used: tokensUsed, model: 'claude-3-5-sonnet-20241022' },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/soil-health — soil health analysis
router.post('/soil-health', async (req, res, next) => {
  try {
    const { field_id } = req.body;
    if (!field_id) return res.status(400).json({ error: 'field_id required' });

    const db = getDb();
    const field = db.prepare('SELECT * FROM fields WHERE id = ? AND user_id = ?').get(field_id, req.user.id);
    if (!field) return res.status(404).json({ error: 'Field not found' });

    const soilSamples = db.prepare('SELECT * FROM soil_samples WHERE field_id = ? ORDER BY sample_date DESC').all(field_id);
    if (soilSamples.length === 0) {
      return res.status(400).json({ error: 'No soil samples found for this field. Add soil samples before running analysis.' });
    }

    const { result, resultId, tokensUsed } = await aiService.analyzeSoilHealth({
      field, soilSamples, userId: req.user.id,
    });

    res.json({
      data: result,
      meta: { result_id: resultId, tokens_used: tokensUsed, model: 'claude-3-5-sonnet-20241022' },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/recommendations — biochar application recommendations
router.post('/recommendations', async (req, res, next) => {
  try {
    const { field_id } = req.body;
    if (!field_id) return res.status(400).json({ error: 'field_id required' });

    const db = getDb();
    const field = db.prepare('SELECT * FROM fields WHERE id = ? AND user_id = ?').get(field_id, req.user.id);
    if (!field) return res.status(404).json({ error: 'Field not found' });

    const applications = db.prepare('SELECT * FROM biochar_applications WHERE field_id = ? ORDER BY application_date DESC').all(field_id);
    const soilSamples = db.prepare('SELECT * FROM soil_samples WHERE field_id = ? ORDER BY sample_date DESC').all(field_id);

    const { result, resultId, tokensUsed } = await aiService.getBiocharRecommendations({
      field, applications, soilSamples, userId: req.user.id,
    });

    res.json({
      data: result,
      meta: { result_id: resultId, tokens_used: tokensUsed, model: 'claude-3-5-sonnet-20241022' },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/validate-report — carbon market compliance validation
router.post('/validate-report', async (req, res, next) => {
  try {
    const { report_id } = req.body;
    if (!report_id) return res.status(400).json({ error: 'report_id required' });

    const db = getDb();
    const report = db.prepare('SELECT * FROM carbon_reports WHERE id = ? AND user_id = ?').get(report_id, req.user.id);
    if (!report) return res.status(404).json({ error: 'Carbon report not found' });

    const field = db.prepare('SELECT * FROM fields WHERE id = ?').get(report.field_id);
    const applications = db.prepare(`
      SELECT * FROM biochar_applications
      WHERE field_id = ? AND application_date BETWEEN ? AND ?
    `).all(report.field_id, report.report_period_start, report.report_period_end);

    const { result, resultId, tokensUsed } = await aiService.validateCarbonReport({
      report, field, applications, userId: req.user.id,
    });

    res.json({
      data: result,
      meta: { result_id: resultId, tokens_used: tokensUsed, model: 'claude-3-5-sonnet-20241022' },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/portfolio — analyze all user fields as a portfolio
router.post('/portfolio', async (req, res, next) => {
  try {
    const db = getDb();
    const fields = db.prepare(`
      SELECT f.*,
        COUNT(DISTINCT a.id) as application_count,
        SUM(a.quantity_kg) as total_biochar_kg,
        MAX(r.net_carbon_credits) as estimated_sequestered
      FROM fields f
      LEFT JOIN biochar_applications a ON a.field_id = f.id
      LEFT JOIN carbon_reports r ON r.field_id = f.id
      WHERE f.user_id = ?
      GROUP BY f.id
    `).all(req.user.id);

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields found. Add fields before running portfolio analysis.' });
    }

    const { result, resultId, tokensUsed } = await aiService.analyzeFieldPortfolio({
      fields, userId: req.user.id,
    });

    res.json({
      data: result,
      meta: { result_id: resultId, tokens_used: tokensUsed, model: 'claude-3-5-sonnet-20241022' },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/ai/results?entity_type=field&entity_id=xxx&analysis_type=sequestration_analysis
router.get('/results', (req, res, next) => {
  try {
    const { entity_type, entity_id, analysis_type } = req.query;
    if (!entity_type || !entity_id) {
      return res.status(400).json({ error: 'entity_type and entity_id required' });
    }

    const results = aiService.getAIResults({
      entityType: entity_type,
      entityId: entity_id,
      analysisType: analysis_type,
      limit: parseInt(req.query.limit) || 10,
    });

    res.json({ data: results });
  } catch (err) {
    next(err);
  }
});

// GET /api/ai/history — recent AI analyses for the user
router.get('/history', (req, res, next) => {
  try {
    const db = getDb();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const total = db.prepare('SELECT COUNT(*) as count FROM ai_results WHERE user_id = ?').get(req.user.id).count;
    const results = db.prepare(`
      SELECT id, entity_type, entity_id, analysis_type, model, prompt_summary, tokens_used, created_at
      FROM ai_results
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(req.user.id, limit, offset);

    res.json({
      data: results,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
