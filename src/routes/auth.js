'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const { authenticateToken } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

if (!JWT_SECRET || JWT_SECRET === 'dev-secret' || JWT_SECRET === 'your-super-secret-jwt-key-change-in-production') {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set to a strong secret in production');
  }
  console.warn('[WARN] Using insecure JWT_SECRET. Set a strong secret in production.');
}

function signTokens(userId, role, email) {
  if (!JWT_SECRET || !JWT_REFRESH_SECRET) throw new Error('JWT secrets are not configured');
  const accessToken = jwt.sign(
    { id: userId, role, email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
  const refreshToken = jwt.sign(
    { id: userId, type: 'refresh' },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN }
  );
  return { accessToken, refreshToken };
}

// POST /api/auth/register
router.post('/register', validate(schemas.register), async (req, res, next) => {
  try {
    const db = getDb();
    const { email, password, name, organization } = req.body;
    const role = 'farmer';

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const userId = uuidv4();

    db.prepare(`
      INSERT INTO users (id, email, password_hash, name, role, organization)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, email.toLowerCase(), passwordHash, name, role, organization || null);

    const { accessToken, refreshToken } = signTokens(userId, role, email);

    // Store refresh token hash
    const tokenHash = await bcrypt.hash(refreshToken, 8);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(uuidv4(), userId, tokenHash, expiresAt);

    res.status(201).json({
      message: 'Account created successfully',
      accessToken,
      refreshToken,
      user: { id: userId, email, name, role, organization },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', validate(schemas.login), async (req, res, next) => {
  try {
    const db = getDb();
    const { email, password } = req.body;

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { accessToken, refreshToken } = signTokens(user.id, user.role, user.email);

    // Store refresh token
    const tokenHash = await bcrypt.hash(refreshToken, 8);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(uuidv4(), user.id, tokenHash, expiresAt);

    res.json({
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, organization: user.organization },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token required' });
    }

    let payload;
    try {
      payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const db = getDb();
    const tokens = db.prepare(
      'SELECT * FROM refresh_tokens WHERE user_id = ? AND expires_at > datetime("now")'
    ).all(payload.id);

    // Find matching token
    let validToken = null;
    for (const t of tokens) {
      const match = await bcrypt.compare(refreshToken, t.token_hash);
      if (match) { validToken = t; break; }
    }

    if (!validToken) {
      return res.status(401).json({ error: 'Refresh token not found or expired' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Rotate token
    db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(validToken.id);
    const { accessToken: newAccess, refreshToken: newRefresh } = signTokens(user.id, user.role, user.email);
    const newHash = await bcrypt.hash(newRefresh, 8);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), user.id, newHash, expiresAt);

    res.json({ accessToken: newAccess, refreshToken: newRefresh });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', authenticateToken, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    const db = getDb();
    if (refreshToken) {
      const tokens = db.prepare('SELECT * FROM refresh_tokens WHERE user_id = ?').all(req.user.id);
      for (const t of tokens) {
        const match = await bcrypt.compare(refreshToken, t.token_hash);
        if (match) {
          db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(t.id);
          break;
        }
      }
    } else {
      // Logout all sessions
      db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(req.user.id);
    }
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, email, name, role, organization, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

module.exports = router;
