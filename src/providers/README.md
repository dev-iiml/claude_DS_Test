# providers

Interfaces for bought/partner capabilities plus deterministic mocks. Rules:

- Domain modules import **interfaces** (`./*/types.ts`) and get routed instances from
  `@/modules/integrations/registry` (`await getProviders()`). This folder stays a leaf: no DB or module imports.
- Vendor adapters go next to the mock in the same folder (e.g. `social/<vendor>-social-data-provider.ts`) and are
  registered in `catalog.ts` with the secret names they need and a strict settings schema. Ops then creates a config
  for it in `/ops`, maps each secret to an `INTEGRATION_*` env var, and routes traffic to it after approval.
- Throw `ProviderError` (`errors.ts`): `rejected` when the vendor refused this request, `unavailable`/`timeout` when
  the vendor is unhealthy. Unknown errors count as outages.
- Provider keys stored in our data are vendor-neutral (`provider` column + `external_account_id`).
- Providers return normalised summaries. Raw payloads (AA feeds, bureau reports, KYC documents) are not
  returned into creator-professional storage, logs or analytics.
