# Governed MRV lifecycle

`POST /api/mrv-workflows` creates an idempotent, tenant-scoped MRV record. It normalizes dry mass and carbon fractions into tCO2e, deducts declared uncertainty and leakage, hashes the evidence-bearing record, and blocks missing baseline, additionality, permanence, or measurement provenance. `POST /:id/verify` requires a verifier from a different organization and records an append-only event. Registry identifiers supplied as if already issued are rejected; verification ends at `verified_pending_registry`.

Copy `.env.example`, run `scripts/bootstrap.sh`, and explicitly run `npm run db:migrate`; normal startup never creates schema. The SQLite path must reside on durable encrypted storage in a deployed environment.

Sensor/lab calibration, GIS/remote-sensing ingestion, methodology certification, registry issuance/retirement, market settlement, jurisdiction rules, and independent validation require authoritative providers and accredited reviewers. No local status represents an issued credit.
