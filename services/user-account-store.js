'use strict';

const firestore = require('./firestore-rest');

const USERS = process.env.FIRESTORE_USERS_COLLECTION || 'users';
const ACCOUNTS = process.env.FIRESTORE_ACCOUNTS_COLLECTION || 'accounts';
const TRANSACTIONS = process.env.FIRESTORE_TRANSACTIONS_COLLECTION || 'transactions';
const SYSTEM = '_system';
const USER_EMAIL_INDEX = '_user_email_index';

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asUser(user, docId) {
  if (!user) return null;
  return { ...user, id: user.sql_id || user.id || docId };
}

function asAccount(account, docId) {
  if (!account) return null;
  return { ...account, id: account.sql_id || account.id || docId };
}

async function getUserById(userId, options = {}) {
  const direct = await firestore.getDocument(USERS, String(userId), options);
  if (direct) return asUser(direct, String(userId));
  const legacyId = asNumber(userId, null);
  if (legacyId === null) return null;
  const matches = await firestore.queryDocuments(USERS, {
    filters: [{ field: 'sql_id', value: legacyId }],
    limit: 1,
    transaction: options.transaction,
    env: options.env
  });
  return matches.length ? asUser(matches[0], matches[0].__docId) : null;
}

async function updateUser(userId, values, options = {}) {
  const current = await getUserById(userId, options);
  if (!current) return null;
  if (values.email && String(current.email || '').trim().toLowerCase() !== String(values.email).trim().toLowerCase()) {
    return updateUserEmailWithReservation(userId, values, options);
  }
  const docId = current.__docId || String(userId);
  const fields = { ...values };
  if (fields.updated_at && !fields.updated_at_ts) fields.updated_at_ts = new Date(fields.updated_at);
  if (fields.transfer_pin_updated_at && !fields.transfer_pin_updated_at_ts) {
    fields.transfer_pin_updated_at_ts = new Date(fields.transfer_pin_updated_at);
  }
  const updated = await firestore.patchDocument(USERS, docId, fields, {
    updateTime: options.transaction ? undefined : current.__updateTime,
    transaction: options.transaction,
    env: options.env
  });
  return asUser(updated, docId);
}

async function findUsersByEmail(email, options = {}) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return [];
  const results = await firestore.queryDocuments(USERS, {
    filters: [{ field: 'email', value: normalized }],
    limit: 20,
    transaction: options.transaction,
    env: options.env
  });
  return results.map((user) => asUser(user, user.__docId));
}

async function emailIndexId(email) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(email).trim().toLowerCase()));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function duplicateEmailError() {
  const error = new Error('This email is already in use.');
  error.code = 'EMAIL_ALREADY_IN_USE';
  return error;
}

async function updateUserEmailWithReservation(userId, values, options = {}) {
  const env = options.env;
  const email = String(values.email).trim().toLowerCase();
  const newIndexId = await emailIndexId(email);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const transaction = await firestore.beginTransaction({ env });
    try {
      const current = await getUserById(userId, { transaction, env });
      if (!current) {
        await rollbackQuietly(transaction, env);
        return null;
      }
      const docId = current.__docId || String(userId);
      const existingUsers = await findUsersByEmail(email, { transaction, env });
      if (existingUsers.some((user) => String(user.id) !== String(userId))) {
        throw duplicateEmailError();
      }

      const newIndex = await firestore.getDocument(USER_EMAIL_INDEX, newIndexId, { transaction, env });
      if (newIndex && String(newIndex.user_id || newIndex.user_ref) !== String(userId)) {
        throw duplicateEmailError();
      }

      const oldEmail = String(current.email || '').trim().toLowerCase();
      const oldIndexId = oldEmail ? await emailIndexId(oldEmail) : null;
      const oldIndex = oldIndexId && oldIndexId !== newIndexId
        ? await firestore.getDocument(USER_EMAIL_INDEX, oldIndexId, { transaction, env })
        : null;
      const fields = { ...values };
      if (fields.updated_at && !fields.updated_at_ts) fields.updated_at_ts = new Date(fields.updated_at);
      const userIdValue = asNumber(current.sql_id || current.id || userId, String(userId));
      const indexFields = { email, user_id: userIdValue, user_ref: String(userId) };
      const writes = [
        firestore.updateWrite(USERS, docId, fields, { updateTime: current.__updateTime, env }),
        firestore.updateWrite(USER_EMAIL_INDEX, newIndexId, indexFields, {
          ...(newIndex ? {} : { mustNotExist: true }),
          env
        })
      ];
      if (oldIndex && String(oldIndex.user_id || oldIndex.user_ref) === String(userId)) {
        writes.push(firestore.deleteWrite(USER_EMAIL_INDEX, oldIndexId, { updateTime: oldIndex.__updateTime, env }));
      }
      await firestore.commit(writes, { transaction, env });
      return asUser({ ...current, ...fields, __docId: docId }, docId);
    } catch (error) {
      await rollbackQuietly(transaction, env);
      if (error.code === 'EMAIL_ALREADY_IN_USE') throw error;
      if (!shouldRetryAllocation(error) || attempt === 3) throw error;
    }
  }
  throw new Error('Could not reserve a unique email address.');
}

