#!/usr/bin/env bash
# CreatorCo on Google Cloud (Stage 17) — free-tier-first, Mumbai (asia-south1), staging + production.
#
# Idempotent: safe to re-run. Run from a machine where `gcloud auth login` is done, as a project Owner.
#
#   export PROJECT_ID=creatorco-poc GITHUB_REPO=dev-iiml/claude_DS_Test ALERT_EMAIL=you@company.com
#   export GITHUB_REPOSITORY_ID=123456789     # optional, recommended: pins federation to this exact repository
#   export BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX BUDGET_AMOUNT=1000INR    # amount in your billing currency
#   infra/gcp/setup.sh bootstrap            # once: APIs, registry, service accounts, GitHub federation, secrets
#   infra/gcp/setup.sh publish staging      # after the first staging deploy: public access, scheduler, uptime
#   infra/gcp/setup.sh publish production   # same for production
#
# Nothing here stores a secret value: secrets are created empty and filled with infra/gcp/app-env.sh.
# See docs/DEPLOYMENT.md for the full runbook.
set -euo pipefail

: "${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-asia-south1}"
REPO="${REPO:-creatorco}"
ENVS=(staging production)

gc() { gcloud --project "$PROJECT_ID" --quiet "$@"; }
exists() { "$@" >/dev/null 2>&1; }
project_number() { gc projects describe "$PROJECT_ID" --format='value(projectNumber)'; }
sa_email() { echo "$1@${PROJECT_ID}.iam.gserviceaccount.com"; }
service_name() { echo "creatorco-$1"; }

ensure_sa() { # name, display
  exists gc iam service-accounts describe "$(sa_email "$1")" ||
    gc iam service-accounts create "$1" --display-name="$2"
}

ensure_secret() { # name — replicated only in Mumbai (data residency)
  exists gc secrets describe "$1" ||
    gc secrets create "$1" --replication-policy=user-managed --locations="$REGION" --labels=app=creatorco
}

