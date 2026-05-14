'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

// GET /api/dashboard — aggregated stats for logged-in user
router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const userId = req.user.id;

    const fieldCount = db.prepare('SELECT COUNT(*) as count FROM fields WHERE user_id = ?').get(userId).count;
    const applicationStats = db.prepare(`
      SELECT COUNT(*) as count, SUM(quantity_kg) as total_kg, AVG(carbon_content_percent) as avg_c_pct
      FROM biochar_applications WHERE user_id = ?
    `).get(userId);
    const sampleCount = db.prepare('SELECT COUNT(*) as count FROM soil_samples WHERE user_id = ?').get(userId).count;
    const reportStats = db.prepare(`
      SELECT COUNT(*) as count,
        SUM(net_carbon_credits) as total_credits,
        SUM(estimated_carbon_sequestered_tco2e) as total_sequestered,
        SUM(CASE WHEN verification_status = 'verified' THEN net_carbon_credits ELSE 0 END) as verified_credits
      FROM carbon_reports WHERE user_id = ?
    `).get(userId);
    const aiCount = db.prepare('SELECT COUNT(*) as count FROM ai_results WHERE user_id = ?').get(userId).count;

    // Monthly sequestration trend (last 12 months)
    const monthlyTrend = db.prepare(`
      SELECT strftime('%Y-%m', application_date) as month,
        SUM(quantity_kg) as biochar_kg,
        COUNT(*) as application_count
      FROM biochar_applications
      WHERE user_id = ? AND application_date >= date('now', '-12 months')
      GROUP BY month
      ORDER BY month ASC
    `).all(userId);

    // Top fields by sequestration
    const topFields = db.prepare(`
      SELECT f.id, f.name, f.area_hectares, f.soil_type,
        SUM(a.quantity_kg) as total_biochar_kg,
        COUNT(a.id) as application_count,
        MAX(r.net_carbon_credits) as best_report_credits
      FROM fields f
      LEFT JOIN biochar_applications a ON a.field_id = f.id
      LEFT JOIN carbon_reports r ON r.field_id = f.id
      WHERE f.user_id = ?
      GROUP BY f.id
      ORDER BY total_biochar_kg DESC
      LIMIT 5
    `).all(userId);

    // Recent activity
    const recentApplications = db.prepare(`
      SELECT a.*, f.name as field_name
      FROM biochar_applications a JOIN fields f ON f.id = a.field_id
      WHERE a.user_id = ?
      ORDER BY a.created_at DESC LIMIT 5
    `).all(userId);

    const recentSamples = db.prepare(`
      SELECT s.*, f.name as field_name
      FROM soil_samples s JOIN fields f ON f.id = s.field_id
      WHERE s.user_id = ?
      ORDER BY s.created_at DESC LIMIT 5
    `).all(userId);

    const pendingReports = db.prepare(`
      SELECT r.*, f.name as field_name
      FROM carbon_reports r JOIN fields f ON f.id = r.field_id
      WHERE r.user_id = ? AND r.verification_status = 'pending'
      ORDER BY r.created_at DESC LIMIT 5
    `).all(userId);

    // Credit valuation at voluntary market prices
    const totalCredits = reportStats.total_credits || 0;
    const verifiedCredits = reportStats.verified_credits || 0;
    const estimatedValue = totalCredits * 35; // ~$35/tCO2e
    const verifiedValue = verifiedCredits * 55; // ~$55/tCO2e for verified

    res.json({
      data: {
        summary: {
          fields: fieldCount,
          total_biochar_kg: Math.round((applicationStats.total_kg || 0) * 100) / 100,
          total_applications: applicationStats.count,
          soil_samples: sampleCount,
          carbon_reports: reportStats.count,
          total_sequestered_tco2e: Math.round((reportStats.total_sequestered || 0) * 100) / 100,
          total_carbon_credits: Math.round((totalCredits || 0) * 100) / 100,
          verified_carbon_credits: Math.round((verifiedCredits || 0) * 100) / 100,
          estimated_portfolio_value_usd: Math.round(estimatedValue * 100) / 100,
          verified_portfolio_value_usd: Math.round(verifiedValue * 100) / 100,
          ai_analyses_run: aiCount,
        },
        monthly_trend: monthlyTrend,
        top_fields: topFields,
        recent_activity: {
          applications: recentApplications,
          soil_samples: recentSamples,
          pending_reports: pendingReports,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/carbon-calculator — calculate carbon credits from inputs (no DB needed)
router.get('/carbon-calculator', (req, res) => {
  const biocharKg = parseFloat(req.query.biochar_kg) || 0;
  const carbonContentPct = parseFloat(req.query.carbon_pct) || 70;
  const permanencePct = parseFloat(req.query.permanence_pct) || 90;
  const marketPriceUsd = parseFloat(req.query.market_price_usd) || 35;

  const biocharTonnes = biocharKg / 1000;
  const carbonFraction = carbonContentPct / 100;
  const permanenceFactor = permanencePct / 100;
  const co2Factor = 3.67; // C to CO2e conversion

  const grossSequestration = biocharTonnes * carbonFraction * co2Factor;
  const netSequestration = grossSequestration * permanenceFactor;
  const creditValue = netSequestration * marketPriceUsd;

  res.json({
    data: {
      inputs: { biochar_kg: biocharKg, carbon_content_pct: carbonContentPct, permanence_pct: permanencePct, market_price_usd: marketPriceUsd },
      results: {
        biochar_tonnes: biocharTonnes,
        gross_sequestration_tco2e: Math.round(grossSequestration * 10000) / 10000,
        net_sequestration_tco2e: Math.round(netSequestration * 10000) / 10000,
        carbon_credits: Math.round(netSequestration * 100) / 100,
        estimated_value_usd: Math.round(creditValue * 100) / 100,
      },
      methodology: 'IBI Biochar Carbon Removal Standard with permanence adjustment',
    },
  });
});

// GET /api/dashboard/field-comparison — compare all user fields
router.get('/field-comparison', (req, res, next) => {
  try {
    const db = getDb();
    const fields = db.prepare(`
      SELECT f.id, f.name, f.area_hectares, f.soil_type, f.climate_zone,
        COUNT(DISTINCT a.id) as application_count,
        SUM(a.quantity_kg) as total_biochar_kg,
        AVG(a.carbon_content_percent) as avg_carbon_pct,
        COUNT(DISTINCT s.id) as sample_count,
        AVG(s.organic_carbon_percent) as avg_soc,
        AVG(s.ph) as avg_ph,
        SUM(r.net_carbon_credits) as total_credits,
        COUNT(DISTINCT r.id) as report_count
      FROM fields f
      LEFT JOIN biochar_applications a ON a.field_id = f.id
      LEFT JOIN soil_samples s ON s.field_id = f.id
      LEFT JOIN carbon_reports r ON r.field_id = f.id
      WHERE f.user_id = ?
      GROUP BY f.id
      ORDER BY total_credits DESC NULLS LAST
    `).all(req.user.id);

    const comparison = fields.map(f => ({
      ...f,
      efficiency_tco2e_per_ha: f.total_credits && f.area_hectares
        ? Math.round((f.total_credits / f.area_hectares) * 100) / 100
        : null,
      biochar_rate_t_ha: f.total_biochar_kg && f.area_hectares
        ? Math.round((f.total_biochar_kg / 1000 / f.area_hectares) * 100) / 100
        : null,
    }));

    res.json({ data: comparison });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
