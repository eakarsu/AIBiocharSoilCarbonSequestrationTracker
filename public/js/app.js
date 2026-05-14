/* BioCarbon Tracker — Vanilla JS SPA
 * Wires the index.html UI to the Express backend at /api/*.
 * JWT lives in localStorage. AI endpoints surfaced on the AI Analysis page.
 */
'use strict';

// ─── State ──────────────────────────────────────────────────────────────────
const state = {
  token: localStorage.getItem('token') || null,
  refreshToken: localStorage.getItem('refreshToken') || null,
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  fields: [],
  applications: [],
  soilSamples: [],
  carbonReports: [],
  aiHistory: [],
  page: { fields: 1, applications: 1, soilSamples: 1, carbonReports: 1, aiHistory: 1 },
  currentPage: 'dashboard',
};

// ─── HTTP helpers ───────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const headers = Object.assign(
    { 'Content-Type': 'application/json' },
    opts.headers || {}
  );
  const token = localStorage.getItem('token');
  if (token) headers.Authorization = 'Bearer ' + token;

  let res;
  try {
    res = await fetch('/api' + path, Object.assign({}, opts, { headers }));
  } catch (e) {
    throw new Error('Network error: ' + (e.message || 'request failed'));
  }

  let body = null;
  const text = await res.text();
  if (text) {
    try { body = JSON.parse(text); } catch { body = { error: text }; }
  }

  if (!res.ok) {
    if (res.status === 401) {
      logout();
    }
    if (res.status === 503) {
      const msg = (body && (body.error || body.message)) || 'Service unavailable';
      throw new Error('AI service unavailable (503): ' + msg + ' — set ANTHROPIC_API_KEY in the server .env');
    }
    const err = new Error((body && (body.error || body.message)) || ('HTTP ' + res.status));
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

// ─── Toast ─────────────────────────────────────────────────────────────────
function toast(message, type) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = 'toast ' + (type || 'info');
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3500);
}

// ─── Auth ──────────────────────────────────────────────────────────────────
function showTab(which) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const btns = document.querySelectorAll('.tab-btn');
  if (which === 'login') {
    btns[0] && btns[0].classList.add('active');
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('register-form').classList.add('hidden');
  } else {
    btns[1] && btns[1].classList.add('active');
    document.getElementById('register-form').classList.remove('hidden');
    document.getElementById('login-form').classList.add('hidden');
  }
}
window.showTab = showTab;

async function handleLogin(ev) {
  ev.preventDefault();
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  try {
    const r = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    storeAuth(r);
    onAuthed();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}
window.handleLogin = handleLogin;

async function handleRegister(ev) {
  ev.preventDefault();
  const errEl = document.getElementById('register-error');
  errEl.classList.add('hidden');
  const payload = {
    name: document.getElementById('reg-name').value,
    email: document.getElementById('reg-email').value,
    password: document.getElementById('reg-password').value,
    organization: document.getElementById('reg-org').value || undefined,
    role: document.getElementById('reg-role').value,
  };
  try {
    const r = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    storeAuth(r);
    onAuthed();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}
window.handleRegister = handleRegister;

function storeAuth(r) {
  if (r.accessToken) localStorage.setItem('token', r.accessToken);
  if (r.refreshToken) localStorage.setItem('refreshToken', r.refreshToken);
  if (r.user) localStorage.setItem('user', JSON.stringify(r.user));
  state.token = r.accessToken;
  state.refreshToken = r.refreshToken;
  state.user = r.user;
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  state.token = null;
  state.user = null;
  document.getElementById('app').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
}
window.logout = logout;

function onAuthed() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  const nameEl = document.getElementById('user-name-display');
  if (nameEl && state.user) nameEl.textContent = state.user.name || state.user.email || '';
  navigate('dashboard');
}

// ─── Navigation ─────────────────────────────────────────────────────────────
function navigate(page) {
  state.currentPage = page;
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    p.classList.add('hidden');
  });
  const target = document.getElementById('page-' + page);
  if (target) {
    target.classList.add('active');
    target.classList.remove('hidden');
  }
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const link = document.querySelector('.nav-link[data-page="' + page + '"]');
  if (link) link.classList.add('active');

  if (page === 'dashboard') loadDashboard();
  if (page === 'fields') loadFields();
  if (page === 'applications') loadApplications();
  if (page === 'soil-samples') loadSoilSamples();
  if (page === 'carbon-reports') loadCarbonReports();
  if (page === 'ai-analysis') { loadAIFieldOptions(); loadAIHistory(); }
}
window.navigate = navigate;

