#!/usr/bin/env bash
# Rebuilds a scratch database and runs every migration + the tests.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${DB:-volunteers_test}
sudo service postgresql start >/dev/null 2>&1 || true; sleep 1
PSQL="psql -v ON_ERROR_STOP=1 -q -X"
sudo -u postgres dropdb --if-exists "$DB"
sudo -u postgres createdb "$DB"
sudo -u postgres $PSQL -d "$DB" -f tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do
  echo "migrate: $f"
  # pg_cron is not installed locally; the stub provides cron.schedule()
  sed 's/^create extension if not exists pg_cron.*$/-- (pg_cron skipped locally)/' "$f" \
    | sudo -u postgres $PSQL -d "$DB"
done
for f in "$@"; do
  echo "run: $f"
  sudo -u postgres $PSQL -d "$DB" -f "$f"
done