bootstrap() {
  : "${GITHUB_REPO:?set GITHUB_REPO (owner/name)}"
  echo "→ APIs"
  gc services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
    cloudscheduler.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
    logging.googleapis.com monitoring.googleapis.com cloudresourcemanager.googleapis.com \
    billingbudgets.googleapis.com

  echo "→ Artifact Registry (Mumbai) with a cleanup policy (free tier: 0.5 GiB)"
  exists gc artifacts repositories describe "$REPO" --location="$REGION" ||
    gc artifacts repositories create "$REPO" --repository-format=docker --location="$REGION" \
      --description="CreatorCo images"
  local policy
  policy="$(mktemp)"
  cat >"$policy" <<'JSON'
[
  {"name": "keep-production", "action": {"type": "Keep"},
   "condition": {"tagState": "TAGGED", "tagPrefixes": ["production"]}},
  {"name": "keep-recent", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 5}},
  {"name": "delete-old", "action": {"type": "Delete"}, "condition": {"olderThan": "604800s"}}
]
JSON
  gc artifacts repositories set-cleanup-policies "$REPO" --location="$REGION" --policy="$policy" --no-dry-run
  rm -f "$policy"

  echo "→ Service accounts and secrets"
  local env
  for env in "${ENVS[@]}"; do
    ensure_sa "creatorco-$env-run" "CreatorCo $env runtime"
    ensure_sa "creatorco-$env-deploy" "CreatorCo $env deployer (GitHub Actions)"
    ensure_secret "creatorco-$env-app-env"
    ensure_secret "creatorco-$env-migration-url"
    # Runtime reads only its own app settings; the deployer only its own migration URL.
    gc secrets add-iam-policy-binding "creatorco-$env-app-env" \
      --member="serviceAccount:$(sa_email "creatorco-$env-run")" --role=roles/secretmanager.secretAccessor >/dev/null
    gc secrets add-iam-policy-binding "creatorco-$env-migration-url" \
      --member="serviceAccount:$(sa_email "creatorco-$env-deploy")" --role=roles/secretmanager.secretAccessor >/dev/null
    # Read-only on Cloud Run project-wide (operations, revisions); deploy rights only on its OWN service, below.
    gc projects add-iam-policy-binding "$PROJECT_ID" --condition=None \
      --member="serviceAccount:$(sa_email "creatorco-$env-deploy")" --role=roles/run.viewer >/dev/null
    gc iam service-accounts add-iam-policy-binding "$(sa_email "creatorco-$env-run")" \
      --member="serviceAccount:$(sa_email "creatorco-$env-deploy")" --role=roles/iam.serviceAccountUser >/dev/null
  done

  echo "→ Cloud Run services (placeholder until the first deploy) and per-service deploy rights"
  for env in "${ENVS[@]}"; do
    local service
    service="$(service_name "$env")"
    exists gc run services describe "$service" --region="$REGION" ||
      gc run deploy "$service" --region="$REGION" --image=us-docker.pkg.dev/cloudrun/container/hello \
        --service-account="$(sa_email "creatorco-$env-run")" --no-allow-unauthenticated \
        --labels="app=creatorco,env=$env" >/dev/null
    # Each deployer can change only its own environment's service: staging can't touch production.
    gc run services add-iam-policy-binding "$service" --region="$REGION" \
      --member="serviceAccount:$(sa_email "creatorco-$env-deploy")" --role=roles/run.developer >/dev/null
  done
  # Staging builds and pushes images; production only promotes them (and tags the one it runs as "production").
  local deployer
  for deployer in creatorco-staging-deploy creatorco-production-deploy; do
    gc artifacts repositories add-iam-policy-binding "$REPO" --location="$REGION" \
      --member="serviceAccount:$(sa_email "$deployer")" --role=roles/artifactregistry.writer >/dev/null
  done

  echo "→ GitHub Actions federation (no keys stored in GitHub)"
  local number pool="github" provider="github-oidc"
  number="$(project_number)"
  exists gc iam workload-identity-pools describe "$pool" --location=global ||
    gc iam workload-identity-pools create "$pool" --location=global --display-name="GitHub Actions"
  exists gc iam workload-identity-pools providers describe "$provider" --location=global --workload-identity-pool="$pool" ||
    gc iam workload-identity-pools providers create-oidc "$provider" --location=global --workload-identity-pool="$pool" \
      --issuer-uri="https://token.actions.githubusercontent.com" \
      --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repo_ref=assertion.repository + '@' + assertion.ref" \
      --attribute-condition="assertion.repository == '${GITHUB_REPO}'${GITHUB_REPOSITORY_ID:+ && assertion.repository_id == '${GITHUB_REPOSITORY_ID}'}"
  local principal="principalSet://iam.googleapis.com/projects/${number}/locations/global/workloadIdentityPools/${pool}"
  # Staging: any workflow run in this repository. Production: only runs from the main branch.
  gc iam service-accounts add-iam-policy-binding "$(sa_email creatorco-staging-deploy)" \
    --role=roles/iam.workloadIdentityUser --member="${principal}/attribute.repository/${GITHUB_REPO}" >/dev/null
  gc iam service-accounts add-iam-policy-binding "$(sa_email creatorco-production-deploy)" \
    --role=roles/iam.workloadIdentityUser --member="${principal}/attribute.repo_ref/${GITHUB_REPO}@refs/heads/main" >/dev/null

  if [[ -n "${BILLING_ACCOUNT:-}" && -n "${BUDGET_AMOUNT:-}" ]]; then
    echo "→ Budget alert (emails billing admins at 50%, 90% and 100%)"
    [[ -n "$(gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" --filter="displayName=creatorco" \
      --format='value(name)')" ]] ||
      gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" --display-name=creatorco \
        --budget-amount="$BUDGET_AMOUNT" --filter-projects="projects/${PROJECT_ID}" \
        --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
  else
    echo "! skipped the budget alert: set BILLING_ACCOUNT and BUDGET_AMOUNT (e.g. 1000INR) and re-run"
  fi

  cat <<NEXT

✓ bootstrap done. Add these to GitHub → Settings → Secrets and variables → Actions → Variables:
  GCP_PROJECT_ID        = ${PROJECT_ID}
  GCP_PROJECT_NUMBER    = ${number}
  GCP_REGION            = ${REGION}
  GCP_WIF_PROVIDER      = projects/${number}/locations/global/workloadIdentityPools/${pool}/providers/${provider}
Next: fill the secrets with infra/gcp/app-env.sh (docs/DEPLOYMENT.md §4).
NEXT
}

