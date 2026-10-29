# Deployment runbook — Stage 17

CreatorCo runs as one container on **Google Cloud Run** with **Supabase Postgres**, both in **Mumbai**, with two
environments: **staging** (fictional demo data, mock providers) and **production** (no demo data; real use starts
only after vendors, counsel and the partner lender sign off). Everything here fits the providers' free tiers for a
proof of concept; §10 lists what to upgrade before commercial use.

```
GitHub (main) ──CI passes──▶ Deploy workflow ──keyless (WIF)──▶ Google Cloud (asia-south1, Mumbai)
                                │                                 ├─ Artifact Registry: one image per commit
                                ├─ migrate (+ demo seed: staging) ├─ Cloud Run: creatorco-staging / -production
                                └─ build → push → deploy          ├─ Secret Manager: settings per environment
                                                                  ├─ Cloud Scheduler: jobs tick every 5 min
Supabase (ap-south-1, Mumbai) ◀── pooler, TLS ────────────────────┘  Cloud Logging, uptime checks, alerts
  creatorco-staging · creatorco-production
```

## 1. What it costs (free tiers, checked October 2026)

| Piece                         | Free allowance                                                                | CreatorCo's use                                            |
| ----------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Cloud Run (request-based)     | 180,000 vCPU-s, 360,000 GiB-s, 2M requests / month per billing account        | Two services, scale to zero                                |
| Cloud Scheduler               | 3 jobs per billing account                                                    | 2 (one tick per environment)                               |
| Secret Manager                | 6 active secret versions, 10,000 accesses / month                             | 4 secrets, 1 version each                                  |
| Artifact Registry             | 0.5 GiB storage                                                               | Cleanup policy keeps the latest 3 images                   |
| Cloud Logging                 | 50 GiB / project / month, 30-day retention                                    | Structured, redacted app logs                              |
| Uptime checks                 | 1M executions / project                                                       | 2 checks × 3 regions every 5 min                           |
| Alerting                      | Not billed before September 2027 (Google's notice)                            | Error-log alert per environment                            |
| Supabase Free                 | 2 projects, 500 MB each, **no backups**, paused after 7 days without activity | Staging + production (the 5-minute tick keeps them active) |
| GitHub Actions (private repo) | About 2,000 Linux minutes / month on GitHub Free                              | ~15 min per CI run plus deploy                             |

Google Cloud needs a billing account (a card) even inside the free tier: `setup.sh` adds a budget alert.
Vercel's free plan was ruled out: it is for non-commercial personal use only, and its cron runs once a day.

## 2. Before you start

- A Google Cloud project with billing, and the `gcloud` CLI logged in as an Owner (`gcloud auth login`).
  `gcloud components install beta` (used for the alert e-mail channel).
- A Supabase account.
- Admin access to the GitHub repository (`dev-iiml/claude_DS_Test`).
- `openssl` and Node 22 locally.

## 3. Supabase (once per environment)

1. Create two projects, **creatorco-staging** and **creatorco-production**, region **South Asia (Mumbai)**, with a
   generated database password (keep it in your password manager).
2. **SQL Editor:** run `infra/supabase/app-role.sql`, replacing `CHANGE_ME` with `openssl rand -hex 24`. This creates
   `creatorco_web`, the app's login, as a member of the least-privilege `creatorco_app` role.
3. **Turn off the Data API** (Project Settings → Data API; the label may differ slightly): CreatorCo never uses Supabase's REST/GraphQL APIs or
   Auth, and its tables must not be reachable through them. (Migrations also revoke the API roles and keep RLS on.)
4. **Connection strings** (Connect → connection string, "Pooler"). Cloud Run and GitHub runners reach Supabase over
   IPv4, so always use the **pooler** host shown there (for Mumbai, of the form `aws-N-ap-south-1.pooler.supabase.com`),
   not the direct `db.<ref>.supabase.co` host:
   - **App** — transaction pooler, port **6543**, user `creatorco_web.<project-ref>`, the password from step 2.
   - **Migrations** — session pooler, port **5432**, user `postgres.<project-ref>`, the project password.
     Both must end with `?sslmode=require` (TLS), and special characters in passwords must be URL-encoded (`#` → `%23`);
     `app-env.sh` refuses anything else.

## 4. Google Cloud (once)

```bash
export PROJECT_ID=<your-project-id> GITHUB_REPO=dev-iiml/claude_DS_Test ALERT_EMAIL=<you@company.com>
export BILLING_ACCOUNT=<XXXXXX-XXXXXX-XXXXXX> BUDGET_AMOUNT=1000INR
export GITHUB_REPOSITORY_ID=<id>   # optional, recommended: gh api repos/dev-iiml/claude_DS_Test --jq .id
infra/gcp/setup.sh bootstrap
```

This enables the APIs and creates, all in Mumbai: the image registry (with a cleanup policy that always keeps the image
tagged `production`), a runtime and a deployer service account per environment, a placeholder Cloud Run service per
environment (each deployer may change only its own), empty secrets, keyless GitHub federation (staging: runs in this
repository; production: only runs from `main`) and the budget alert. It prints four values for GitHub.

Then fill each environment's secrets (keys are generated for you, the database URLs are asked for and never echoed):

```bash
infra/gcp/app-env.sh staging
infra/gcp/app-env.sh production
```

| Secret                          | Holds                                                                                                                                                                  | Read by                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `creatorco-<env>-app-env`       | `DATABASE_URL` (app login), `PAN_FINGERPRINT_SECRET`, `FI_DATA_ENCRYPTION_KEY`, `PARTNER_WEBHOOK_ROOT_KEY`, `ANALYTICS_PSEUDONYM_KEY`, `RATE_LIMIT_KEY`, `CRON_SECRET` | that environment's Cloud Run service (mounted at `/secrets/app.env`) |
| `creatorco-<env>-migration-url` | `DATABASE_MIGRATION_URL` (owner), and for staging `SEED_DEMO_PASSWORD`                                                                                                 | that environment's deploy workflow                                   |

## 5. GitHub (once)

Settings → Secrets and variables → Actions → **Variables** (not secrets — none of these are sensitive):

| Variable                                                                 | Value                                                          |
| ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `GCP_PROJECT_ID`, `GCP_PROJECT_NUMBER`, `GCP_REGION`, `GCP_WIF_PROVIDER` | printed by `setup.sh bootstrap`                                |
| `ANALYTICS_CAMPAIGNS`                                                    | optional, registered sign-up campaigns (comma-separated slugs) |

## 6. First staging deploy

1. Merge the stage branches into `main` (open a PR from `stage-17`). **CI** runs; when it passes, **Deploy** runs for
   staging: migrations, the fictional demo seed, one image build, Cloud Run deploy. The first run ends with a warning
   that the service isn't public yet — expected.
2. `infra/gcp/setup.sh publish staging` — public access, the 5-minute job scheduler, the uptime check and the
   error-log e-mail alert. The URL is `https://creatorco-staging-<project-number>.asia-south1.run.app`.
3. Your first staff account (the demo staff also exist on staging, with the generated demo password):

   ```bash
   export DATABASE_MIGRATION_URL="$(gcloud secrets versions access latest --secret=creatorco-staging-migration-url \
     --project "$PROJECT_ID" | sed -n 's/^DATABASE_MIGRATION_URL=//p' | tr -d '"')"
   read -rs STAFF_PASSWORD && export STAFF_PASSWORD   # 14+ chars, mixed case, a digit, a symbol
   npm run staff:create -- --email you@company.com --role super_admin                 # the first account
   npm run staff:create -- --email colleague@company.com --role risk_admin --by you@company.com   # later ones
   unset DATABASE_MIGRATION_URL STAFF_PASSWORD
   ```

   `--by` records who created each account in the audit trail. Staging shows a "demo environment" banner; its demo
   staff accounts all share the generated demo password, so treat staging as a demo, not a place for real data.

## 7. Verify a deployment

- [ ] `GET /api/v1/health` returns `{"status":"ok"}` (it also checks the database).
- [ ] Sign in as an ops admin → **/ops** → "Rate-limit client address" shows **your own** public IP. If it shows a
      Google address or "not found", change `CLIENT_IP_TRUSTED_HOPS` in `.github/workflows/deploy.yml` (Cloud Run's
      `*.run.app` appends the client address last, so the default is 1) and redeploy.
- [ ] **/ops/jobs** shows the scheduled jobs succeeding every few minutes.
- [ ] Browser DevTools: a `Content-Security-Policy` with a nonce, no CSP errors in the console, `__Host-cc_session`
      cookie after sign-in.
- [ ] Cloud Logging → the service's logs show JSON lines with `severity`, and no request bodies or personal data.

## 8. Operations

- **Logs:** Cloud Run → service → Logs (30 days). Errors also e-mail `ALERT_EMAIL` (at most hourly).
- **Rollback:** `gcloud run services update-traffic creatorco-<env> --region asia-south1 --to-revisions <REVISION>=100`
  (revisions are listed in the console). The next deploy sends all traffic to the new release again. Migrations only
  add; roll the schema forward, never back.
- **Production release:** Actions → Deploy → Run workflow → branch `main`, environment `production`. It takes the image
  staging is **serving**, checks that its commit is on `main` and passed CI, migrates production from that same commit,
  deploys that exact image and tags it `production`. Then, once:
  `infra/gcp/setup.sh publish production` and `npm run staff:create` against production. Production refuses mock
  providers, so creator flows that need a provider stay unavailable until real vendors are configured in **/ops**.
- **Secret rotation** — add a new secret version, then redeploy:
  - safe any time: the database passwords (change in Supabase first), `CRON_SECRET` (re-run `setup.sh publish <env>`),
    `RATE_LIMIT_KEY` (counters restart);
  - **never casually:** `FI_DATA_ENCRYPTION_KEY` (sealed AA data becomes unreadable), `PAN_FINGERPRINT_SECRET`
    (duplicate checks stop matching), `ANALYTICS_PSEUDONYM_KEY` (use the versioned `_PREVIOUS_KEYS` procedure),
    `PARTNER_WEBHOOK_ROOT_KEY` (every partner's signing secret changes — coordinate first).
  - destroy old versions afterwards (Secret Manager's free tier counts active versions).
- **Supabase free tier:** no backups — fine for staging's fictional data and an empty production; upgrade before any
  real creator signs up (§10). Projects pause after 7 days without activity; the scheduler tick prevents that.

## 9. Known limitations of this setup

- **Cold starts:** instances scale to zero; the first request after idle takes a few seconds.
- **`after()` work** (signed-out page-view counts) runs with throttled CPU once the response is sent (request-based
  billing), so those counts can land late or, rarely, be lost when an instance stops.
- **Default `*.run.app` URLs**: custom domains need a load balancer (paid) or a later move.
- **No WAF / DDoS rules** beyond Google's front end and the app's own rate limits.
- **GitHub Free**: environment approvals (required reviewers) aren't available on private repositories; production
  is protected by the branch check and the main-only federation binding instead.
- **Database TLS** uses `sslmode=require`: encrypted, but the server certificate isn't verified against Supabase's CA.
  Add certificate verification (or private connectivity) before real data.
- Actions are pinned to major versions and the base image to a version tag; pin both to SHAs/digests when hardening.
- `CRON_SECRET` is stored in the Cloud Scheduler job's headers, readable by anyone with viewer access to the project.

## 10. After the POC: upgrade path

| Now (free)                                  | Before commercial use / real creators                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Supabase Free (no backups, pausing)         | Supabase Pro or Team (daily backups, PITR add-on, no pausing), or Cloud SQL in Mumbai                 |
| Cloud Run request-based, scale to zero      | Min instances ≥ 1 (no cold starts), instance-based billing for background work                        |
| `*.run.app`                                 | External HTTPS load balancer with a custom domain, Cloud Armor (WAF, rate rules), managed certificate |
| Cloud Logging 30 days                       | Longer log retention per the retention schedule (CERT-In: 180 days for security logs), log sinks      |
| Password-only staff sign-in                 | SSO with MFA (Google Workspace / an IdP) in front of staff consoles                                   |
| GitHub Free                                 | GitHub Team (required reviewers on production), Dependabot, SHA-pinned actions                        |
| Public service + DB over the internet (TLS) | Private connectivity (VPC, Private Service Connect) and a bank-review-ready network design            |
