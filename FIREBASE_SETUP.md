# TCUB Firebase setup

The web app is configured for Firebase project `tcub-b96a6`. The Firebase web API key is public client configuration; service-account credentials must never be committed.

## Required deployment environment

Set these values in the deployment environment:

```env
FIREBASE_PROJECT_ID=tcub-b96a6
FIREBASE_API_KEY=AIzaSyDwY1C_z2plqfUE42zKmN9N9RiCzlTH4fg
FIREBASE_AUTH_DOMAIN=tcub-b96a6.firebaseapp.com
FIREBASE_STORAGE_BUCKET=tcub-b96a6.firebasestorage.app
FIREBASE_MESSAGING_SENDER_ID=235825524366
FIREBASE_APP_ID=1:235825524366:web:07115b8e05c4dace4c23df
FIREBASE_MEASUREMENT_ID=G-8J4ETW9J8N
FIREBASE_CLIENT_EMAIL=<Firebase service-account client email>
FIREBASE_PRIVATE_KEY=<Firebase service-account private key>
ADMIN_EMAIL=admin@tcub.xyz
ADMIN_PASSWORD=<set securely; do not commit>
FIREBASE_ADMIN_UID=rGgEI67ClbM7dfI6GsGMaAC2cpn2
SUPPORT_EMAIL=support@thinkcreditunionbank.xyz
JIVO_WIDGET_ID=<you will provide this>
```

## Create the requested Firebase admin

After setting the service-account values and admin password locally, run:

```bash
node scripts/bootstrap-firebase.js
```

This creates or updates the Firebase Authentication user, assigns the `super_admin` custom claim, and writes `admins/<uid>` and `users/<uid>` documents.

The complete copy/paste rules are in [`firestore.rules`](./firestore.rules).
