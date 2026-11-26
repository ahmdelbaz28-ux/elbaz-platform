# ⚠️ REFERENCE ONLY — DO NOT APPLY (audit run-3, k8s-manifests-unconsumed-drift)

This manifest set is **not wired to any maintained deployment pipeline** and has
drifted from the application it claims to run. The only real deploy paths in
this repo are:

1. `deploy-hf.yml` — git push (LFS) to the Hugging Face Space (Docker image
   built from the root `Dockerfile`, single container, port 7860).
2. `deploy-cf-worker.yml` — Cloudflare REST API upload of the edge worker.

Do **not** run `apply-all.sh` against a live cluster without a full review.
Known defects as of the run-3 security audit:

- Images referenced (`ahmdelbaz28/ahmdrtap:v1.0.0`, `ahmdrtap-frontend:v1.0.0`,
  and the mutable `:latest` in `20-cronjob-token-cleanup.yaml`) are **never
  built or pushed by any workflow**.
- `09-network-policies.yaml` denies ingress to redis:6379 with no allow-policy
  (backend cannot reach redis), while `14-redis-statefulset.yaml` runs
  `--protected-mode no` with no `requirepass` bound to `0.0.0.0`.
- `17-cron-db-backup.yaml` wires the secret key `DATABASE_URL` (a URL) into
  `DATABASE_PASSWORD` for mysqldump, and its curl fallback sends
  base64(access:secret) as a Bearer header with `--no-verify-ssl`.
- `20-cronjob-token-cleanup.yaml` executes `@prisma/client` code although this
  app uses drizzle/mysql2 (no prisma dependency exists).
- `runAsUser: 1000` conflicts with the image user (uid 1001); the Dockerfile
  HEALTHCHECK port was fixed to honor `$PORT` but k8s ignores image
  healthchecks anyway.
- Port mapping drift: manifests assume backend :3001 / separate frontend
  deployment, while the app serves everything from one port (7860).

If this mode is ever revived: build+push digest-pinned images in CI, add a
redis ingress allow-policy + requirepass, fix the backup secret wiring, remove
the prisma cronjob, and reconcile the port topology — then delete this warning.
