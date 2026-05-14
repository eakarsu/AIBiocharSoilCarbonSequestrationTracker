'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/schema');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;

router.use(authenticateToken);

// GET /api/users/me — current user profile
router.get('/me', (req, res, next) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT id, email, name, role, organization, created_at, updated_at FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ data: user });
  } catch (err) {
    next(err);
  }
});

// PUT /api/users/me — update profile
router.put('/me', (req, res, next) => {
  try {
    const db = getDb();
    const { name, organization } = req.body;
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }
    db.prepare('UPDATE users SET name=?, organization=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(name.trim(), organization?.trim() || null, req.user.id);
    const user = db.prepare('SELECT id, email, name, role, organization, created_at, updated_at FROM users WHERE id = ?').get(req.user.id);
    res.json({ data: user, message: 'Profile updated' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/users/me/password — change password
router.put('/me/password', validate(schemas.changePassword), async (req, res, next) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const valid = await bcrypt.compare(req.body.current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    const newHash = await bcrypt.hash(req.body.new_password, BCRYPT_ROUNDS);
    db.prepare('UPDATE users SET password_hash=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(newHash, req.user.id);

    // Invalidate all refresh tokens
    db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(req.user.id);

    res.json({ message: 'Password changed successfully. Please log in again.' });
  } catch (err) {
    next(err);
  }
});

// GET /api/users — admin only: list users
router.get('/', requireRole('admin'), (req, res, next) => {
  try {
    const db = getDb();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const users = db.prepare(`
      SELECT id, email, name, role, organization, created_at,
        (SELECT COUNT(*) FROM fields WHERE user_id = users.id) as field_count
      FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(limit, offset);

    res.json({
      data: users,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
