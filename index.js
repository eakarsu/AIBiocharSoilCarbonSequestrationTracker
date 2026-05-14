'use strict';

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');

const { generalLimiter, authLimiter } = require('./src/middleware/rateLimiter');
const { getDb } = require('./src/db/schema');

// Initialize DB on startup
getDb();

const app = express();

// ─── Security ───────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
}));

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Body Parsing ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Request Logging ─────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.path}`);
  next();
});

// ─── Static Files ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── Health Check ────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// ─── API Routes ──────────────────────────────────────────────────────────────
app.use('/api/auth', authLimiter, require('./src/routes/auth'));
app.use('/api/fields', generalLimiter, require('./src/routes/fields'));
app.use('/api/applications', generalLimiter, require('./src/routes/applications'));
app.use('/api/soil-samples', generalLimiter, require('./src/routes/soilSamples'));
app.use('/api/carbon-reports', generalLimiter, require('./src/routes/carbonReports'));
app.use('/api/ai', require('./src/routes/ai'));
app.use('/api/dashboard', generalLimiter, require('./src/routes/dashboard'));
app.use('/api/users', generalLimiter, require('./src/routes/users'));
// Apply pass 5 — backlog extensions (RAG / agentic / anomaly / tenancy)
app.use('/api/ext', generalLimiter, require('./src/routes/extensions'));

// ─── SPA Fallback ────────────────────────────────────────────────────────────
// Apply pass 5: '*' is invalid in Express 5 / path-to-regexp v8 — '/{*splat}' is the
// equivalent. Pre-existing breakage; one-line fix to unblock startup so the new
// /api/ext routes can be exercised.
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Error Handler ───────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  if (status >= 500) {
    console.error('[ERROR]', err);
  }
  res.status(status).json({ error: message, ...(err.details && { details: err.details }) });
});

// ─── Start ───────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 3000;

app.use('/api/mrv-workflow', require('./routes/agenticMrvWorkflow')); // apply pass 6 — audit custom suggestion

app.use('/api/protocol-rag', require('./routes/biocharProtocolRag')); // apply pass 6 — audit custom suggestion

app.use('/api/satellite-imagery', require('./routes/satelliteImageryPipeline')); // apply pass 6 — audit custom suggestion

app.use('/api/credit-marketplace', require('./routes/creditMarketplace')); // apply pass 6 — audit custom suggestion
app.listen(PORT, () => {
  console.log(`[Biochar Tracker] Server running on http://localhost:${PORT}`);
  console.log(`[Biochar Tracker] Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;


// === Batch 01 Gaps & Frontend Mounts ===
app.use('/api/gap-no-ndvi-satellite-imagery-analysis-for-plot-verifi', require('./src/routes/gap_no_ndvi_satellite_imagery_analysis_for_plot_verifi'));
app.use('/api/gap-no-ai-carbon-credit-document-drafting', require('./src/routes/gap_no_ai_carbon_credit_document_drafting'));
app.use('/api/gap-no-predictive-durability-modeling-for-biochar-pers', require('./src/routes/gap_no_predictive_durability_modeling_for_biochar_pers'));
app.use('/api/gap-no-ai-verra-gold-standard-protocol-q-a', require('./src/routes/gap_no_ai_verra_gold_standard_protocol_q_a'));
app.use('/api/gap-no-spa-frontend-only-server-rendered-html-in-publi', require('./src/routes/gap_no_spa_frontend_only_server_rendered_html_in_publi'));
app.use('/api/gap-no-geo-mapping-gis-layer', require('./src/routes/gap_no_geo_mapping_gis_layer'));
app.use('/api/gap-no-carbon-credit-registry-integration-verra-puro-e', require('./src/routes/gap_no_carbon_credit_registry_integration_verra_puro_e'));
app.use('/api/gap-no-farmer-landowner-onboarding-wizard', require('./src/routes/gap_no_farmer_landowner_onboarding_wizard'));
app.use('/api/gap-no-payment-credit-issuance-ledger', require('./src/routes/gap_no_payment_credit_issuance_ledger'));
app.use('/api/gap-no-notification-system', require('./src/routes/gap_no_notification_system'));
app.use('/api/gap-no-webhook-outbound-api', require('./src/routes/gap_no_webhook_outbound_api'));
