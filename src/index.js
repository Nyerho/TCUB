import { DurableObject } from 'cloudflare:workers';
import { createServer } from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import { initializeDatabase, runWithDatabase } from '../database.js';

const PORT = 8787;
let appPromise;
let nodeServer;
let nodeHandler;

function applyWorkerEnv(env) {
  const keys = [
    'NODE_ENV', 'SESSION_SECRET', 'SUPPORT_EMAIL', 'APP_BASE_URL', 'JIVO_WIDGET_ID',
    'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'ADMIN_FIRST_NAME', 'ADMIN_LAST_NAME', 'ADMIN_ROLE',
    'ADMIN_PHONE', 'BREVO_API_KEY', 'EMAIL_FROM', 'EMAIL_REPLY_TO', 'FIREBASE_PROJECT_ID',
    'FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_APP_ID', 'FIREBASE_MEASUREMENT_ID',
  ];
  for (const key of keys) {
    if (env[key] !== undefined) process.env[key] = String(env[key]);
  }
  process.env.CLOUDFLARE_WORKER = 'true';
}

async function getNodeServer(env) {
  applyWorkerEnv(env);
  if (!appPromise) {
    appPromise = import('../server.js').then((module) => module.default || module);
  }
  const app = await appPromise;
  if (!nodeServer) {
    nodeServer = createServer(app);
    nodeHandler = httpServerHandler(nodeServer);
  }
  return nodeServer;
}

function isStaticAsset(request) {
  const pathname = new URL(request.url).pathname;
  return pathname.startsWith('/css/') || pathname.startsWith('/js/') || pathname.startsWith('/images/') || pathname.startsWith('/uploads/') || pathname === '/favicon.ico' || /\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff2?)$/i.test(pathname);
}

export class TCUBApp extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.initialized = false;
  }

  async fetch(request) {
    console.log(`[worker] DO fetch ${request.method} ${new URL(request.url).pathname}`);
    if (!this.initialized) {
      applyWorkerEnv(this.env);
      initializeDatabase(this.ctx.storage.sql, this.env);
      this.initialized = true;
    }
    await getNodeServer(this.env);
    console.log('[worker] dispatching to node server');
    const response = await runWithDatabase(this.ctx.storage.sql, () => nodeHandler.fetch(request));
    console.log('[worker] node server response ready');
    return response;
  }
}

export default {
  async fetch(request, env) {
    if (isStaticAsset(request) && env.ASSETS) return env.ASSETS.fetch(request);
    const id = env.TCUB_APP.idFromName('tcub-production');
    return env.TCUB_APP.get(id).fetch(request);
  },
};
