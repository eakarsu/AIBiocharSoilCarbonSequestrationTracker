'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const core = require('../src/featurePack28B');

const SAMPLES = [{"name": "North Field", "soil_type": "loam", "crop_type": "corn", "climate_zone": "temperate", "area_hectares": 2, "location_lat": 1, "location_lng": 2}, {"name": "South Field", "soil_type": "clay", "crop_type": "", "climate_zone": "temperate", "area_hectares": 3}];
const FEATURE = 'field-portfolio-summary';
const total_area_hectares = 'total_area_hectares';

function buildApp() {
  const auth = (req, res, next) => { if (!req.headers['x-test-auth']) return res.status(401).json({ error: 'unauthorized' }); req.user = { id: 'u1', email: 'u1@test.local' }; next(); };
  const app = express(); app.use(express.json());
  app.use('/api/feature-pack', core.createFeaturePackRouter({
    auth, store: core.createMemoryTaskStore(),
    listMainRecords: async () => SAMPLES,
    aiFeatures: core.AI_FEATURES, searchFields: ['name','soil_type','crop_type'], filterFields: ['soil_type','climate_zone'], exportFilename: 'records',
    includeTasks: true,
  }));
  return app;
}
async function withServer(fn) {
  const server = buildApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}
const H = { 'x-test-auth': '1', 'Content-Type': 'application/json' };

test('search/filter and CSV export preserve values', () => {
  const filtered = core.filterRecords(SAMPLES, { search: 'North', searchFields: ['name','soil_type','crop_type'] });
  assert.equal(filtered.length, 1);
  const csv = core.toCsv([{ a: 'x,y', b: 0, c: false }]);
  assert.ok(csv.includes('"x,y"')); assert.ok(csv.includes('0')); assert.ok(csv.includes('false'));
  const sections = core.formatAiSections({ flag: false, count: 0, note: '', items: [] });
  assert.deepEqual(sections.map((s) => s.value), ['false', '0', '(empty)', '(none)']);
});

test('AI fallback is labelled aiGenerated:false when no provider is configured', async () => {
  const saved = { a: process.env.OPENROUTER_API_KEY, b: process.env.OPENAI_API_KEY };
  delete process.env.OPENROUTER_API_KEY; delete process.env.OPENAI_API_KEY;
  try {
    const result = await core.runAiFeature({ feature: FEATURE, records: SAMPLES, computeFallback: core.AI_FEATURES[FEATURE], env: {} });
    assert.equal(result.aiGenerated, false);
    assert.equal(result.source, 'deterministic-fallback');
    assert.ok(total_area_hectares in result.data);
  } finally {
    if (saved.a !== undefined) process.env.OPENROUTER_API_KEY = saved.a;
    if (saved.b !== undefined) process.env.OPENAI_API_KEY = saved.b;
  }
});

test('tasks, filtered export and AI endpoints require auth and work over HTTP', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/api/feature-pack/records`)).status, 401);
    if (true) {
      const created = await fetch(`${base}/api/feature-pack/tasks`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'Follow up' }) });
      assert.equal(created.status, 201);
      const createdBody = await created.json();
      const id = createdBody.data.id;
      const updated = await fetch(`${base}/api/feature-pack/tasks/${id}`, { method: 'PUT', headers: H, body: JSON.stringify({ status: 'done' }) });
      assert.equal(updated.status, 200);
      assert.equal((await updated.json()).data.status, 'done');
      const list = await (await fetch(`${base}/api/feature-pack/tasks`, { headers: H })).json();
      assert.equal(list.data.length, 1);
    }
    const jsonExport = await (await fetch(`${base}/api/feature-pack/records/export?format=json`, { headers: H })).json();
    assert.equal(jsonExport.total, SAMPLES.length);
    const csvRes = await fetch(`${base}/api/feature-pack/records/export?format=csv`, { headers: H });
    assert.match(csvRes.headers.get('content-type') || '', /text\/csv/);
    assert.ok((await csvRes.text()).length > 0);
    const ai = await (await fetch(`${base}/api/feature-pack/ai/${FEATURE}`, { method: 'POST', headers: H, body: '{}' })).json();
    assert.equal(ai.aiGenerated, false);
    assert.ok(Array.isArray(ai.sections));
  });
});
