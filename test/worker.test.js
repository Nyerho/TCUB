import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMockRequest, state } from '../src/mock-worker.js';

test('health endpoint identifies mock Worker mode', async () => {
  const response = await handleMockRequest(new Request('https://tcub.test/health'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json().then(({ status, mode }) => ({ status, mode })), { status: 'ok', mode: 'mock' });
});

test('loan calculation matches the server contract', async () => {
  const response = await handleMockRequest(new Request('https://tcub.test/api/loans/calculate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ principal: 12000, rate: 6, term: 12 }),
  }));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.emi, '1032.80');
  assert.equal(result.schedule.length, 12);
});

test('authenticated dashboard uses mock data', async () => {
  const response = await handleMockRequest(new Request('https://tcub.test/api/user/dashboard-stats', {
    headers: { 'x-mock-user-id': '1' },
  }));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.accountCount, 1);
  assert.equal(result.totalBalance, 1250.5);
});

test('protected routes reject unknown mock users', async () => {
  const response = await handleMockRequest(new Request('https://tcub.test/api/user/accounts-summary', {
    headers: { 'x-mock-user-id': '999' },
  }));
  assert.equal(response.status, 401);
});

test('notification read-all mutates only local mock state', async () => {
  const response = await handleMockRequest(new Request('https://tcub.test/api/user/notifications/read-all', {
    method: 'POST',
    headers: { 'x-mock-user-id': '1' },
  }));
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(state.notifications.find((item) => item.id === 501).is_read, 1);
  state.notifications.find((item) => item.id === 501).is_read = 0;
});

test('unknown routes return a Worker JSON 404', async () => {
  const response = await handleMockRequest(new Request('https://tcub.test/not-found'));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).mode, 'mock');
});
