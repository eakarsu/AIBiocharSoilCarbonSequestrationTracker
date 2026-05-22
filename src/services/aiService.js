'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-haiku-4.5';
const USE_OPENROUTER = !!process.env.OPENROUTER_API_KEY || (process.env.ANTHROPIC_API_KEY || '').startsWith('sk-or-');

const client = USE_OPENROUTER ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = USE_OPENROUTER ? OPENROUTER_MODEL : 'claude-3-5-sonnet-20241022';

async function callLLM({ systemPrompt, userPrompt, maxTokens }) {
  if (USE_OPENROUTER) {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      const err = new Error(`OpenRouter ${resp.status}: ${errText.slice(0, 200)}`);
      err.status = resp.status === 401 || resp.status === 403 ? 503 : resp.status;
      throw err;
    }
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '{}';
    const tokensUsed = (data.usage?.prompt_tokens || 0) + (data.usage?.completion_tokens || 0);
    return { text, tokensUsed };
  }
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: userPrompt }],
    system: systemPrompt,
  });
  return {
    text: response.content[0]?.text || '{}',
    tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
  };
}

/**
 * Robustly parse JSON from an AI text response.
 */
function parseAIJson(text) {
  try { return JSON.parse(text); } catch (e) { /* continue */ }
  const stripped = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();
  try { return JSON.parse(stripped); } catch (e) { /* continue */ }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch (e) { /* continue */ }
  }
  return null;
}

/**
 * Persist an AI analysis result to the database.
 */