async function listAccountsForUser(userId, options = {}) {
  const numericUserId = asNumber(userId, null);
  const [numericMatches, stringMatches] = await Promise.all([
    numericUserId === null ? Promise.resolve([]) : firestore.queryDocuments(ACCOUNTS, {
      filters: [{ field: 'user_id', value: numericUserId }],
      env: options.env
    }),
    firestore.queryDocuments(ACCOUNTS, {
      filters: [{ field: 'user_ref', value: String(userId) }],
      env: options.env
    })
  ]);
  const byId = new Map();
  for (const account of [...numericMatches, ...stringMatches]) {
    byId.set(account.__docId, asAccount(account, account.__docId));
  }
  let accounts = [...byId.values()].sort((left, right) => asNumber(left.sql_id || left.id) - asNumber(right.sql_id || right.id));
  if (options.operableOnly) accounts = accounts.filter((account) => String(account.status || 'active').toLowerCase() === 'active');
  return accounts;
}

async function getAccountById(accountId, options = {}) {
  const direct = await firestore.getDocument(ACCOUNTS, String(accountId), options);
  if (direct) return asAccount(direct, String(accountId));
  const numericId = asNumber(accountId, null);
  if (numericId === null) return null;
  const matches = await firestore.queryDocuments(ACCOUNTS, {
    filters: [{ field: 'sql_id', value: numericId }],
    limit: 1,
    transaction: options.transaction,
    env: options.env
  });
  return matches.length ? asAccount(matches[0], matches[0].__docId) : null;
}

async function listTransactionsForAccount(account, limit = 500, options = {}) {
  if (!account) return [];
  const numericAccountId = asNumber(account.sql_id || account.id, null);
  const accountRef = String(account.sql_id || account.id || account.__docId);
  const [numericMatches, stringMatches] = await Promise.all([
    numericAccountId === null ? Promise.resolve([]) : firestore.queryDocuments(TRANSACTIONS, {
      filters: [{ field: 'account_id', value: numericAccountId }],
      orderBy: [{ field: 'created_at', direction: 'DESCENDING' }],
      limit,
      env: options.env
    }),
    firestore.queryDocuments(TRANSACTIONS, {
      filters: [{ field: 'account_ref', value: accountRef }],
      orderBy: [{ field: 'created_at', direction: 'DESCENDING' }],
      limit,
      env: options.env
    })
  ]);
  const byId = new Map();
  for (const transaction of [...numericMatches, ...stringMatches]) byId.set(transaction.__docId, transaction);
  return [...byId.values()]
    .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')))
    .slice(0, limit);
}

function randomDigits(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => String(byte % 10)).join('');
}

function shouldRetryAllocation(error) {
  return error && (
    error.status === 409 ||
    error.status === 412 ||
    error.code === 'ABORTED' ||
    error.code === 'ALREADY_EXISTS' ||
    error.code === 'FAILED_PRECONDITION'
  );
}

async function rollbackQuietly(transaction, env) {
  try {
    await firestore.rollbackTransaction(transaction, { env });
  } catch (error) {
    // Firestore may already have expired or aborted a transaction after a conflict.
  }
}

