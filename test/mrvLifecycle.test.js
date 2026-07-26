'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateMrvRecord, verifyRecord } = require('../src/domain/mrvLifecycle');

const valid = () => ({
  projectId: 'biochar-1', methodology: 'local-test-method', methodologyVersion: '1.0', dryMassKg: 1000,
  carbonFraction: 0.8, stableCarbonFraction: 0.75, uncertaintyPercent: 10, leakageTco2e: 0.1,
  baselineEvidenceRef: 'sha256:baseline', additionalityEvidenceRef: 'sha256:additionality', permanencePlanRef: 'sha256:plan',
  measurements: [{ sourceId: 'lab-1', measuredAt: '2026-01-01T00:00:00Z', evidenceHash: 'sha256:measurement' }],
});

test('calculates unit-normalized net removals and gates registry state', () => {
  const result = calculateMrvRecord(valid());
  assert.equal(result.status, 'awaiting_independent_verification');
  assert.equal(result.grossTco2e, 2.2);
  assert.equal(result.netTco2e, 1.88);
  assert.equal(result.recordHash.length, 64);
});

test('blocks incomplete evidence and self-verification', () => {
  const draft = valid(); delete draft.baselineEvidenceRef;
  assert.equal(calculateMrvRecord(draft).status, 'blocked');
  const ready = { ...calculateMrvRecord(valid()), projectOrganization: 'farm-1' };
  assert.throws(() => verifyRecord(ready, { id: 'v1', role: 'verifier', organization: 'farm-1' }), /differ/);
});
