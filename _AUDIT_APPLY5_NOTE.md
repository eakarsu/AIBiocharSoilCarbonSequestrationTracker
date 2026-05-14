# Apply Pass 5 — AIBiocharSoilCarbonSequestrationTracker

- **Date:** 2026-05-08
- **Audit source:** `_AUDIT/reports/batch_01.md` § 4
- **Stack:** node-express backend (root + `src/`) + static SPA in `public/`; JWT bearer auth via `src/middleware/auth.js`; SQLite via `src/db/schema.js`; rate limiter `src/middleware/rateLimiter`.
- **AI helper:** `src/services/aiService.js` (Anthropic/OpenRouter abstraction).

## Audit context
Batch 01 entry flags this as `SKELETON — No routes or AI endpoints`. **That is a false positive** — see existing `_AUDIT_NOTE.md`. The codebase has 8 route files, 5 AI endpoints in `routes/ai.js`, and a working static SPA wired in pass 3 (`public/js/app.js`).

## Verified-present (Non-AI features inventory)
`auth.js`, `applications.js`, `carbonReports.js`, `dashboard.js`, `fields.js`, `soilSamples.js`, `users.js`. AI: `/analyze-sequestration`, `/soil-health`, `/recommendations`, `/validate-report`, `/portfolio`, `/results`, `/history`.

## Implemented this pass (5 items, all in one module)

All 5 land in **`src/routes/extensions.js`** (new), mounted at `/api/ext` in root `index.js`.

| # | Item | Category | Endpoints |
|---|------|----------|-----------|
| 1 | RAG layer over biochar/soil docs | NEEDS-PRODUCT-DECISION (256-dim hashed BoW embeddings, no vector store dep) | `POST /api/ext/rag/ingest`, `GET /api/ext/rag/search`, `POST /api/ext/rag/ask`, `POST /api/ext/rag/embed-real` (503 unless EMBEDDING_API_KEY) |
| 2 | Agentic workflow orchestration with HIL | NEEDS-PRODUCT-DECISION (linear plan→execute→critique with manual HIL gate) | `POST /api/ext/agentic/runs`, `GET /api/ext/agentic/runs/:id`, `POST /api/ext/agentic/runs/:id/hil` |
| 3 | Real-time anomaly detection on soilSamples | TOO-RISKY (rolling z-score on existing samples, no streaming source) | `POST /api/ext/anomaly/scan`, `GET /api/ext/anomaly/alerts` |
| 4 | White-label / multi-tenancy (additive) | NEEDS-PRODUCT-DECISION (config-only tenant table, no row-level isolation) | `GET/POST /api/ext/tenants`, `POST /api/ext/tenants/:id/members`, `GET /api/ext/tenants/:id/branding` |
| 5 | Real-embeddings escape hatch | NEEDS-CREDS | `POST /api/ext/rag/embed-real` (503 unless `EMBEDDING_API_KEY` and `VECTOR_STORE_URL`) |

## Deferred

| Item | Category | Reason |
|------|----------|--------|
| Real vector store (pgvector / Pinecone / Chroma) | NEEDS-PRODUCT-DECISION | Vendor pick |
| Streaming sensor ingest pipeline | NEEDS-PRODUCT-DECISION + DATA | No live source today |
| Per-row tenant isolation | NEEDS-PRODUCT-DECISION | Schema rewrite |

## Frontend
Existing static SPA (`public/js/app.js`) wires the 5 AI endpoints; no new pass-5 SPA code required for the additive `/api/ext` surface (operationally accessible via API; UI integration is a future pass once vector-store is picked).

## Smoke test
- `node --check src/routes/extensions.js` — PASS.
- Route registration: `app.use('/api/ext', generalLimiter, require('./src/routes/extensions'));` at `index.js` line 66.

## Notes
- All schema is `CREATE TABLE IF NOT EXISTS`; no existing schema modified.
- AI calls return 503 when `ANTHROPIC_API_KEY` (or `OPENROUTER_API_KEY` per service) is unset.
- `EMBEDDING_API_KEY` / `VECTOR_STORE_URL` deliberately documented but optional — when unset the in-memory hash fallback is deterministic and dependency-free.
