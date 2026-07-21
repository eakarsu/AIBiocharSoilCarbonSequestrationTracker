#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$project_dir"
if [ ! -f .env ]; then echo "Missing .env; copy .env.example and configure it." >&2; exit 1; fi
if [ ! -d node_modules ]; then echo "Dependencies are absent; run scripts/bootstrap.sh first." >&2; exit 1; fi
set -a; . ./.env; set +a
exec npm start