function persistAIResult({ userId, entityType, entityId, analysisType, result, tokensUsed, promptSummary }) {
  const db = getDb();
  const id = uuidv4();
  db.prepare(`
    INSERT INTO ai_results (id, user_id, entity_type, entity_id, analysis_type, model, prompt_summary, result_json, tokens_used)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, entityType, entityId, analysisType, MODEL, promptSummary || null, JSON.stringify(result), tokensUsed || 0);
  return id;
}

/**
 * Retrieve stored AI results for an entity.
 */
function getAIResults({ entityType, entityId, analysisType, limit = 10 }) {
  const db = getDb();
  let query = 'SELECT * FROM ai_results WHERE entity_type = ? AND entity_id = ?';
  const params = [entityType, entityId];
  if (analysisType) {
    query += ' AND analysis_type = ?';
    params.push(analysisType);
  }
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  return db.prepare(query).all(...params).map(r => ({
    ...r,
    result_json: JSON.parse(r.result_json),
  }));
}

/**
 * AI: Analyze carbon sequestration potential from biochar application data.
 */
async function analyzeSequestration({ field, applications, soilSamples, userId }) {
  const promptSummary = `Carbon sequestration analysis for field ${field.id}`;
  const systemPrompt = `You are an expert soil scientist and carbon sequestration specialist with deep knowledge of biochar's role in soil carbon storage. You have expertise in the IBI (International Biochar Initiative) standards, Verra VCS methodology VM0044, and Puro.earth biochar carbon removal methodology. Provide precise, scientifically grounded analyses.

Always respond with valid JSON only — no markdown, no explanations outside the JSON structure.`;

  const userPrompt = `Analyze the carbon sequestration potential for this agricultural field:

FIELD DATA:
- Name: ${field.name}
- Area: ${field.area_hectares} hectares
- Soil Type: ${field.soil_type || 'Unknown'}
- Climate Zone: ${field.climate_zone || 'Unknown'}
- Location: ${field.location_lat ? `${field.location_lat}°N, ${field.location_lng}°E` : 'Not specified'}

BIOCHAR APPLICATIONS (${applications.length} total):
${applications.map(a => `- Date: ${a.application_date}, Type: ${a.biochar_type}, Source: ${a.biochar_source || 'Unknown'}, Quantity: ${a.quantity_kg}kg, Carbon Content: ${a.carbon_content_percent || 'Unknown'}%, Depth: ${a.application_depth_cm || 'Unknown'}cm, Method: ${a.application_method || 'Unknown'}`).join('\n') || 'No applications recorded'}

SOIL SAMPLES (${soilSamples.length} total, most recent 3):
${soilSamples.slice(0, 3).map(s => `- Date: ${s.sample_date}, Depth: ${s.depth_cm}cm, SOC: ${s.organic_carbon_percent || 'N/A'}%, Bulk Density: ${s.bulk_density_g_cm3 || 'N/A'} g/cm³, pH: ${s.ph || 'N/A'}, N: ${s.nitrogen_ppm || 'N/A'}ppm`).join('\n') || 'No samples recorded'}

Provide a comprehensive JSON analysis with this exact structure:
{
  "sequestration_estimate": {
    "total_carbon_kg": <number>,
    "total_tco2e": <number>,
    "per_hectare_tco2e": <number>,
    "confidence_level": "<low|medium|high>",
    "methodology": "<string>"
  },
  "carbon_permanence": {
    "stable_fraction_percent": <number>,
    "labile_fraction_percent": <number>,
    "estimated_100yr_persistence_tco2e": <number>,
    "permanence_rating": "<poor|fair|good|excellent>"
  },
  "soil_improvement_score": {
    "overall": <number 1-10>,
    "nutrient_retention": <number 1-10>,
    "water_holding_capacity": <number 1-10>,
    "microbial_activity": <number 1-10>,
    "ph_buffering": <number 1-10>
  },
  "credit_potential": {
    "voluntary_market_credits": <number>,
    "estimated_value_usd_low": <number>,
    "estimated_value_usd_high": <number>,
    "eligible_standards": ["<string>"]
  },
  "recommendations": [
    {
      "priority": "<high|medium|low>",
      "category": "<string>",
      "action": "<string>",
      "expected_benefit": "<string>"
    }
  ],
  "risks": [
    {
      "risk": "<string>",
      "likelihood": "<low|medium|high>",
      "mitigation": "<string>"
    }
  ],
  "next_measurement_date": "<ISO date string>",
  "summary": "<2-3 sentence plain English summary>"
}`;

  const { text: rawText, tokensUsed } = await callLLM({ systemPrompt, userPrompt, maxTokens: 2000 });
  const result = parseAIJson(rawText) || { error: 'Failed to parse AI response', raw: rawText };

  const resultId = persistAIResult({
    userId,
    entityType: 'field',
    entityId: field.id,
    analysisType: 'sequestration_analysis',
    result,
    tokensUsed,
    promptSummary,
  });

  return { result, resultId, tokensUsed };
}

/**
 * AI: Analyze soil health from soil sample data.
 */
async function analyzeSoilHealth({ field, soilSamples, userId }) {
  const promptSummary = `Soil health analysis for field ${field.id}`;
  const systemPrompt = `You are a certified soil scientist specializing in regenerative agriculture and soil carbon sequestration. Provide data-driven soil health assessments based on measured parameters. Always respond with valid JSON only.`;

  const sampleData = soilSamples.map(s => ({
    date: s.sample_date,
    depth_cm: s.depth_cm,
    soc_percent: s.organic_carbon_percent,
    bulk_density: s.bulk_density_g_cm3,
    ph: s.ph,
    n_ppm: s.nitrogen_ppm,
    p_ppm: s.phosphorus_ppm,
    k_ppm: s.potassium_ppm,
    moisture: s.moisture_percent,
    microbial_biomass: s.microbial_biomass_mg_kg,
  }));

  const userPrompt = `Analyze soil health for this field:

FIELD: ${field.name} (${field.area_hectares} ha, ${field.soil_type || 'unknown soil type'}, ${field.climate_zone || 'unknown climate'})

SOIL SAMPLES (${soilSamples.length} total):
${JSON.stringify(sampleData, null, 2)}

Provide comprehensive soil health analysis as JSON:
{
  "overall_health_score": <number 1-100>,
  "health_grade": "<A|B|C|D|F>",
  "carbon_status": {
    "current_soc_percent": <number>,
    "trend": "<improving|stable|declining>",
    "target_soc_percent": <number>,
    "years_to_target": <number>
  },
  "nutrient_status": {
    "nitrogen": "<deficient|adequate|excess>",
    "phosphorus": "<deficient|adequate|excess>",
    "potassium": "<deficient|adequate|excess>",
    "overall_fertility": "<poor|fair|good|excellent>"
  },
  "biological_activity": {
    "microbial_health": "<poor|fair|good|excellent>",
    "biodiversity_index": <number 1-10>,
    "decomposition_rate": "<slow|moderate|fast>"
  },
  "physical_properties": {
    "compaction_risk": "<low|medium|high>",
    "water_infiltration": "<poor|moderate|good|excellent>",
    "erosion_risk": "<low|medium|high>"
  },
  "improvements_since_biochar": {
    "soc_change_percent": <number>,
    "ph_stabilization": <boolean>,
    "nutrient_retention_improvement": "<none|slight|moderate|significant>"
  },
  "recommendations": [
    {
      "parameter": "<string>",
      "current_value": "<string>",
      "target_value": "<string>",
      "action": "<string>",
      "timeline": "<string>"
    }
  ],
  "next_sampling_recommended": "<ISO date>",
  "summary": "<2-3 sentence assessment>"
}`;

  const { text: rawText, tokensUsed } = await callLLM({ systemPrompt, userPrompt, maxTokens: 1800 });
  const result = parseAIJson(rawText) || { error: 'Failed to parse AI response', raw: rawText };

  const resultId = persistAIResult({
    userId,
    entityType: 'field',
    entityId: field.id,
    analysisType: 'soil_health_analysis',
    result,
    tokensUsed,
    promptSummary,
  });

  return { result, resultId, tokensUsed };
}

/**
 * AI: Generate biochar application recommendations.
 */
async function getBiocharRecommendations({ field, applications, soilSamples, userId }) {
  const promptSummary = `Biochar recommendations for field ${field.id}`;
  const systemPrompt = `You are an expert in biochar production and application for agricultural carbon sequestration. You provide practical, economically sound recommendations. Always respond with valid JSON only.`;

  const userPrompt = `Generate biochar application recommendations for this field:

FIELD: ${field.name}
- Area: ${field.area_hectares} ha
- Soil Type: ${field.soil_type || 'Unknown'}
- Climate Zone: ${field.climate_zone || 'Unknown'}

CURRENT SOIL CONDITIONS:
${soilSamples.length > 0 ? `- SOC: ${soilSamples[0].organic_carbon_percent || 'N/A'}%
- pH: ${soilSamples[0].ph || 'N/A'}
- Bulk Density: ${soilSamples[0].bulk_density_g_cm3 || 'N/A'} g/cm³` : 'No soil data available'}

PREVIOUS APPLICATIONS: ${applications.length} total, most recent: ${applications[0] ? `${applications[0].biochar_type} at ${applications[0].quantity_kg}kg on ${applications[0].application_date}` : 'None'}

Provide recommendations as JSON:
{
  "optimal_biochar_type": {
    "type": "<string>",
    "feedstock": "<string>",
    "pyrolysis_temperature_c": <number>,
    "ibi_class": "<Class I|Class II|Class III>",
    "rationale": "<string>"
  },
  "application_plan": {
    "recommended_rate_t_ha": <number>,
    "total_quantity_kg": <number>,
    "frequency": "<one-time|annual|biennial>",
    "best_timing": "<string>",
    "incorporation_depth_cm": <number>,
    "method": "<string>"
  },
  "pre_treatment": {
    "required": <boolean>,
    "charging_method": "<string>",
    "amendments_to_add": ["<string>"]
  },
  "expected_outcomes": {
    "year_1_soc_increase_percent": <number>,
    "year_5_soc_increase_percent": <number>,
    "yield_improvement_percent": <number>,
    "water_retention_improvement_percent": <number>,
    "carbon_sequestered_tco2e_total": <number>
  },
  "cost_estimate": {
    "biochar_cost_usd_per_tonne": <number>,
    "total_material_cost_usd": <number>,
    "application_cost_usd": <number>,
    "total_investment_usd": <number>,
    "roi_years": <number>
  },
  "monitoring_plan": [
    {
      "metric": "<string>",
      "frequency": "<string>",
      "method": "<string>"
    }
  ],
  "warnings": ["<string>"],
  "summary": "<2-3 sentence practical summary>"
}`;

  const { text: rawText, tokensUsed } = await callLLM({ systemPrompt, userPrompt, maxTokens: 2000 });
  const result = parseAIJson(rawText) || { error: 'Failed to parse AI response', raw: rawText };

  const resultId = persistAIResult({
    userId,
    entityType: 'field',
    entityId: field.id,
    analysisType: 'biochar_recommendations',
    result,
    tokensUsed,
    promptSummary,
  });

  return { result, resultId, tokensUsed };
}

/**
 * AI: Validate carbon report for carbon market compliance.
 */
async function validateCarbonReport({ report, field, applications, userId }) {
  const promptSummary = `Carbon report validation for report ${report.id}`;
  const systemPrompt = `You are a carbon market compliance expert specializing in Verra VCS, Gold Standard, Puro.earth, and voluntary carbon market (VCM) standards for biochar carbon removal. Always respond with valid JSON only.`;

  const userPrompt = `Validate this carbon sequestration report for carbon market eligibility:

REPORT:
- Period: ${report.report_period_start} to ${report.report_period_end}
- Total Biochar Applied: ${report.total_biochar_applied_kg} kg
- Estimated Sequestered: ${report.estimated_carbon_sequestered_tco2e} tCO2e
- Baseline Carbon: ${report.baseline_carbon_tco2e} tCO2e
- Net Carbon Credits: ${report.net_carbon_credits}
- Methodology: ${report.methodology}
- Verification Status: ${report.verification_status}

FIELD: ${field.name}, ${field.area_hectares} ha, ${field.soil_type || 'unknown soil type'}

APPLICATIONS DURING PERIOD: ${applications.length}
- Total Biochar Types: ${[...new Set(applications.map(a => a.biochar_type))].join(', ') || 'N/A'}

Validate against carbon market standards and respond as JSON:
{
  "overall_eligibility": "<eligible|conditional|ineligible>",
  "compliance_score": <number 0-100>,
  "standards_assessment": {
    "verra_vcs": {
      "eligible": <boolean>,
      "issues": ["<string>"],
      "missing_documentation": ["<string>"]
    },
    "puro_earth": {
      "eligible": <boolean>,
      "issues": ["<string>"],
      "missing_documentation": ["<string>"]
    },
    "gold_standard": {
      "eligible": <boolean>,
      "issues": ["<string>"],
      "missing_documentation": ["<string>"]
    }
  },
  "calculation_review": {
    "methodology_appropriate": <boolean>,
    "sequestration_estimate_reasonable": <boolean>,
    "uncertainty_range_percent": <number>,
    "recommended_adjustment_tco2e": <number>
  },
  "required_actions": [
    {
      "action": "<string>",
      "priority": "<critical|high|medium|low>",
      "deadline": "<string>"
    }
  ],
  "additionality_assessment": {
    "meets_additionality": <boolean>,
    "rationale": "<string>"
  },
  "permanence_buffer": {
    "recommended_buffer_percent": <number>,
    "net_credits_after_buffer": <number>
  },
  "summary": "<2-3 sentence compliance summary>"
}`;

  const { text: rawText, tokensUsed } = await callLLM({ systemPrompt, userPrompt, maxTokens: 1800 });
  const result = parseAIJson(rawText) || { error: 'Failed to parse AI response', raw: rawText };

  const resultId = persistAIResult({
    userId,
    entityType: 'carbon_report',
    entityId: report.id,
    analysisType: 'compliance_validation',
    result,
    tokensUsed,
    promptSummary,
  });

  return { result, resultId, tokensUsed };
}

/**
 * AI: Compare multiple fields and provide portfolio insights.
 */
async function analyzeFieldPortfolio({ fields, userId }) {
  const promptSummary = `Portfolio analysis for ${fields.length} fields`;
  const systemPrompt = `You are an agricultural carbon portfolio analyst. Provide strategic insights on optimizing carbon sequestration across multiple fields. Always respond with valid JSON only.`;

  const userPrompt = `Analyze this biochar carbon sequestration portfolio:

FIELDS (${fields.length} total):
${fields.map((f, i) => `${i + 1}. ${f.name}: ${f.area_hectares}ha, ${f.soil_type || 'unknown soil'}, ${f.climate_zone || 'unknown climate'}, ${f.application_count || 0} applications, ~${f.estimated_sequestered || 0} tCO2e sequestered`).join('\n')}

PORTFOLIO TOTALS:
- Total Area: ${fields.reduce((s, f) => s + f.area_hectares, 0).toFixed(2)} ha
- Total Applications: ${fields.reduce((s, f) => s + (f.application_count || 0), 0)}
- Total Estimated Sequestration: ${fields.reduce((s, f) => s + (f.estimated_sequestered || 0), 0).toFixed(2)} tCO2e

Provide portfolio analysis as JSON:
{
  "portfolio_score": <number 1-100>,
  "portfolio_grade": "<A|B|C|D|F>",
  "top_performing_field": {
    "field_name": "<string>",
    "reason": "<string>",
    "sequestration_per_ha": <number>
  },
  "underperforming_fields": [
    {
      "field_name": "<string>",
      "issue": "<string>",
      "improvement_potential_tco2e": <number>
    }
  ],
  "diversification_assessment": {
    "soil_type_diversity": "<low|medium|high>",
    "climate_zone_diversity": "<low|medium|high>",
    "risk_level": "<low|medium|high>"
  },
  "optimization_opportunities": [
    {
      "opportunity": "<string>",
      "potential_additional_tco2e": <number>,
      "investment_required_usd": <number>,
      "priority": "<high|medium|low>"
    }
  ],
  "carbon_credit_potential": {
    "current_total_credits": <number>,
    "potential_total_credits": <number>,
    "estimated_portfolio_value_usd": <number>,
    "recommended_market": "<string>"
  },
  "strategic_recommendations": ["<string>"],
  "summary": "<2-3 sentence portfolio summary>"
}`;

  const { text: rawText, tokensUsed } = await callLLM({ systemPrompt, userPrompt, maxTokens: 2000 });
  const result = parseAIJson(rawText) || { error: 'Failed to parse AI response', raw: rawText };

  const resultId = persistAIResult({
    userId,
    entityType: 'user',
    entityId: userId,
    analysisType: 'portfolio_analysis',
    result,
    tokensUsed,
    promptSummary,
  });

  return { result, resultId, tokensUsed };
}

module.exports = {
  parseAIJson,
  analyzeSequestration,
  analyzeSoilHealth,
  getBiocharRecommendations,
  validateCarbonReport,
  analyzeFieldPortfolio,
  getAIResults,
};
