'use strict';

const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
const FIREBASE_AUTH_SCOPE = 'https://www.googleapis.com/auth/identitytoolkit';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKEN_CACHE = new Map();

function toBase64Url(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function normalizePrivateKey(value) {
  return String(value || '')
    .trim()
    .replace(/^(["'])([\s\S]*)\1$/, '$2')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n');
}

function credentialsFromEnv(env = process.env) {
  let jsonCredentials = null;
  const rawJson = env.FIREBASE_SERVICE_ACCOUNT_JSON || env.GOOGLE_CLOUD_CREDENTIALS;
  if (rawJson) {
    try {
      jsonCredentials = JSON.parse(rawJson);
    } catch (error) {
      throw new Error(`Invalid service-account JSON in environment: ${error.message}`);
    }
  }

  const projectId = env.FIREBASE_PROJECT_ID || (jsonCredentials && jsonCredentials.project_id);
  const clientEmail = env.FIREBASE_CLIENT_EMAIL || (jsonCredentials && jsonCredentials.client_email);
  const privateKey = normalizePrivateKey(env.FIREBASE_PRIVATE_KEY || (jsonCredentials && jsonCredentials.private_key));
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Firestore requires FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY (or FIREBASE_SERVICE_ACCOUNT_JSON).');
  }
  return { projectId, clientEmail, privateKey };
}

function pemToDer(pem) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  if (!body) throw new Error('FIREBASE_PRIVATE_KEY is not a PKCS#8 private key.');
  const binary = atob(body);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function createAccessToken(credentials, scope = FIRESTORE_SCOPE, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = toBase64Url(JSON.stringify({
    iss: credentials.clientEmail,
    scope,
    aud: OAUTH_TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600
  }));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(credentials.privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${toBase64Url(new Uint8Array(signature))}`;
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(`Google OAuth token request failed (${response.status}): ${body.error_description || body.error || 'no access token returned'}`);
  }
  return { token: body.access_token, expiresAt: Date.now() + Math.max(60, Number(body.expires_in || 3600) - 60) * 1000 };
}

async function getAccessToken(env = process.env, scope = FIRESTORE_SCOPE) {
  const credentials = credentialsFromEnv(env);
  const cacheKey = `${credentials.projectId}:${credentials.clientEmail}:${scope}`;
  const cached = TOKEN_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 5000) return cached.token;
  if (cached && cached.pending) return cached.pending;

  const pending = createAccessToken(credentials, scope).then((result) => {
    TOKEN_CACHE.set(cacheKey, result);
    return result.token;
  }).catch((error) => {
    TOKEN_CACHE.delete(cacheKey);
    throw error;
  });
  TOKEN_CACHE.set(cacheKey, { pending, expiresAt: 0 });
  return pending;
}

function encodeValue(value) {
  if (value === null || typeof value === 'undefined') return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === 'object') return { mapValue: { fields: encodeFields(value) } };
  throw new TypeError(`Unsupported Firestore value type: ${typeof value}`);
}

function encodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encodeValue(value)]));
}

function decodeValue(value) {
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('referenceValue' in value) return value.referenceValue;
  if ('bytesValue' in value) return value.bytesValue;
  if ('geoPointValue' in value) return value.geoPointValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
  return null;
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}

function documentPath(projectId, collection, documentId) {
  const segments = [collection, documentId].map((part) => encodeURIComponent(String(part)));
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${segments.join('/')}`;
}

function documentName(projectId, collection, documentId) {
  return `projects/${projectId}/databases/(default)/documents/${collection}/${documentId}`;
}

function normalizeDocument(document) {
  if (!document || !document.name) return null;
  const docId = decodeURIComponent(document.name.split('/').pop());
  const data = decodeFields(document.fields || {});
  return {
    ...data,
    id: data.id || data.sql_id || docId,
    __docId: docId,
    __updateTime: document.updateTime || null,
    __createTime: document.createTime || null
  };
}

async function request(path, options = {}, env = process.env, scope = FIRESTORE_SCOPE) {
  const token = await getAccessToken(env, scope);
  const response = await fetch(path, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = { error: { message: text } }; }
  }
  if (!response.ok) {
    const message = body && body.error && body.error.message ? body.error.message : `HTTP ${response.status}`;
    const error = new Error(`Firestore REST ${response.status}: ${message}`);
    error.status = response.status;
    error.code = body && body.error && body.error.status;
    throw error;
  }
  return body;
}

function structuredQuery(collection, options = {}) {
  const query = { from: [{ collectionId: collection }] };
  const filters = options.filters || [];
  if (filters.length === 1) {
    const filter = filters[0];
    query.where = { fieldFilter: {
      field: { fieldPath: filter.field },
      op: filter.op || 'EQUAL',
      value: encodeValue(filter.value)
    } };
  } else if (filters.length > 1) {
    query.where = { compositeFilter: {
      op: 'AND',
      filters: filters.map((filter) => ({ fieldFilter: {
        field: { fieldPath: filter.field },
        op: filter.op || 'EQUAL',
        value: encodeValue(filter.value)
      } }))
    } };
  }
  if (options.orderBy && options.orderBy.length) {
    query.orderBy = options.orderBy.map((entry) => ({
      field: { fieldPath: entry.field },
      direction: entry.direction || 'ASCENDING'
    }));
  }
  if (Number.isInteger(options.limit) && options.limit > 0) query.limit = options.limit;
  return query;
}

async function getDocument(collection, id, options = {}) {
  const { projectId } = credentialsFromEnv(options.env || process.env);
  const url = new URL(documentPath(projectId, collection, id));
  if (options.transaction) url.searchParams.set('transaction', options.transaction);
  try {
    const document = await request(url.toString(), {}, options.env || process.env);
    return normalizeDocument(document);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function queryDocuments(collection, options = {}) {
  const { projectId } = credentialsFromEnv(options.env || process.env);
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:runQuery`;
  const body = { structuredQuery: structuredQuery(collection, options) };
  if (options.transaction) body.transaction = options.transaction;
  const rows = await request(url, { method: 'POST', body: JSON.stringify(body) }, options.env || process.env);
  return (rows || []).filter((row) => row.document).map((row) => normalizeDocument(row.document));
}

async function commit(writes, options = {}) {
  const { projectId } = credentialsFromEnv(options.env || process.env);
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:commit`;
  return request(url, {
    method: 'POST',
    body: JSON.stringify({ writes, ...(options.transaction ? { transaction: options.transaction } : {}) })
  }, options.env || process.env);
}

function updateWrite(collection, id, values, options = {}) {
  const { projectId } = credentialsFromEnv(options.env || process.env);
  const write = {
    update: {
      name: documentName(projectId, collection, id),
      fields: encodeFields(values)
    },
    updateMask: { fieldPaths: Object.keys(values) }
  };
  if (options.updateTime) write.currentDocument = { updateTime: options.updateTime };
  if (options.mustNotExist) write.currentDocument = { exists: false };
  return write;
}

function deleteWrite(collection, id, options = {}) {
  const { projectId } = credentialsFromEnv(options.env || process.env);
  const write = { delete: documentName(projectId, collection, id) };
  if (options.updateTime) write.currentDocument = { updateTime: options.updateTime };
  return write;
}

async function patchDocument(collection, id, values, options = {}) {
  const result = await commit([updateWrite(collection, id, values, options)], options);
  const updateTime = result.writeResults && result.writeResults[0] && result.writeResults[0].updateTime;
  const doc = await getDocument(collection, id, options);
  if (doc && updateTime) doc.__updateTime = updateTime;
  return doc;
}

async function createDocument(collection, id, values, options = {}) {
  await commit([updateWrite(collection, id, values, { ...options, mustNotExist: true })], options);
  return getDocument(collection, id, options);
}

async function beginTransaction(options = {}) {
  const { projectId } = credentialsFromEnv(options.env || process.env);
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:beginTransaction`;
  const result = await request(url, {
    method: 'POST',
    body: JSON.stringify({ options: { readWrite: {} } })
  }, options.env || process.env);
  if (!result.transaction) throw new Error('Firestore did not return a transaction token.');
  return result.transaction;
}

async function rollbackTransaction(transaction, options = {}) {
  if (!transaction) return;
  const { projectId } = credentialsFromEnv(options.env || process.env);
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:rollback`;
  await request(url, {
    method: 'POST',
    body: JSON.stringify({ transaction })
  }, options.env || process.env);
}

async function updateFirebaseAuthUserByEmail(email, values, options = {}) {
  const env = options.env || process.env;
  const { projectId } = credentialsFromEnv(env);
  const lookupUrl = `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:lookup`;
  const normalizedEmail = String(email || '').trim().toLowerCase();
  let lookup;
  try {
    lookup = await request(lookupUrl, {
      method: 'POST',
      body: JSON.stringify({ email: [normalizedEmail] })
    }, env, FIREBASE_AUTH_SCOPE);
  } catch (error) {
    if (error.status === 404 || error.code === 'NOT_FOUND' || /USER_NOT_FOUND|EMAIL_NOT_FOUND/.test(error.message)) {
      return { updated: false, skipped: true };
    }
    throw error;
  }
  const authUser = (lookup.users || []).find((user) => String(user.email || '').trim().toLowerCase() === normalizedEmail);
  if (!authUser || !authUser.localId) return { updated: false, skipped: true };

  const updateUrl = `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:update`;
  await request(updateUrl, {
    method: 'POST',
    body: JSON.stringify({ localId: authUser.localId, ...values })
  }, env, FIREBASE_AUTH_SCOPE);
  return { updated: true, localId: authUser.localId };
}

module.exports = {
  beginTransaction,
  commit,
  createDocument,
  decodeFields,
  deleteWrite,
  encodeFields,
  getAccessToken,
  getDocument,
  normalizePrivateKey,
  patchDocument,
  queryDocuments,
  rollbackTransaction,
  updateFirebaseAuthUserByEmail,
  updateWrite
};
