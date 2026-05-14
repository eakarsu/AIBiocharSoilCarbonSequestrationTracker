'use strict';

const { z } = require('zod');

// ─── Schemas ─────────────────────────────────────────────────────────────────

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required').max(100),
  organization: z.string().max(200).optional(),
  role: z.enum(['farmer', 'researcher', 'admin']).optional().default('farmer'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password required'),
});

const fieldSchema = z.object({
  name: z.string().min(1, 'Field name required').max(200),
  location_lat: z.number().min(-90).max(90).optional().nullable(),
  location_lng: z.number().min(-180).max(180).optional().nullable(),
  area_hectares: z.number().positive('Area must be positive'),
  soil_type: z.string().max(100).optional().nullable(),
  climate_zone: z.string().max(100).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
});

const applicationSchema = z.object({
  field_id: z.string().uuid('Invalid field ID'),
  application_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  biochar_type: z.string().min(1, 'Biochar type required').max(100),
  biochar_source: z.string().max(200).optional().nullable(),
  quantity_kg: z.number().positive('Quantity must be positive'),
  application_depth_cm: z.number().positive().optional().nullable(),
  application_method: z.string().max(200).optional().nullable(),
  carbon_content_percent: z.number().min(0).max(100).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const soilSampleSchema = z.object({
  field_id: z.string().uuid('Invalid field ID'),
  sample_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  depth_cm: z.number().positive('Depth must be positive'),
  organic_carbon_percent: z.number().min(0).max(100).optional().nullable(),
  bulk_density_g_cm3: z.number().positive().optional().nullable(),
  ph: z.number().min(0).max(14).optional().nullable(),
  nitrogen_ppm: z.number().min(0).optional().nullable(),
  phosphorus_ppm: z.number().min(0).optional().nullable(),
  potassium_ppm: z.number().min(0).optional().nullable(),
  moisture_percent: z.number().min(0).max(100).optional().nullable(),
  microbial_biomass_mg_kg: z.number().min(0).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const carbonReportSchema = z.object({
  field_id: z.string().uuid('Invalid field ID'),
  report_period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  report_period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  total_biochar_applied_kg: z.number().min(0).optional().nullable(),
  estimated_carbon_sequestered_tco2e: z.number().min(0).optional().nullable(),
  baseline_carbon_tco2e: z.number().min(0).optional().nullable(),
  net_carbon_credits: z.number().optional().nullable(),
  methodology: z.string().max(200).optional().default('Biochar Carbon Removal'),
  notes: z.string().max(2000).optional().nullable(),
});

const verificationSchema = z.object({
  verification_status: z.enum(['pending', 'verified', 'rejected']),
  verified_by: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Current password required'),
  new_password: z.string().min(8, 'New password must be at least 8 characters'),
});

// ─── Middleware Factory ───────────────────────────────────────────────────────

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.issues.map(i => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      return res.status(400).json({ error: 'Validation failed', details });
    }
    req.body = result.data;
    next();
  };
}

module.exports = {
  validate,
  schemas: {
    register: registerSchema,
    login: loginSchema,
    field: fieldSchema,
    application: applicationSchema,
    soilSample: soilSampleSchema,
    carbonReport: carbonReportSchema,
    verification: verificationSchema,
    changePassword: changePasswordSchema,
  },
};
