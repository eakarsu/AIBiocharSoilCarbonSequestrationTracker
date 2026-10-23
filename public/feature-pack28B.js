(function () {
  'use strict';
  // Feature pack 28B (vanilla): tasks, search/filter, CSV/JSON export, AI.
  function token() { try { return localStorage.getItem('token') || sessionStorage.getItem('token') || ''; } catch (_) { return ''; } }
  function headers() { return { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' }; }
  function renderAi(target, result) {
    if (!target) return;
    var note = result && result.aiGenerated === false ? '<p>Deterministic fallback \u2014 no AI provider configured (aiGenerated: false)</p>' : '';
    var body = (window.BrowserAIReport && result) ? window.BrowserAIReport.render(result) : '<pre>' + JSON.stringify(result, null, 2) + '</pre>';
    target.innerHTML = note + body;
  }
  function mount(rootId) {
    var root = document.getElementById(rootId); if (!root) return;
    root.innerHTML = '<h2>Feature Pack \u2014 Tasks, Export &amp; AI</h2>'
      + '<input id="fp-search" type="search" placeholder="Search main records" aria-label="Search main records">'
      + '<button id="fp-csv" type="button">Export CSV</button><button id="fp-json" type="button">Export JSON</button>'
      + '<p id="fp-count"></p>'
      + '<form id="fp-task-form"><input id="fp-task-title" placeholder="Task title" aria-label="Task title"><button type="submit">Add task</button></form>'
      + '<ul id="fp-tasks"></ul><div id="fp-ai-buttons"></div><div id="fp-ai-result"></div>';
    function load() {
      var q = encodeURIComponent(root.querySelector('#fp-search').value || '');
      fetch('/api/feature-pack/records?search=' + q, { headers: headers() }).then(function (r) { return r.json(); }).then(function (j) { root.querySelector('#fp-count').textContent = (j.data || []).length + ' record(s)'; }).catch(function () {});
      fetch('/api/feature-pack/tasks', { headers: headers() }).then(function (r) { if (!r.ok) { var f = root.querySelector('#fp-task-form'); if (f) f.style.display = 'none'; return { data: [] }; } return r.json(); }).then(function (j) {
        root.querySelector('#fp-tasks').innerHTML = (j.data || []).map(function (t) { return '<li>' + String(t.title) + ' \u2014 ' + String(t.status) + '</li>'; }).join('');
      }).catch(function () {});
      fetch('/api/feature-pack/ai/features', { headers: headers() }).then(function (r) { return r.json(); }).then(function (j) {
        root.querySelector('#fp-ai-buttons').innerHTML = (j.features || []).map(function (f) { return '<button type="button" data-fp-ai="' + f + '">' + f + '</button>'; }).join('');
        root.querySelectorAll('[data-fp-ai]').forEach(function (b) { b.addEventListener('click', function () {
          fetch('/api/feature-pack/ai/' + b.getAttribute('data-fp-ai'), { method: 'POST', headers: headers(), body: '{}' }).then(function (r) { return r.json(); }).then(function (res) { renderAi(root.querySelector('#fp-ai-result'), res); });
        }); });
      }).catch(function () {});
    }
    root.querySelector('#fp-search').addEventListener('input', load);
    root.querySelector('#fp-task-form').addEventListener('submit', function (e) { e.preventDefault(); var v = root.querySelector('#fp-task-title').value.trim(); if (!v) return; fetch('/api/feature-pack/tasks', { method: 'POST', headers: headers(), body: JSON.stringify({ title: v }) }).then(load); });
    function dl(fmt) { fetch('/api/feature-pack/records/export?format=' + fmt, { headers: headers() }).then(function (r) { return r.blob(); }).then(function (b) { var u = URL.createObjectURL(b); var a = document.createElement('a'); a.href = u; a.download = 'records.' + fmt; a.click(); URL.revokeObjectURL(u); }); }
    root.querySelector('#fp-csv').addEventListener('click', function () { dl('csv'); });
    root.querySelector('#fp-json').addEventListener('click', function () { dl('json'); });
    load();
  }
  window.FeaturePack28B = { mount: mount, renderAi: renderAi };
})();
