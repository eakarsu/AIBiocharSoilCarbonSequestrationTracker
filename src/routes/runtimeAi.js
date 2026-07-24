'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.post('/mrv-readiness', authenticateToken, async (req, res, next) => {
  try {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt || prompt.length > 4000) return res.status(400).json({ error: 'prompt must contain 1 to 4000 characters' });
    const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
    const model = String(process.env.OPENROUTER_MODEL || '').trim();
    const baseUrl = String(process.env.OPENROUTER_BASE_URL || '').replace(/\/$/, '');
    if (!apiKey || !model || !baseUrl) return res.status(503).json({ error: 'AI provider is not configured' });
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [
        { role: 'system', content: 'Provide concise biochar MRV evidence-readiness guidance. Do not certify carbon removal, issue credits, or claim registry acceptance; require independent verification and the current governing methodology.' },
        { role: 'user', content: prompt },
      ], max_tokens: 180 }), signal: AbortSignal.timeout(45000),
    });
    const payload = await upstream.json().catch(() => ({}));
    const content = String(payload?.choices?.[0]?.message?.content || '').trim();
    if (!upstream.ok || !payload.id || !content) return res.status(502).json({ error: `OpenRouter request failed with HTTP ${upstream.status}` });
    const receipt = {
      id: uuidv4(), provider: 'openrouter', provider_request_id: String(payload.id),
      model: String(payload.model || model), created_at: new Date().toISOString(),
    };
    getDb().prepare(
      `INSERT INTO runtime_ai_provider_receipts(id,user_id,provider,provider_request_id,model,prompt,content,created_at)
       VALUES(?,?,?,?,?,?,?,?)`,
    ).run(receipt.id, req.user.id, receipt.provider, receipt.provider_request_id, receipt.model, prompt, content, receipt.created_at);
    return res.json({ content, receipt });
  } catch (error) { return next(error); }
});

module.exports = router;
