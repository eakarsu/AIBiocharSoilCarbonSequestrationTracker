'use strict';

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb, migrate } = require('../src/db/schema');

async function provisionAdmin() {
  if (process.env.BOOTSTRAP_ACKNOWLEDGEMENT !== 'create-initial-admin') {
    throw new Error('Set BOOTSTRAP_ACKNOWLEDGEMENT=create-initial-admin to provision an operator');
  }
  const email = String(process.env.PROVISION_ADMIN_EMAIL || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.PROVISION_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
  const name = String(process.env.PROVISION_ADMIN_NAME || 'Initial Administrator').trim();
  const organization = String(process.env.PROVISION_COMPANY_NAME || '').trim() || null;
  if (!email.includes('@') || typeof password !== 'string' || password.length < 12) {
    throw new Error('A valid operator email and password of at least 12 characters are required');
  }
  migrate();
  const db = getDb();
  const passwordHash = await bcrypt.hash(password, 12);
  db.prepare(`
    INSERT INTO users (id, email, password_hash, name, role, organization)
    VALUES (?, ?, ?, ?, 'admin', ?)
    ON CONFLICT(email) DO UPDATE SET
      password_hash = excluded.password_hash,
      name = excluded.name,
      role = 'admin',
      organization = excluded.organization
  `).run(uuidv4(), email, passwordHash, name, organization);
}

if (require.main === module) {
  provisionAdmin()
    .then(() => getDb().close())
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = { provisionAdmin };
