#!/usr/bin/env bash
# Fills an environment's secrets in Secret Manager (Stage 17). Run once per environment, after `setup.sh bootstrap`
# and after creating the Supabase project and its app login role (infra/supabase/app-role.sql).
#
#   export PROJECT_ID=creatorco-poc
#   infra/gcp/app-env.sh staging
#
# It asks for the two database URLs, generates every key with openssl, uploads two dotenv files and deletes the
# local copies. Keys are generated ONCE: changing them later breaks sealed data, PAN fingerprints, analytics
# pseudonyms and partner signatures — see docs/DEPLOYMENT.md §8 before rotating anything.
set -euo pipefail

: "${PROJECT_ID:?set PROJECT_ID}"
ENV_NAME="${1:?usage: app-env.sh staging|production}"
[[ "$ENV_NAME" == staging || "$ENV_NAME" == production ]] || { echo "staging or production"; exit 1; }
gc() { gcloud --project "$PROJECT_ID" --quiet "$@"; }

for s in "creatorco-$ENV_NAME-app-env" "creatorco-$ENV_NAME-migration-url"; do
  if [[ -n "$(gc secrets versions list "$s" --filter=state=enabled --format='value(name)' 2>/dev/null)" ]]; then
    echo "$s already has a value. Refusing to generate new keys over it (see docs/DEPLOYMENT.md §8)."
    exit 1
  fi
done

echo "Supabase ($ENV_NAME) — use the POOLER hosts (IPv4), from Project Settings → Database → Connection string."
read -r -s -p "App URL (transaction pooler :6543, user creatorco_web.<ref>): " APP_DB_URL && echo
read -r -s -p "Migration URL (session pooler :5432, user postgres.<ref>): " MIGRATION_DB_URL && echo
check_url() { # name, url — a postgres URL in one piece, with TLS required
  local name="$1" url="$2"
  [[ "$url" == postgres://* || "$url" == postgresql://* ]] || { echo "$name: must start with postgres:// or postgresql://"; exit 1; }
  # Quotes, whitespace and '#' would break the dotenv file; URL-encode special characters in passwords instead.
  [[ "$url" != *[[:space:]\"\'#]* ]] || { echo "$name: URL-encode special characters (no spaces, quotes or #)"; exit 1; }
  [[ "$url" == *sslmode=* ]] || { echo "$name: add ?sslmode=require (TLS) to the URL"; exit 1; }
}
check_url "App URL" "$APP_DB_URL"
check_url "Migration URL" "$MIGRATION_DB_URL"

workdir="$(mktemp -d)"
chmod 700 "$workdir"
trap 'rm -rf "$workdir"' EXIT
hex() { openssl rand -hex 32; }

cat >"$workdir/app.env" <<ENV
DATABASE_URL="${APP_DB_URL}"
PAN_FINGERPRINT_SECRET=$(hex)
FI_DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)
PARTNER_WEBHOOK_ROOT_KEY=$(hex)
ANALYTICS_PSEUDONYM_KEY=$(hex)
RATE_LIMIT_KEY=$(hex)
CRON_SECRET=$(hex)
ENV

{
  echo "DATABASE_MIGRATION_URL=\"${MIGRATION_DB_URL}\""
  # Staging only: the fictional demo accounts' password (production never gets demo data).
  if [[ "$ENV_NAME" == staging ]]; then
    echo "SEED_DEMO_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-28)"
  fi
} >"$workdir/migration.env"

gc secrets versions add "creatorco-$ENV_NAME-app-env" --data-file="$workdir/app.env" >/dev/null
gc secrets versions add "creatorco-$ENV_NAME-migration-url" --data-file="$workdir/migration.env" >/dev/null
echo "✓ secrets stored for $ENV_NAME (local copies deleted)."
if [[ "$ENV_NAME" == staging ]]; then
  echo "  Demo password: gcloud secrets versions access latest --secret=creatorco-staging-migration-url | grep SEED_DEMO"
fi
