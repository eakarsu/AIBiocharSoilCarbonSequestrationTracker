'use strict';

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const { provisionAdmin } = require('./scripts/create-admin');

const { generalLimiter, authLimiter } = require('./src/middleware/rateLimiter');
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || !process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.length < 32) {
  throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must each contain at least 32 characters');
}

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
app.use('/api/feedstock-eligibility', generalLimiter, require('./src/routes/feedstockEligibility'));
app.use('/api/mrv-workflows', generalLimiter, require('./src/routes/mrvWorkflows'));
// Prototype extension routes remain quarantined until their tenancy and provider contracts are production-backed.

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

app.use('/api/mrv-workflow', require('./src/routes/agenticMrvWorkflow')); // apply pass 6 — audit custom suggestion

app.use('/api/protocol-rag', require('./src/routes/biocharProtocolRag')); // apply pass 6 — audit custom suggestion

app.use('/api/satellite-imagery', require('./src/routes/satelliteImageryPipeline')); // apply pass 6 — audit custom suggestion

app.use('/api/credit-marketplace', require('./src/routes/creditMarketplace')); // apply pass 6 — audit custom suggestion
async function startServer() {
  if (process.env.BOOTSTRAP_ACKNOWLEDGEMENT === 'create-initial-admin') {
    await provisionAdmin();
  }
  app.listen(PORT, () => {
    console.log(`[Biochar Tracker] Server running on http://localhost:${PORT}`);
    console.log(`[Biochar Tracker] Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

startServer().catch((error) => {
  console.error('[startup] operator provisioning failed:', error.message);
  process.exitCode = 1;
});

module.exports = app;
