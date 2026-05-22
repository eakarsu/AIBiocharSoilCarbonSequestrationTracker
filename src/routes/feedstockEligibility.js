'use strict';

const express = require('express');
const router = express.Router();

router.post('/score', (req, res) => {
  const body = req.body || {};
  const moisture = Number(body.moisture_pct || 20);
  const ash = Number(body.ash_pct || 12);
  const temp = Number(body.pyrolysis_temp_c || 500);
  const contamination = Number(body.contamination_risk || 0);
  const score = Math.max(0, Math.min(100, 92 - Math.max(0, moisture - 18) * 1.4 - Math.max(0, ash - 15) * 2 - Math.abs(temp - 550) * 0.08 - contamination * 18));
  res.json({
    feedstock: body.feedstock || 'feedstock',
    eligibility_score: Math.round(score),
    eligibility_band: score >= 80 ? 'credit-ready' : score >= 55 ? 'needs evidence' : 'not ready',
    evidence_needed: [
      moisture > 18 ? 'Drying log or lab moisture result.' : null,
      ash > 15 ? 'Ash content lab certificate.' : null,
      contamination > 0 ? 'Contaminant screening and chain-of-custody note.' : null,
    ].filter(Boolean),
    protocol_notes: ['Confirm biomass origin.', 'Attach pyrolysis run temperature record.', 'Retain batch mass balance.'],
    generated_at: new Date().toISOString(),
  });
});

module.exports = router;
