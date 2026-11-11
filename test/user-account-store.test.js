'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, verify: verifySignature } = require('node:crypto');
const firestore = require('../services/firestore-rest');
const store = require('../services/user-account-store');

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' }
});

function env(projectId) {
  return {
    FIREBASE_PROJECT_ID: projectId,
    FIREBASE_CLIENT_EMAIL: 'worker-test@example.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: privateKey
  };
}

function response(status, body) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function document(projectId, collection, id, fields, updateTime = '2026-01-01T00:00:00Z') {
  return {
    name: `projects/${projectId}/databases/(default)/documents/${collection}/${id}`,
    fields: firestore.encodeFields(fields),
    updateTime
  };
}

function installTokenStub(projectId, firestoreHandler) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    calls.push({ url, options });
    if (url.hostname === 'oauth2.googleapis.com') return response(200, { access_token: `token-${projectId}`, expires_in: 3600 });
    return firestoreHandler({ url, options, calls });
  };
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

test('migrated account and profile routers load without the SQLite database module', () => {
  assert.doesNotThrow(() => require('../routes/accounts'));
  assert.doesNotThrow(() => require('../routes/user-profile'));
});

test('Firestore client encodes typed values and queries a legacy user document', async (t) => {
  const projectId = 'test-user-query';
  const testEnv = env(projectId);
  const mock = installTokenStub(projectId, async ({ url, options }) => {
    assert.equal(url.pathname.endsWith('/documents:runQuery'), true);
    const body = JSON.parse(options.body);
    assert.equal(body.structuredQuery.from[0].collectionId, 'users');
    assert.deepEqual(body.structuredQuery.where.fieldFilter, {
      field: { fieldPath: 'sql_id' },
      op: 'EQUAL',
      value: { integerValue: '17' }
    });
    return response(200, [{ document: document(projectId, 'users', '17', { sql_id: 17, email: 'person@example.com' }) }]);
  });
  t.after(mock.restore);

  const users = await firestore.queryDocuments('users', {
    filters: [{ field: 'sql_id', value: 17 }],
    limit: 1,
    env: testEnv
  });
  assert.equal(users.length, 1);
  assert.equal(users[0].id, 17);
  assert.equal(users[0].__docId, '17');
  assert.equal(users[0].email, 'person@example.com');
});

test('Firebase Auth admin updates resolve the UID by email using the Identity Toolkit OAuth scope', async (t) => {
  const projectId = 'test-auth-admin-update';
  const testEnv = env(projectId);
  let requestedScope = null;
  let updatePayload = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.hostname === 'oauth2.googleapis.com') {
      const assertion = new URLSearchParams(options.body).get('assertion');
      requestedScope = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString()).scope;
      return response(200, { access_token: `token-${projectId}`, expires_in: 3600 });
    }
    if (url.pathname.endsWith('/accounts:lookup')) {
      return response(200, { users: [{ localId: 'auth-uid-123', email: 'person@example.com' }] });
    }
    if (url.pathname.endsWith('/accounts:update')) {
      updatePayload = JSON.parse(options.body);
      return response(200, { localId: 'auth-uid-123' });
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await firestore.updateFirebaseAuthUserByEmail('Person@Example.com', { password: 'updated-secret' }, { env: testEnv });
  assert.deepEqual(result, { updated: true, localId: 'auth-uid-123' });
  assert.equal(requestedScope, 'https://www.googleapis.com/auth/identitytoolkit');
  assert.deepEqual(updatePayload, { localId: 'auth-uid-123', password: 'updated-secret' });
});