async function createAccountForUser(userId, accountType, initialDeposit, env) {
  const user = await getUserById(userId, { env });
  if (!user) throw new Error('User profile is missing from Firestore.');
  const amount = Number(initialDeposit || 0);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Initial deposit must be a finite, non-negative amount.');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const transaction = await firestore.beginTransaction({ env });
    try {
      let counter = await firestore.getDocument(SYSTEM, 'account_id_counter', { transaction, env });
      let nextId;
      let counterWrite;
      if (counter) {
        nextId = asNumber(counter.value) + 1;
        counterWrite = firestore.updateWrite(SYSTEM, 'account_id_counter', { value: nextId }, { env });
      } else {
        const existing = await firestore.queryDocuments(ACCOUNTS, { transaction, env });
        const maxId = existing.reduce((max, account) => Math.max(max, asNumber(account.sql_id || account.__docId)), 0);
        nextId = maxId + 1;
        counterWrite = firestore.updateWrite(SYSTEM, 'account_id_counter', { value: nextId }, { mustNotExist: true, env });
      }

      const accountNumber = `200${randomDigits(8)}`;
      const existingNumber = await firestore.queryDocuments(ACCOUNTS, {
        filters: [{ field: 'account_number', value: accountNumber }],
        limit: 1,
        transaction,
        env
      });
      if (existingNumber.length) {
        await rollbackQuietly(transaction, env);
        continue;
      }
      const now = new Date();
      const openedDate = now.toISOString();
      const account = {
        sql_id: nextId,
        user_id: asNumber(userId, String(userId)),
        user_ref: String(userId),
        account_number: accountNumber,
        account_type: accountType,
        account_name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
        currency: 'USD',
        balance: amount,
        available_balance: amount,
        interest_rate: 0,
        status: 'active',
        branch: 'Atlanta CBD',
        bsb: '021000021',
        opened_date: openedDate,
        opened_date_ts: now,
        updated_at: openedDate,
        updated_at_ts: now
      };
      const writes = [
        counterWrite,
        firestore.updateWrite(ACCOUNTS, String(nextId), account, { mustNotExist: true, env }),
        firestore.updateWrite('_account_number_index', accountNumber, { account_id: nextId }, { mustNotExist: true, env })
      ];
      await firestore.commit(writes, { transaction, env });
      return { ...account, id: nextId, __docId: String(nextId) };
    } catch (error) {
      await rollbackQuietly(transaction, env);
      if (!shouldRetryAllocation(error) || attempt === 4) throw error;
    }
  }
  throw new Error('Could not allocate a unique account ID.');
}

async function closeAccountForUser(accountId, userId, env) {
  const transaction = await firestore.beginTransaction({ env });
  try {
    const account = await getAccountById(accountId, { transaction, env });
    if (!account) {
      await rollbackQuietly(transaction, env);
      return { status: 'not_found' };
    }
    if (String(account.user_id || account.user_ref) !== String(userId)) {
      await rollbackQuietly(transaction, env);
      return { status: 'not_found' };
    }
    const currentStatus = String(account.status || 'active').toLowerCase();
    if (['frozen', 'blocked', 'closed'].includes(currentStatus)) {
      await rollbackQuietly(transaction, env);
      return { status: currentStatus };
    }
    if (asNumber(account.balance) > 0) {
      await rollbackQuietly(transaction, env);
      return { status: 'positive_balance' };
    }

    const docId = account.__docId || String(accountId);
    const now = new Date();
    await firestore.commit([
      firestore.updateWrite(ACCOUNTS, docId, { status: 'closed', updated_at: now.toISOString(), updated_at_ts: now }, { env })
    ], { transaction, env });
    return { status: 'closed', account: { ...account, status: 'closed' } };
  } catch (error) {
    await rollbackQuietly(transaction, env);
    throw error;
  }
}

module.exports = {
  createAccountForUser,
  findUsersByEmail,
  getAccountById,
  getUserById,
  listAccountsForUser,
  listTransactionsForAccount,
  updateUser,
  closeAccountForUser
};
