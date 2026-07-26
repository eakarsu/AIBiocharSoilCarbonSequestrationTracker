'use strict';
const crypto = require('crypto');

class MrvError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const text = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) throw new MrvError('INVALID_INPUT', `${name} is required`);
  return value.trim();
};

function calculateMrvRecord(input) {
  if (!input || typeof input !== 'object') throw new MrvError('INVALID_INPUT', 'MRV record is required');
  const projectId = text(input.projectId, 'projectId');
  const methodology = text(input.methodology, 'methodology');
  const methodologyVersion = text(input.methodologyVersion, 'methodologyVersion');
  const dryMassKg = Number(input.dryMassKg);
  const carbonFraction = Number(input.carbonFraction);
  const stableCarbonFraction = Number(input.stableCarbonFraction);
  const uncertaintyPercent = Number(input.uncertaintyPercent);
  const leakageTco2e = Number(input.leakageTco2e || 0);
  for (const [name, value] of Object.entries({ dryMassKg, carbonFraction, stableCarbonFraction, uncertaintyPercent, leakageTco2e })) {
    if (!Number.isFinite(value) || value < 0) throw new MrvError('INVALID_NUMBER', `${name} must be a non-negative number`);
  }
  if (carbonFraction > 1 || stableCarbonFraction > 1 || uncertaintyPercent > 100) throw new MrvError('INVALID_RANGE', 'fractions and uncertainty are out of range');
  const blockers = [];
  if (!input.baselineEvidenceRef) blockers.push({ code: 'BASELINE_EVIDENCE_REQUIRED' });
  if (!input.additionalityEvidenceRef) blockers.push({ code: 'ADDITIONALITY_EVIDENCE_REQUIRED' });
  if (!input.permanencePlanRef) blockers.push({ code: 'PERMANENCE_PLAN_REQUIRED' });
  if (!Array.isArray(input.measurements) || input.measurements.length === 0) blockers.push({ code: 'MEASUREMENTS_REQUIRED' });
  for (const measurement of input.measurements || []) {
    if (!measurement.sourceId || !measurement.measuredAt || !measurement.evidenceHash) blockers.push({ code: 'INCOMPLETE_MEASUREMENT' });
  }
  if (input.registryIssuanceId || input.retirementId) blockers.push({ code: 'EXTERNAL_REGISTRY_STATE_MUST_BE_SYNCED' });
  const gross = dryMassKg * carbonFraction * stableCarbonFraction * (44 / 12) / 1000;
  const uncertaintyDeduction = gross * uncertaintyPercent / 100;
  const netTco2e = Math.max(0, gross - uncertaintyDeduction - leakageTco2e);
  const canonical = { projectId, methodology, methodologyVersion, dryMassKg, carbonFraction, stableCarbonFraction, uncertaintyPercent, leakageTco2e, measurements: input.measurements || [] };
  return {
    ...canonical,
    grossTco2e: Number(gross.toFixed(6)), uncertaintyDeductionTco2e: Number(uncertaintyDeduction.toFixed(6)), netTco2e: Number(netTco2e.toFixed(6)),
    recordHash: crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),
    blockers,
    status: blockers.length ? 'blocked' : 'awaiting_independent_verification',
  };
}

function verifyRecord(record, actor) {
  if (!record || record.status !== 'awaiting_independent_verification') throw new MrvError('INVALID_TRANSITION', 'record is not ready for verification');
  if (!actor || actor.role !== 'verifier') throw new MrvError('FORBIDDEN', 'independent verifier role required');
  if (actor.organization && actor.organization === record.projectOrganization) throw new MrvError('INDEPENDENCE_REQUIRED', 'verifier organization must differ from project organization');
  return { ...record, status: 'verified_pending_registry', verifiedBy: actor.id, verifiedAt: new Date().toISOString() };
}

module.exports = { MrvError, calculateMrvRecord, verifyRecord };
