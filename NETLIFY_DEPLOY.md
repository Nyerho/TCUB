# Netlify deployment

This project is prepared as a Netlify Functions deployment. The existing Express application is exposed through `netlify/functions/server.js`; `netlify.toml` routes all requests to that function and includes the EJS views and public assets in the function bundle.

## Deploy

1. Push this repository to GitHub and import it into Netlify.
2. Keep the detected build command as `npm run netlify:build` and the publish directory as `public`.
3. Configure the environment variables below in Netlify for the Production context.
4. Deploy. Verify `https://YOUR-DOMAIN/health` returns `{ "status": "ok" }`.

The repository can also be deployed with the Netlify CLI:

```bash
npm install
npx netlify login
npx netlify link
npx netlify deploy --build
npx netlify deploy --build --prod
```

## Required environment variables

```text
NODE_ENV=production
SESSION_SECRET=<long-random-secret>
NETLIFY=true
APP_BASE_URL=https://your-domain.example
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<strong-admin-password>
ADMIN_FIRST_NAME=System
ADMIN_LAST_NAME=Administrator
ADMIN_ROLE=super_admin
ADMIN_PHONE=<optional>
```

Configure Brevo for registration, sign-in alerts, password changes/resets, and transaction activity emails:

```text
BREVO_API_KEY=<brevo-api-key>
BREVO_SENDER_NAME=Think Union Credit Bank
EMAIL_FROM=no-reply@your-domain.example
EMAIL_REPLY_TO=support@your-domain.example
```

`EMAIL_FROM` must be a sender that has been verified in Brevo. After adding or changing these values in Netlify, create a new deploy before testing registration or sign-in. The application never logs the API key; missing configuration causes email delivery to be skipped safely, while Brevo API failures are written to the function logs with the HTTP status.

Firebase Admin/Firestore synchronization is disabled in this Netlify-ready branch because the application currently uses local SQLite as its primary data model. The Firebase web configuration can remain configured for the browser UI, but server-side sync will not run unless it is separately reintroduced for Netlify.

## Important persistence note

Netlify Functions are ephemeral. SQLite is initialized in the function's writable temporary directory and can be reset when a function instance is recycled or scaled. This is suitable for smoke tests and demos, but not for production banking data. Before accepting real users or transactions, replace `database.js` with a durable external database adapter (for example, Postgres/Neon, Turso/libSQL, or another managed SQL service) and migrate the existing schema.

KYC uploads are also temporary on Netlify. Use object storage for production documents and store only object keys in SQL.

## Local Netlify test

```bash
npm install
NETLIFY=true NODE_ENV=development SESSION_SECRET=local-test-secret npm start
curl http://127.0.0.1:3000/health
```

Expected response:

```json
{"status":"ok"}
```
