const MOCK_USER_ID = 1;

const state = {
  users: [
    {
      id: MOCK_USER_ID,
      first_name: 'Morgan',
      last_name: 'Demo',
      email: 'morgan@example.test',
      phone: '+1 555 0100',
      is_admin: 0,
      is_verified: 1,
      is_frozen: 0,
      role: 'customer',
    },
  ],
  accounts: [
    {
      id: 101,
      user_id: MOCK_USER_ID,
      account_number: '2001234567',
      account_type: 'Everyday Savings',
      account_name: 'Morgan Demo',
      currency: 'USD',
      balance: 1250.5,
      available_balance: 1200.5,
      status: 'active',
    },
  ],
  transactions: [
    {
      id: 1001,
      user_id: MOCK_USER_ID,
      account_id: 101,
      transaction_type: 'deposit',
      amount: 1250.5,
      currency: 'USD',
      description: 'Opening deposit',
      status: 'completed',
      created_at: '2026-11-10T10:00:00.000Z',
    },
  ],
  notifications: [
    {
      id: 501,
      user_id: MOCK_USER_ID,
      title: 'Welcome to TCUB',
      message: 'Your mock account is ready for local Worker testing.',
      type: 'info',
      is_read: 0,
      created_at: '2026-11-10T10:00:00.000Z',
    },
  ],
  beneficiaries: [
    {
      id: 301,
      user_id: MOCK_USER_ID,
      name: 'Demo Recipient',
      account_number: '987654321',
      bank_name: 'Mock Bank',
      country: 'United States',
    },
  ],
};

const exchangeRates = {
  USD: 0.66,
  GBP: 0.52,
  EUR: 0.6,
  NZD: 1.1,
  JPY: 99.5,
  SGD: 0.88,
  HKD: 5.15,
  CAD: 0.89,
  INR: 54.8,
  CNY: 4.75,
  CHF: 0.59,
  SEK: 6.95,
  KRW: 876.5,
  THB: 23.45,
  MYR: 3.08,
  PHP: 37.25,
  IDR: 10280,
  VND: 16180,
  ZAR: 11.45,
};

const bsbBanks = {
  '082': 'National United States Bank (NAB)',
  '012': 'United States and New Zealand Banking Group (ANZ)',
  '032': 'United States and New Zealand Banking Group (ANZ)',
  '062': 'Commonwealth Bank of United States (a major U.S. credit union)',
  '064': 'Commonwealth Bank of United States (a major U.S. credit union)',
  '067': 'Commonwealth Bank of United States (a major U.S. credit union)',
  '146': 'Westpac Banking Corporation',
  '733': 'Bendigo Bank',
  '633': 'Bendigo Bank',
  '980': 'Bank of Savannah',
  '484': 'Suncorp Bank',
  '802': 'ING Bank United States',
  '412': 'Bank of Queensland (BOQ)',
  '630': 'Heritage Bank',
  '636': 'Great Southern Bank',
};

function json(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function currentUser(request) {
  const requestedId = Number(request.headers.get('x-mock-user-id') || MOCK_USER_ID);
  return state.users.find((user) => user.id === requestedId) || null;
}

function requireMockUser(request) {
  const user = currentUser(request);
  return user ? { user } : json({ error: 'Please login to access this page.' }, { status: 401 });
}

async function readBody(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) return {};
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function calculateLoan(body) {
  const principal = Number.parseFloat(body.principal) || 0;
  const rate = Number.parseFloat(body.rate) || 0;
  const term = Number.parseInt(body.term, 10) || 0;
  if (term <= 0) return { error: 'Term must be greater than zero.' };

  const monthlyRate = rate / 100 / 12;
  const emi = monthlyRate === 0
    ? principal / term
    : (principal * monthlyRate * (1 + monthlyRate) ** term) / ((1 + monthlyRate) ** term - 1);
  const total = emi * term;
  const schedule = Array.from({ length: Math.min(term, 12) }, (_, index) => ({
    month: index + 1,
    payment: emi.toFixed(2),
    principal: (emi - principal * monthlyRate).toFixed(2),
  }));
  return {
    emi: emi.toFixed(2),
    total: total.toFixed(2),
    interest: (total - principal).toFixed(2),
    schedule,
  };
}

export async function handleMockRequest(request) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (request.method === 'GET' && (pathname === '/health' || pathname === '/api/health')) {
    return json({ status: 'ok', mode: 'mock', timestamp: new Date().toISOString(), version: 'worker-mock-1' });
  }

  if (request.method === 'GET' && pathname === '/api/exchange/rates') {
    return json({ base: 'USD', rates: exchangeRates, updated: new Date().toISOString() });
  }

  if (request.method === 'GET' && pathname === '/api/bsb/lookup') {
    const bsb = url.searchParams.get('bsb') || '';
    const prefix = bsb.slice(0, 3);
    return json({ bsb, bank: bsbBanks[prefix] || 'Unknown Bank', valid: /^\d{3}-?\d{3}$/.test(bsb) });
  }

  if (request.method === 'POST' && pathname === '/api/loans/calculate') {
    const result = calculateLoan(await readBody(request));
    return result.error ? json(result, { status: 400 }) : json(result);
  }

  if (pathname.startsWith('/api/user/')) {
    const auth = requireMockUser(request);
    if (auth instanceof Response) return auth;
    const { user } = auth;
    const accounts = state.accounts.filter((account) => account.user_id === user.id);

    if (request.method === 'GET' && pathname === '/api/user/accounts-summary') {
      return json({ accounts: accounts.filter((account) => account.status === 'active') });
    }
    if (request.method === 'GET' && pathname === '/api/user/dashboard-stats') {
      const transactions = state.transactions.filter((transaction) => transaction.user_id === user.id);
      return json({
        totalBalance: accounts.reduce((sum, account) => sum + Number(account.balance), 0),
        totalAvailable: accounts.reduce((sum, account) => sum + Number(account.available_balance), 0),
        accountCount: accounts.length,
        last7Days: transactions.map(({ transaction_type, amount }) => ({ transaction_type, total: amount })),
      });
    }
    if (request.method === 'GET' && pathname === '/api/user/notifications') {
      const notifications = state.notifications.filter((notification) => notification.user_id === user.id).slice(0, 20);
      return json({ notifications, unread: notifications.filter((notification) => notification.is_read === 0).length });
    }
    if (request.method === 'POST' && pathname === '/api/user/notifications/read-all') {
      state.notifications.filter((notification) => notification.user_id === user.id).forEach((notification) => { notification.is_read = 1; });
      return json({ success: true });
    }
    const readMatch = pathname.match(/^\/api\/user\/notifications\/(\d+)\/read$/);
    if (request.method === 'POST' && readMatch) {
      const notification = state.notifications.find((item) => item.id === Number(readMatch[1]) && item.user_id === user.id);
      if (notification) notification.is_read = 1;
      return json({ success: true });
    }
  }

  if (request.method === 'GET' && pathname === '/api/search/beneficiaries') {
    const auth = requireMockUser(request);
    if (auth instanceof Response) return auth;
    const query = (url.searchParams.get('q') || '').toLowerCase();
    const results = state.beneficiaries.filter((beneficiary) =>
      beneficiary.user_id === auth.user.id &&
      (beneficiary.name.toLowerCase().includes(query) || beneficiary.account_number.includes(query))
    ).slice(0, 10);
    return json({ results });
  }

  return json({ error: 'Not found', mode: 'mock' }, { status: 404 });
}

export { state };
