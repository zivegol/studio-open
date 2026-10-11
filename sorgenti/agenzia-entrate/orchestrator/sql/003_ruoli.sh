#!/bin/sh
# Imposta le password dei ruoli leggendole dai Docker secrets (usare solo caratteri alfanumerici).
set -e
for r in orchestratore worker auditor; do
  pw=$(cat "/run/secrets/pg_$r")
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "ALTER ROLE app_$r PASSWORD '$pw'"
done
