'use strict';

const express = require('express');
const http = require('http');
const path = require('path');

const frontendPort = Number(process.env.FRONTEND_PORT);
const backendPort = Number(process.env.BACKEND_PORT);
if (!Number.isInteger(frontendPort) || !Number.isInteger(backendPort)) throw new Error('BACKEND_PORT and FRONTEND_PORT are required');

const app = express();
app.use('/api', (req, res) => {
  const headers = { ...req.headers, host: `127.0.0.1:${backendPort}` };
  const upstream = http.request({
    hostname: '127.0.0.1', port: backendPort, path: req.originalUrl,
    method: req.method, headers,
  }, (response) => {
    res.status(response.statusCode || 502);
    for (const [name, value] of Object.entries(response.headers)) if (value !== undefined) res.setHeader(name, value);
    response.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) res.status(502).json({ error: 'API service unavailable' }); else res.end(); });
  req.pipe(upstream);
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(frontendPort, '127.0.0.1', () => console.log(`[Biochar Tracker] UI running on http://127.0.0.1:${frontendPort}`));