// ─── Dashboard ─────────────────────────────────────────────────────────────
async function loadDashboard() {
  const el = document.getElementById('dashboard-content');
  el.innerHTML = '<div class="loading-spinner">Loading dashboard...</div>';
  try {
    const r = await api('/dashboard');
    const d = r.data || r || {};
    el.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">Fields</div><div class="stat-value">${escapeHtml(d.totalFields || 0)}</div></div>
        <div class="stat-card"><div class="stat-label">Applications</div><div class="stat-value">${escapeHtml(d.totalApplications || 0)}</div></div>
        <div class="stat-card"><div class="stat-label">Soil Samples</div><div class="stat-value">${escapeHtml(d.totalSoilSamples || 0)}</div></div>
        <div class="stat-card"><div class="stat-label">Reports</div><div class="stat-value">${escapeHtml(d.totalReports || 0)}</div></div>
        <div class="stat-card"><div class="stat-label">Total Biochar (kg)</div><div class="stat-value">${escapeHtml(d.totalBiocharKg || 0)}</div></div>
        <div class="stat-card"><div class="stat-label">Total Carbon Credits</div><div class="stat-value">${escapeHtml(d.totalCarbonCredits || 0)}</div></div>
      </div>`;
  } catch (e) {
    el.innerHTML = '<div class="error-msg">' + escapeHtml(e.message) + '</div>';
  }
}
window.loadDashboard = loadDashboard;

// ─── Generic CRUD list/page rendering ───────────────────────────────────────
function tableFromRows(rows, columns) {
  if (!rows || rows.length === 0) return '<div class="empty-state">No records yet.</div>';
  const head = columns.map(c => '<th>' + escapeHtml(c.label) + '</th>').join('');
  const body = rows.map(r => '<tr>' + columns.map(c => '<td>' + escapeHtml(r[c.key] != null ? String(r[c.key]) : '') + '</td>').join('') + '</tr>').join('');
  return '<table class="data-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
}

async function loadFields() {
  const el = document.getElementById('fields-content');
  el.innerHTML = '<div class="loading-spinner">Loading fields...</div>';
  try {
    const r = await api('/fields?page=' + state.page.fields);
    state.fields = r.data || [];
    el.innerHTML = tableFromRows(state.fields, [
      { key: 'name', label: 'Name' },
      { key: 'location', label: 'Location' },
      { key: 'area_hectares', label: 'Area (ha)' },
      { key: 'soil_type', label: 'Soil' },
      { key: 'crop_type', label: 'Crop' },
    ]);
  } catch (e) {
    el.innerHTML = '<div class="error-msg">' + escapeHtml(e.message) + '</div>';
  }
}
window.loadFields = loadFields;

async function loadApplications() {
  const el = document.getElementById('applications-content');
  el.innerHTML = '<div class="loading-spinner">Loading applications...</div>';
  try {
    const r = await api('/applications?page=' + state.page.applications);
    state.applications = r.data || [];
    el.innerHTML = tableFromRows(state.applications, [
      { key: 'application_date', label: 'Date' },
      { key: 'biochar_type', label: 'Type' },
      { key: 'quantity_kg', label: 'Quantity (kg)' },
      { key: 'application_method', label: 'Method' },
    ]);
  } catch (e) {
    el.innerHTML = '<div class="error-msg">' + escapeHtml(e.message) + '</div>';
  }
}
window.loadApplications = loadApplications;

async function loadSoilSamples() {
  const el = document.getElementById('soil-samples-content');
  el.innerHTML = '<div class="loading-spinner">Loading samples...</div>';
  try {
    const r = await api('/soil-samples?page=' + state.page.soilSamples);
    state.soilSamples = r.data || [];
    el.innerHTML = tableFromRows(state.soilSamples, [
      { key: 'sample_date', label: 'Date' },
      { key: 'ph', label: 'pH' },
      { key: 'organic_carbon_pct', label: 'OC %' },
      { key: 'nitrogen_pct', label: 'N %' },
    ]);
  } catch (e) {
    el.innerHTML = '<div class="error-msg">' + escapeHtml(e.message) + '</div>';
  }
}
window.loadSoilSamples = loadSoilSamples;

async function loadCarbonReports() {
  const el = document.getElementById('carbon-reports-content');
  el.innerHTML = '<div class="loading-spinner">Loading reports...</div>';
  try {
    const r = await api('/carbon-reports?page=' + state.page.carbonReports);
    state.carbonReports = r.data || [];
    el.innerHTML = tableFromRows(state.carbonReports, [
      { key: 'report_period_start', label: 'Period Start' },
      { key: 'report_period_end', label: 'Period End' },
      { key: 'net_carbon_credits', label: 'Credits' },
      { key: 'estimated_value_usd', label: 'Value ($)' },
    ]);
    populateReportSelect();
  } catch (e) {
    el.innerHTML = '<div class="error-msg">' + escapeHtml(e.message) + '</div>';
  }
}
window.loadCarbonReports = loadCarbonReports;

// ─── Modal placeholders (safe no-ops) ───────────────────────────────────────
function showFieldModal()        { toast('Add Field UI not implemented in this build.', 'info'); }
function showApplicationModal()  { toast('Add Application UI not implemented in this build.', 'info'); }
function showSoilSampleModal()   { toast('Add Soil Sample UI not implemented in this build.', 'info'); }
function showCarbonReportModal() { toast('Generate Report UI not implemented in this build.', 'info'); }
function closeModal()            { document.getElementById('modal-overlay').classList.add('hidden'); }
window.showFieldModal = showFieldModal;
window.showApplicationModal = showApplicationModal;
window.showSoilSampleModal = showSoilSampleModal;
window.showCarbonReportModal = showCarbonReportModal;
window.closeModal = closeModal;

// ─── AI Analysis Page ───────────────────────────────────────────────────────
async function loadAIFieldOptions() {
  // Populate field selects from /api/fields, report select from /api/carbon-reports
  try {
    if (state.fields.length === 0) {
      const r = await api('/fields?page=1&limit=100');
      state.fields = r.data || [];
    }
  } catch (e) { /* show empty */ }
  ['ai-seq-field', 'ai-soil-field', 'ai-rec-field'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = state.fields.length
      ? state.fields.map(f => '<option value="' + escapeAttr(f.id) + '">' + escapeHtml(f.name || f.id) + '</option>').join('')
      : '<option value="">(no fields — add one first)</option>';
  });

  try {
    if (state.carbonReports.length === 0) {
      const r = await api('/carbon-reports?page=1&limit=100');
      state.carbonReports = r.data || [];
    }
  } catch (e) { /* show empty */ }
  populateReportSelect();
}
window.loadAIFieldOptions = loadAIFieldOptions;

function populateReportSelect() {
  const sel = document.getElementById('ai-report-select');
  if (!sel) return;
  sel.innerHTML = state.carbonReports.length
    ? state.carbonReports.map(r => '<option value="' + escapeAttr(r.id) + '">' + escapeHtml((r.report_period_start || '') + ' → ' + (r.report_period_end || '')) + '</option>').join('')
    : '<option value="">(no reports — generate one first)</option>';
}

function showAIResult(data, meta) {
  const cont = document.getElementById('ai-result-container');
  const metaEl = document.getElementById('ai-result-meta');
  const contentEl = document.getElementById('ai-result-content');
  cont.classList.remove('hidden');
  metaEl.textContent = meta ? ('model: ' + (meta.model || '?') + ' • tokens: ' + (meta.tokens_used || 0)) : '';
  contentEl.innerHTML = '<pre class="ai-json">' + escapeHtml(JSON.stringify(data, null, 2)) + '</pre>';
}

function showAIError(err) {
  const cont = document.getElementById('ai-result-container');
  const metaEl = document.getElementById('ai-result-meta');
  const contentEl = document.getElementById('ai-result-content');
  cont.classList.remove('hidden');
  metaEl.textContent = '';
  contentEl.innerHTML = '<div class="error-msg">' + escapeHtml(err.message || 'AI error') + '</div>';
}

async function runSequestrationAnalysis() {
  const fieldId = document.getElementById('ai-seq-field').value;
  if (!fieldId) return toast('Select a field first.', 'warn');
  toast('Running sequestration analysis…', 'info');
  try {
    const r = await api('/ai/analyze-sequestration', { method: 'POST', body: JSON.stringify({ field_id: fieldId }) });
    showAIResult(r.data, r.meta);
    loadAIHistory();
  } catch (e) { showAIError(e); }
}
window.runSequestrationAnalysis = runSequestrationAnalysis;

async function runSoilHealthAnalysis() {
  const fieldId = document.getElementById('ai-soil-field').value;
  if (!fieldId) return toast('Select a field first.', 'warn');
  toast('Running soil health analysis…', 'info');
  try {
    const r = await api('/ai/soil-health', { method: 'POST', body: JSON.stringify({ field_id: fieldId }) });
    showAIResult(r.data, r.meta);
    loadAIHistory();
  } catch (e) { showAIError(e); }
}
window.runSoilHealthAnalysis = runSoilHealthAnalysis;

async function runRecommendations() {
  const fieldId = document.getElementById('ai-rec-field').value;
  if (!fieldId) return toast('Select a field first.', 'warn');
  toast('Generating recommendations…', 'info');
  try {
    const r = await api('/ai/recommendations', { method: 'POST', body: JSON.stringify({ field_id: fieldId }) });
    showAIResult(r.data, r.meta);
    loadAIHistory();
  } catch (e) { showAIError(e); }
}
window.runRecommendations = runRecommendations;

async function runReportValidation() {
  const reportId = document.getElementById('ai-report-select').value;
  if (!reportId) return toast('Select a report first.', 'warn');
  toast('Validating report…', 'info');
  try {
    const r = await api('/ai/validate-report', { method: 'POST', body: JSON.stringify({ report_id: reportId }) });
    showAIResult(r.data, r.meta);
    loadAIHistory();
  } catch (e) { showAIError(e); }
}
window.runReportValidation = runReportValidation;

async function runPortfolioAnalysis() {
  toast('Analyzing portfolio…', 'info');
  try {
    const r = await api('/ai/portfolio', { method: 'POST', body: JSON.stringify({}) });
    showAIResult(r.data, r.meta);
    loadAIHistory();
  } catch (e) { showAIError(e); }
}
window.runPortfolioAnalysis = runPortfolioAnalysis;

async function loadAIHistory() {
  const el = document.getElementById('ai-history-content');
  if (!el) return;
  el.innerHTML = '<div class="loading-spinner">Loading history...</div>';
  try {
    const r = await api('/ai/history?page=' + state.page.aiHistory);
    state.aiHistory = r.data || [];
    if (state.aiHistory.length === 0) {
      el.innerHTML = '<div class="empty-state">No AI analyses yet.</div>';
      return;
    }
    el.innerHTML = tableFromRows(state.aiHistory, [
      { key: 'analysis_type', label: 'Type' },
      { key: 'entity_type', label: 'Entity' },
      { key: 'entity_id', label: 'Entity ID' },
      { key: 'model', label: 'Model' },
      { key: 'tokens_used', label: 'Tokens' },
      { key: 'created_at', label: 'When' },
    ]);
  } catch (e) {
    el.innerHTML = '<div class="error-msg">' + escapeHtml(e.message) + '</div>';
  }
}
window.loadAIHistory = loadAIHistory;

// ─── Carbon Calculator (pure client-side) ───────────────────────────────────
function calculateCredits() {
  const kg = parseFloat(document.getElementById('calc-kg').value) || 0;
  const carbon = parseFloat(document.getElementById('calc-carbon').value) || 0;
  const perm = parseFloat(document.getElementById('calc-permanence').value) || 0;
  const price = parseFloat(document.getElementById('calc-price').value) || 0;
  const tonnes = kg / 1000;
  const grossCO2e = tonnes * (carbon / 100) * 3.67; // C → CO2e factor
  const netCredits = grossCO2e * (perm / 100);
  const value = netCredits * price;
  document.getElementById('r-tonnes').textContent = tonnes.toFixed(2);
  document.getElementById('r-gross').textContent = grossCO2e.toFixed(2) + ' tCO2e';
  document.getElementById('r-net').textContent = netCredits.toFixed(2) + ' tCO2e';
  document.getElementById('r-value').textContent = '$' + value.toFixed(2);
}
window.calculateCredits = calculateCredits;

// ─── Utilities ─────────────────────────────────────────────────────────────
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// ─── Boot ──────────────────────────────────────────────────────────────────
(function init() {
  if (state.token) {
    onAuthed();
  } else {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
  }
})();