publish() { # env — after the first deploy of that environment
  local env="${1:?usage: publish staging|production}" service url cron
  [[ " ${ENVS[*]} " == *" $env "* ]] || { echo "unknown environment: $env"; exit 1; }
  service="$(service_name "$env")"
  url="$(gc run services describe "$service" --region="$REGION" --format='value(status.url)')"
  [[ -n "$url" ]] || { echo "deploy $env first (no service $service)"; exit 1; }

  echo "→ Public access for $service"
  if ! gc run services add-iam-policy-binding "$service" --region="$REGION" \
    --member=allUsers --role=roles/run.invoker >/dev/null; then
    # Organisations with "domain restricted sharing" refuse allUsers; skipping the invoker check is the alternative.
    echo "  allUsers was refused (organisation policy?) — turning off the invoker IAM check instead"
    gc run services update "$service" --region="$REGION" --no-invoker-iam-check >/dev/null
  fi

  echo "→ Job scheduler: every 5 minutes (free tier: 3 jobs per billing account)"
  cron="$(gc secrets versions access latest --secret="creatorco-$env-app-env" | sed -n 's/^CRON_SECRET=//p' | tr -d '"')"
  [[ -n "$cron" ]] || { echo "CRON_SECRET missing from creatorco-$env-app-env"; exit 1; }
  local job="creatorco-$env-tick"
  local common=(--location="$REGION" --schedule="*/5 * * * *" --time-zone="Asia/Kolkata"
    --uri="${url}/api/internal/cron/tick" --http-method=GET --attempt-deadline=120s)
  if exists gc scheduler jobs describe "$job" --location="$REGION"; then
    gc scheduler jobs update http "$job" "${common[@]}" --update-headers="Authorization=Bearer ${cron}" >/dev/null
  else
    gc scheduler jobs create http "$job" "${common[@]}" --headers="Authorization=Bearer ${cron}" >/dev/null
  fi

  echo "→ Uptime check on /api/v1/health (free: 1M executions per project)"
  [[ -n "$(gc monitoring uptime list-configs --filter="displayName=creatorco-$env-health" --format='value(name)')" ]] ||
    gc monitoring uptime create "creatorco-$env-health" --resource-type=uptime-url \
      --resource-labels="host=${url#https://},project_id=${PROJECT_ID}" --path=/api/v1/health --protocol=https \
      --period=5 --timeout=10 --regions=asia-pacific,europe,usa-virginia >/dev/null

  if [[ -n "${ALERT_EMAIL:-}" ]]; then
    echo "→ Email alerts: error logs (needs: gcloud components install beta)"
    local channel policy
    channel="$(gc beta monitoring channels list --filter="labels.email_address=\"${ALERT_EMAIL}\"" --format='value(name)' --limit=1)"
    [[ -n "$channel" ]] || channel="$(gc beta monitoring channels create --display-name="CreatorCo alerts" \
      --type=email --channel-labels="email_address=${ALERT_EMAIL}" --format='value(name)')"
    policy="$(mktemp)"
    cat >"$policy" <<JSON
{
  "displayName": "creatorco-${env}: errors logged",
  "combiner": "OR",
  "conditions": [{
    "displayName": "ERROR log entries from ${service}",
    "conditionMatchedLog": {
      "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${service}\" AND severity>=ERROR"
    }
  }],
  "alertStrategy": {"notificationRateLimit": {"period": "3600s"}, "autoClose": "86400s"},
  "notificationChannels": ["${channel}"]
}
JSON
    [[ -n "$(gc monitoring policies list --filter="displayName=\"creatorco-${env}: errors logged\"" \
      --format='value(name)')" ]] || gc monitoring policies create --policy-from-file="$policy" >/dev/null
    rm -f "$policy"
    echo "  (add an uptime alert in Monitoring → Uptime checks → creatorco-${env}-health → Create alert)"
  else
    echo "! skipped email alerts: set ALERT_EMAIL and re-run"
  fi
  echo "✓ ${env} published at ${url}"
}

case "${1:-}" in
  bootstrap) bootstrap ;;
  publish) publish "${2:-}" ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
