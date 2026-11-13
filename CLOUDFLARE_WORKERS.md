# Cloudflare Workers local mock mode

The repository has two Cloudflare entry paths:

- `wrangler.jsonc` is the production configuration. It forwards requests to the existing Express application in a Cloudflare Container because the full application still depends on SQLite, EJS, multer, Firebase Admin, and other Node-only modules.
- `wrangler.mock.jsonc` is a Docker-free Worker configuration for local development. It sets `MOCK_DATA=true` and serves deterministic in-memory fixtures from `src/mock-worker.js`.

## Run the mock Worker locally

```bash
npm install
npm run cf:mock
```

The default local URL is `http://localhost:8787`. Useful smoke checks:

```bash
curl http://localhost:8787/health
curl http://localhost:8787/api/exchange/rates
curl -X POST http://localhost:8787/api/loans/calculate \
  -H 'content-type: application/json' \
  -d '{"principal":12000,"rate":6,"term":12}'
curl -H 'x-mock-user-id: 1' http://localhost:8787/api/user/dashboard-stats
```

The `x-mock-user-id` header is only a local test seam; it is not an authentication mechanism for production. Mock state is process-local and resets when Wrangler restarts.

## Validate the mock implementation

```bash
npm run cf:test
```

The production Container configuration cannot be dry-run locally without Docker because Wrangler must build `Dockerfile`. Deploy it from a Docker-enabled environment or CI after configuring the Firebase and application secrets. The next production migration step is replacing the remaining Express/SQLite routes with Workers-compatible persistence (D1/R2/KV or an external service) and removing the Container forwarding path.
