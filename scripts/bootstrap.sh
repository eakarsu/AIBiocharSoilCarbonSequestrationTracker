#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
if [ ! -f .env ]; then cp .env.example .env; echo "Created .env; replace placeholder secrets before starting."; fi
npm ci
echo "Dependencies installed. Run npm run db:migrate explicitly before start.sh."
