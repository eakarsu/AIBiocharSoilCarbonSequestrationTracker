'use strict';

const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../biochar_tracker.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initializeSchema();
  }
  return db;
}

function initializeSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'farmer',
      organization TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS fields (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      location_lat REAL,
      location_lng REAL,
      area_hectares REAL NOT NULL,
      soil_type TEXT,
      climate_zone TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS biochar_applications (
      id TEXT PRIMARY KEY,
      field_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      application_date DATE NOT NULL,
      biochar_type TEXT NOT NULL,
      biochar_source TEXT,
      quantity_kg REAL NOT NULL,
      application_depth_cm REAL,
      application_method TEXT,
      carbon_content_percent REAL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (field_id) REFERENCES fields(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS soil_samples (
      id TEXT PRIMARY KEY,
      field_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      sample_date DATE NOT NULL,
      depth_cm REAL NOT NULL,
      organic_carbon_percent REAL,
      bulk_density_g_cm3 REAL,
      ph REAL,
      nitrogen_ppm REAL,
      phosphorus_ppm REAL,
      potassium_ppm REAL,
      moisture_percent REAL,
      microbial_biomass_mg_kg REAL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (field_id) REFERENCES fields(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS carbon_reports (
      id TEXT PRIMARY KEY,
      field_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      report_period_start DATE NOT NULL,
      report_period_end DATE NOT NULL,
      total_biochar_applied_kg REAL,
      estimated_carbon_sequestered_tco2e REAL,
      baseline_carbon_tco2e REAL,
      net_carbon_credits REAL,
      methodology TEXT DEFAULT 'Biochar Carbon Removal',
      verification_status TEXT DEFAULT 'pending',
      verified_by TEXT,
      verified_at DATETIME,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (field_id) REFERENCES fields(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS ai_results (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      analysis_type TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_summary TEXT,
      result_json TEXT NOT NULL,
      tokens_used INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_fields_user ON fields(user_id);
    CREATE INDEX IF NOT EXISTS idx_applications_field ON biochar_applications(field_id);
    CREATE INDEX IF NOT EXISTS idx_applications_user ON biochar_applications(user_id);
    CREATE INDEX IF NOT EXISTS idx_samples_field ON soil_samples(field_id);
    CREATE INDEX IF NOT EXISTS idx_samples_user ON soil_samples(user_id);
    CREATE INDEX IF NOT EXISTS idx_reports_field ON carbon_reports(field_id);
    CREATE INDEX IF NOT EXISTS idx_reports_user ON carbon_reports(user_id);
    CREATE INDEX IF NOT EXISTS idx_ai_results_entity ON ai_results(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_ai_results_user ON ai_results(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
  `);
}

module.exports = { getDb };
