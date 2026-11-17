import { DurableObject } from 'cloudflare:workers';

const PORT = 3000;
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;

export class TCUBContainer extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.starting = undefined;
    this.monitoring = undefined;

    if (ctx.container?.running) {
      ctx.blockConcurrencyWhile(() =>
        ctx.container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS)
      );
      this.observeExit();
    }
  }

  async fetch(request) {
    this.starting ??= this.startAndWaitForPort().finally(() => {
      this.starting = undefined;
    });
    await this.starting;

    const url = new URL(request.url);
    url.protocol = 'http:';
    url.host = 'container';
    const forwarded = new Request(url, request);
    forwarded.headers.delete('host');
    return this.ctx.container.getTcpPort(PORT).fetch(forwarded);
  }

  async startAndWaitForPort() {
    const container = this.ctx.container;

    if (!container.running) {
      container.start({
        image: container.images.base,
        instance: 'lite',
        enableInternet: true,
        env: {
          PORT: String(PORT),
          NODE_ENV: 'production',
          CLOUDFLARE_CONTAINER: 'true',
          FIREBASE_PROJECT_ID: this.env.FIREBASE_PROJECT_ID,
          FIREBASE_API_KEY: this.env.FIREBASE_API_KEY,
          FIREBASE_AUTH_DOMAIN: this.env.FIREBASE_AUTH_DOMAIN,
          FIREBASE_STORAGE_BUCKET: this.env.FIREBASE_STORAGE_BUCKET,
          FIREBASE_MESSAGING_SENDER_ID: this.env.FIREBASE_MESSAGING_SENDER_ID,
          FIREBASE_APP_ID: this.env.FIREBASE_APP_ID,
          FIREBASE_MEASUREMENT_ID: this.env.FIREBASE_MEASUREMENT_ID,
          FIREBASE_CLIENT_EMAIL: this.env.FIREBASE_CLIENT_EMAIL,
          FIREBASE_PRIVATE_KEY: this.env.FIREBASE_PRIVATE_KEY,
          BREVO_API_KEY: this.env.BREVO_API_KEY,
          BREVO_SENDER_NAME: this.env.BREVO_SENDER_NAME,
          EMAIL_FROM: this.env.EMAIL_FROM,
          EMAIL_REPLY_TO: this.env.EMAIL_REPLY_TO,
          ADMIN_EMAIL: this.env.ADMIN_EMAIL,
          ADMIN_PASSWORD: this.env.ADMIN_PASSWORD,
          ADMIN_FIRST_NAME: this.env.ADMIN_FIRST_NAME,
          ADMIN_LAST_NAME: this.env.ADMIN_LAST_NAME,
          ADMIN_ROLE: this.env.ADMIN_ROLE,
          ADMIN_PHONE: this.env.ADMIN_PHONE,
          FIREBASE_ADMIN_UID: this.env.FIREBASE_ADMIN_UID,
          FIREBASE_ADMIN_COLLECTION: this.env.FIREBASE_ADMIN_COLLECTION,
          FIREBASE_ADMIN_DOC_ID: this.env.FIREBASE_ADMIN_DOC_ID,
          FIRESTORE_USERS_COLLECTION: this.env.FIRESTORE_USERS_COLLECTION,
          FIRESTORE_ACCOUNTS_COLLECTION: this.env.FIRESTORE_ACCOUNTS_COLLECTION,
          FIRESTORE_TRANSACTIONS_COLLECTION: this.env.FIRESTORE_TRANSACTIONS_COLLECTION,
          SESSION_SECRET: this.env.SESSION_SECRET,
          SUPPORT_EMAIL: this.env.SUPPORT_EMAIL,
          APP_BASE_URL: this.env.APP_BASE_URL,
          JIVO_WIDGET_ID: this.env.JIVO_WIDGET_ID
        }
      });
    }

    this.observeExit();
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);

    const port = container.getTcpPort(PORT);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const response = await port.fetch('http://container/health', {
          signal: AbortSignal.timeout(1000)
        });
        await response.body?.cancel();
        if (response.ok) return;
      } catch {
        // The container may still be starting. Retry the readiness probe.
      }
      await scheduler.wait(200);
    }

    throw new Error(`TCUB container did not become ready on port ${PORT}`);
  }

  observeExit() {
    if (this.monitoring) return;
    this.monitoring = this.ctx.container
      .monitor()
      .then(() => console.log('TCUB container exited successfully'))
      .catch((error) => console.error('TCUB container failed:', error))
      .finally(() => {
        this.monitoring = undefined;
      });
    this.ctx.waitUntil(this.monitoring);
  }
}

export default {
  async fetch(request, env) {
    return env.TCUB_CONTAINER.getByName('tcub-production').fetch(request);
  }
};
