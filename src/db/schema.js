'use strict';

let NativeDatabase;
let nativeLoadError;
try {
  NativeDatabase = require('better-sqlite3');
} catch (error) {
  nativeLoadError = error;
}

function openBuiltinDatabase(filename) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    class CompatibleDatabase extends DatabaseSync {
      pragma(statement) {
        return this.exec(`PRAGMA ${statement}`);
      }

      transaction(callback) {
        return (...args) => {
          this.exec('BEGIN IMMEDIATE');
          try {
            const result = callback(...args);
            this.exec('COMMIT');
            return result;
          } catch (error) {
            this.exec('ROLLBACK');
            throw error;
          }
        };
      }
    }
    return new CompatibleDatabase(filename);
  } catch {
    throw nativeLoadError;
  }
}

class Database {
  constructor(filename) {
    // Requiring a native addon can succeed even when opening it later reveals
    // a Node ABI mismatch, so guard construction as well as module loading.
    if (NativeDatabase) {
      try {
        return new NativeDatabase(filename);
      } catch (error) {
        nativeLoadError = error;
      }
    }
    // Node 22+ ships a synchronous SQLite API compatible with the operations
    // used here. Older runtimes still receive the original native-addon error.
    return openBuiltinDatabase(filename);
  }
}
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../biochar_tracker.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
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

    CREATE TABLE IF NOT EXISTS mrv_workflows (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('blocked', 'awaiting_independent_verification', 'verified_pending_registry')),
      record_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      verified_by TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, idempotency_key),
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (verified_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS mrv_workflow_events (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      evidence_hash TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workflow_id) REFERENCES mrv_workflows(id) ON DELETE CASCADE,
      FOREIGN KEY (actor_id) REFERENCES users(id)
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
    CREATE INDEX IF NOT EXISTS idx_mrv_workflows_tenant_status ON mrv_workflows(tenant_id, status);
    CREATE INDEX IF NOT EXISTS idx_mrv_events_workflow ON mrv_workflow_events(workflow_id, created_at);
  `);
}

function migrate() { getDb(); initializeSchema(); }

module.exports = { getDb, migrate };
