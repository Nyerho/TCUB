# Cloudflare Container deployment

This repository is prepared for Cloudflare Containers, not the pure Worker/Durable Object runtime. The application uses Node-only capabilities including Express, EJS, native SQLite, Firebase Admin, and multipart KYC uploads, so the complete app runs inside the Docker image while a Worker Durable Object forwards requests to it.

## Prerequisites

Install and authenticate Wrangler, then make sure the Cloudflare account has Containers enabled:

```bash
npx wrangler login
npx wrangler whoami
```

The deployment uses `wrangler.jsonc`, `Dockerfile`, and the `TCUBContainer` Durable Object class.

## Required Cloudflare secrets

Set each secret in the Cloudflare Worker environment. Do not put these values in `wrangler.jsonc`, commit them, or paste them into source files.

```bash
npx wrangler secret put SESSION_SECRET --config wrangler.jsonc
npx wrangler secret put ADMIN_EMAIL --config wrangler.jsonc
npx wrangler secret put ADMIN_PASSWORD --config wrangler.jsonc
npx wrangler secret put FIREBASE_PROJECT_ID --config wrangler.jsonc
npx wrangler secret put FIREBASE_API_KEY --config wrangler.jsonc
npx wrangler secret put FIREBASE_AUTH_DOMAIN --config wrangler.jsonc
npx wrangler secret put FIREBASE_STORAGE_BUCKET --config wrangler.jsonc
npx wrangler secret put FIREBASE_MESSAGING_SENDER_ID --config wrangler.jsonc
npx wrangler secret put FIREBASE_APP_ID --config wrangler.jsonc
npx wrangler secret put FIREBASE_MEASUREMENT_ID --config wrangler.jsonc
npx wrangler secret put FIREBASE_CLIENT_EMAIL --config wrangler.jsonc
npx wrangler secret put FIREBASE_PRIVATE_KEY --config wrangler.jsonc
npx wrangler secret put BREVO_API_KEY --config wrangler.jsonc
npx wrangler secret put BREVO_SENDER_NAME --config wrangler.jsonc
npx wrangler secret put EMAIL_FROM --config wrangler.jsonc
npx wrangler secret put EMAIL_REPLY_TO --config wrangler.jsonc
```

Optional values can also be set as secrets when used:

```bash
npx wrangler secret put SUPPORT_EMAIL --config wrangler.jsonc
npx wrangler secret put APP_BASE_URL --config wrangler.jsonc
npx wrangler secret put JIVO_WIDGET_ID --config wrangler.jsonc
npx wrangler secret put ADMIN_FIRST_NAME --config wrangler.jsonc
npx wrangler secret put ADMIN_LAST_NAME --config wrangler.jsonc
npx wrangler secret put ADMIN_ROLE --config wrangler.jsonc
```

For `FIREBASE_PRIVATE_KEY`, provide the complete service-account private key. The application accepts real line breaks and escaped `\\n` sequences.

## Local container smoke test

Create a local-only `.dev.vars` file from `.dev.vars.example` and fill it with test values. Never commit `.dev.vars`.

```bash
cp .dev.vars.example .dev.vars
npm run cf:dev
```

The Docker image uses Node 20, installs the native build toolchain, and builds `better-sqlite3` inside the image. The health endpoint is:

```text
http://127.0.0.1:8787/health
```

## Deploy

Validate the Worker configuration first:

```bash
npx wrangler deploy --config wrangler.jsonc --dry-run
```

Deploy the container-backed Worker:

```bash
npm run cf:deploy
```

After deployment, verify:

```text
https://<worker-subdomain>.workers.dev/health
```

Expected response:

```json
{"status":"ok"}
```

## Data and runtime notes

Firebase Authentication and Firestore remain the authoritative user/account source when the Firebase Admin secrets are configured. SQLite in the container is a local cache and operational store; it is not a substitute for durable Firestore data. KYC files written to the container filesystem are temporary and should be moved to durable object storage before production banking use.

## References

- [Cloudflare Containers getting started](https://developers.cloudflare.com/containers/get-started/)
- [Cloudflare Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