test('service-account OAuth uses a valid RS256 assertion with the configured audience and scope', async (t) => {
  const projectId = 'test-oauth-jwt-signature';
  const testEnv = env(projectId);
  const scope = 'https://www.googleapis.com/auth/datastore';
  const originalFetch = globalThis.fetch;
  let verifiedClaims;
  globalThis.fetch = async (input, options = {}) => {
    assert.equal(new URL(String(input)).hostname, 'oauth2.googleapis.com');
    const assertion = new URLSearchParams(options.body).get('assertion');
    const [headerPart, claimsPart, signaturePart] = assertion.split('.');
    const signingInput = Buffer.from(`${headerPart}.${claimsPart}`);
    const signature = Buffer.from(signaturePart, 'base64url');
    assert.equal(verifySignature('RSA-SHA256', signingInput, publicKey, signature), true);
    verifiedClaims = JSON.parse(Buffer.from(claimsPart, 'base64url').toString());
    return response(200, { access_token: 'signed-test-token', expires_in: 3600 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  assert.equal(await firestore.getAccessToken(testEnv, scope), 'signed-test-token');
  assert.equal(verifiedClaims.iss, testEnv.FIREBASE_CLIENT_EMAIL);
  assert.equal(verifiedClaims.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(verifiedClaims.scope, scope);
  assert.equal(verifiedClaims.exp - verifiedClaims.iat, 3600);
});

test('account creation atomically allocates a legacy numeric ID and reserves its account number', async (t) => {
  const projectId = 'test-account-create';
  const testEnv = env(projectId);
  let commitBody;
  const mock = installTokenStub(projectId, async ({ url, options }) => {
    if (url.pathname.endsWith('/documents:beginTransaction')) return response(200, { transaction: 'transaction-account-create' });
    if (url.pathname.endsWith('/documents:commit')) {
      commitBody = JSON.parse(options.body);
      return response(200, { writeResults: [{ updateTime: '2026-01-01T00:00:01Z' }] });
    }
    if (url.pathname.endsWith('/documents:runQuery')) return response(200, []);
    if (url.pathname.endsWith('/documents/users/5')) {
      return response(200, document(projectId, 'users', '5', { sql_id: 5, first_name: 'Ari', last_name: 'Example' }));
    }
    if (url.pathname.endsWith('/documents/_system/account_id_counter')) {
      return response(404, { error: { message: 'Document not found.' } });
    }
    throw new Error(`Unexpected request ${options.method || 'GET'} ${url.pathname}`);
  });
  t.after(mock.restore);

  const account = await store.createAccountForUser(5, 'Everyday Savings', 25, testEnv);
  assert.equal(account.id, 1);
  assert.equal(account.user_id, 5);
  assert.equal(account.balance, 25);
  assert.equal(account.account_name, 'Ari Example');
  assert.match(account.account_number, /^200\d{8}$/);
  assert.equal(commitBody.transaction, 'transaction-account-create');
  assert.equal(commitBody.writes.length, 3);
  assert.equal(commitBody.writes[0].update.name.endsWith('/_system/account_id_counter'), true);
  assert.equal(commitBody.writes[1].update.name.endsWith('/accounts/1'), true);
  assert.equal(commitBody.writes[2].update.name.endsWith(`/_account_number_index/${account.account_number}`), true);
  assert.deepEqual(commitBody.writes.map((write) => write.currentDocument), [{ exists: false }, { exists: false }, { exists: false }]);
});

test('profile email changes update Firestore and atomically reserve the normalized email', async (t) => {
  const projectId = 'test-profile-email-reservation';
  const testEnv = env(projectId);
  let commitBody;
  const mock = installTokenStub(projectId, async ({ url, options }) => {
    if (url.pathname.endsWith('/documents:beginTransaction')) return response(200, { transaction: 'transaction-email-change' });
    if (url.pathname.endsWith('/documents/users/5')) return response(200, document(projectId, 'users', '5', { sql_id: 5, email: 'old@example.com' }));
    if (url.pathname.endsWith('/documents:runQuery')) return response(200, []);
    if (url.pathname.includes('/documents/_user_email_index/')) return response(404, { error: { message: 'Document not found.' } });
    if (url.pathname.endsWith('/documents:commit')) {
      commitBody = JSON.parse(options.body);
      return response(200, { writeResults: [{ updateTime: '2026-01-01T00:00:01Z' }] });
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  t.after(mock.restore);

  const updated = await store.updateUser(5, { email: 'new@example.com', updated_at: '2026-01-01T00:00:00.000Z' }, { env: testEnv });
  assert.equal(updated.email, 'new@example.com');
  assert.equal(commitBody.transaction, 'transaction-email-change');
  assert.equal(commitBody.writes.length, 2);
  assert.equal(commitBody.writes[0].update.name.endsWith('/users/5'), true);
  assert.equal(commitBody.writes[0].update.fields.email.stringValue, 'new@example.com');
  assert.equal(commitBody.writes[1].update.name.includes('/_user_email_index/'), true);
  assert.equal(commitBody.writes[1].update.fields.email.stringValue, 'new@example.com');
  assert.equal(commitBody.writes[1].currentDocument.exists, false);
});

test('profile email changes reject an existing email reservation and roll back the transaction', async (t) => {
  const projectId = 'test-profile-email-conflict';
  const testEnv = env(projectId);
  let commits = 0;
  let rollbacks = 0;
  const mock = installTokenStub(projectId, async ({ url }) => {
    if (url.pathname.endsWith('/documents:beginTransaction')) return response(200, { transaction: 'transaction-email-conflict' });
    if (url.pathname.endsWith('/documents/users/5')) return response(200, document(projectId, 'users', '5', { sql_id: 5, email: 'old@example.com' }));
    if (url.pathname.endsWith('/documents:runQuery')) return response(200, []);
    if (url.pathname.includes('/documents/_user_email_index/')) {
      return response(200, document(projectId, '_user_email_index', 'existing', { email: 'new@example.com', user_id: 9 }));
    }
    if (url.pathname.endsWith('/documents:rollback')) {
      rollbacks += 1;
      return response(200, {});
    }
    if (url.pathname.endsWith('/documents:commit')) {
      commits += 1;
      return response(200, {});
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  t.after(mock.restore);

  await assert.rejects(
    store.updateUser(5, { email: 'new@example.com' }, { env: testEnv }),
    (error) => error.code === 'EMAIL_ALREADY_IN_USE'
  );
  assert.equal(commits, 0);
  assert.equal(rollbacks, 1);
});

test('account closure rechecks ownership and balance inside a Firestore transaction', async (t) => {
  const projectId = 'test-account-close';
  const testEnv = env(projectId);
  let commitBody;
  const mock = installTokenStub(projectId, async ({ url, options }) => {
    if (url.pathname.endsWith('/documents:beginTransaction')) return response(200, { transaction: 'transaction-account-close' });
    if (url.pathname.endsWith('/documents:commit')) {
      commitBody = JSON.parse(options.body);
      return response(200, { writeResults: [{}] });
    }
    if (url.pathname.endsWith('/documents/accounts/7')) {
      assert.equal(url.searchParams.get('transaction'), 'transaction-account-close');
      return response(200, document(projectId, 'accounts', '7', { sql_id: 7, user_id: 5, user_ref: '5', balance: 0, status: 'active' }));
    }
    throw new Error(`Unexpected request ${options.method || 'GET'} ${url.pathname}`);
  });
  t.after(mock.restore);

  const result = await store.closeAccountForUser(7, 5, testEnv);
  assert.equal(result.status, 'closed');
  assert.equal(commitBody.transaction, 'transaction-account-close');
  assert.equal(commitBody.writes.length, 1);
  assert.equal(commitBody.writes[0].update.name.endsWith('/accounts/7'), true);
  assert.equal(commitBody.writes[0].update.fields.status.stringValue, 'closed');
});

test('account closure refuses a non-owner and does not write', async (t) => {
  const projectId = 'test-account-owner-check';
  const testEnv = env(projectId);
  let commits = 0;
  const mock = installTokenStub(projectId, async ({ url }) => {
    if (url.pathname.endsWith('/documents:beginTransaction')) return response(200, { transaction: 'transaction-owner-check' });
    if (url.pathname.endsWith('/documents/accounts/7')) {
      return response(200, document(projectId, 'accounts', '7', { sql_id: 7, user_id: 6, user_ref: '6', balance: 0, status: 'active' }));
    }
    if (url.pathname.endsWith('/documents:commit')) {
      commits += 1;
      return response(200, { writeResults: [] });
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  t.after(mock.restore);

  const result = await store.closeAccountForUser(7, 5, testEnv);
  assert.equal(result.status, 'not_found');
  assert.equal(commits, 0);
});

test('account closure rolls back instead of committing when the balance is positive', async (t) => {
  const projectId = 'test-account-positive-balance';
  const testEnv = env(projectId);
  let rollbacks = 0;
  const mock = installTokenStub(projectId, async ({ url, options }) => {
    if (url.pathname.endsWith('/documents:beginTransaction')) return response(200, { transaction: 'transaction-positive-balance' });
    if (url.pathname.endsWith('/documents/accounts/9')) {
      return response(200, document(projectId, 'accounts', '9', { sql_id: 9, user_id: 5, balance: 0.01, status: 'active' }));
    }
    if (url.pathname.endsWith('/documents:rollback')) {
      rollbacks += 1;
      assert.deepEqual(JSON.parse(options.body), { transaction: 'transaction-positive-balance' });
      return response(200, {});
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  t.after(mock.restore);

  const result = await store.closeAccountForUser(9, 5, testEnv);
  assert.equal(result.status, 'positive_balance');
  assert.equal(rollbacks, 1);
});
