# TCUB Firebase setup

The web app reads Firebase client configuration from environment variables. Firebase API keys and browser configuration are not server secrets, but they should still be supplied through the deployment environment so Netlify secret scanning does not mistake committed values for credentials. Service-account credentials must never be committed.

## Required deployment environment

Set these values in Netlify or another deployment environment:

```env
FIREBASE_PROJECT_ID=<firebase-project-id>
FIREBASE_API_KEY=<firebase-web-api-key>
FIREBASE_AUTH_DOMAIN=<firebase-auth-domain>
FIREBASE_STORAGE_BUCKET=<firebase-storage-bucket>
FIREBASE_MESSAGING_SENDER_ID=<messaging-sender-id>
FIREBASE_APP_ID=<firebase-app-id>
FIREBASE_MEASUREMENT_ID=<measurement-id>
FIREBASE_CLIENT_EMAIL=<firebase-service-account-client-email>
FIREBASE_PRIVATE_KEY=<firebase-service-account-private-key>
ADMIN_EMAIL=<admin-email>
ADMIN_PASSWORD=<set securely; do not commit>
FIREBASE_ADMIN_UID=<optional-admin-uid>
SUPPORT_EMAIL=<support-email>
JIVO_WIDGET_ID=<optional-widget-id>
```

## Create the requested Firebase admin

After setting the service-account values and admin password locally, run:

```bash
node scripts/bootstrap-firebase.js
```

This creates or updates the Firebase Authentication user, assigns the `super_admin` custom claim, and writes the relevant admin and user documents.

The complete copy/paste rules are in [`firestore.rules`](./firestore.rules).
