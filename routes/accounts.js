'use strict';

const express = require('express');
const {
  requireAuth,
  requireVerified,
  getAccountStatusMessage
} = require('../middleware/guards');
const accountStore = require('../services/user-account-store');

const router = express.Router();

function getAccountTypes() {
  return [
    { type: 'Everyday Savings', name: 'Everyday Savings Account', min: 0, interest: '0.50%', desc: 'Perfect for everyday banking with no monthly fees' },
    { type: 'High Interest', name: 'High Interest Savings', min: 1000, interest: '4.25%', desc: 'Earn premium returns on your savings' },
    { type: 'Term Deposit', name: 'Term Deposit', min: 5000, interest: '5.10%', desc: 'Locked term for guaranteed returns' },
    { type: 'Business', name: 'Business Account', min: 500, interest: '1.20%', desc: 'Complete business banking solution' },
    { type: 'International', name: 'Multi-Currency Account', min: 100, interest: '0.30%', desc: 'Hold and manage multiple currencies' }
  ];
}

function getCreditAndDebitTotals(transactions) {
  let deposits = 0;
  let withdrawals = 0;
  for (const transaction of transactions) {
    if (transaction.status !== 'completed') continue;
    const amount = Number(transaction.amount) || 0;
    if (transaction.transaction_type === 'admin_adjustment') {
      if (amount > 0) deposits += Math.abs(amount);
      if (amount < 0) withdrawals += Math.abs(amount) + Math.abs(Number(transaction.fee) || 0);
    } else if (['deposit', 'loan_disbursement'].includes(transaction.transaction_type)) {
      deposits += Math.abs(amount);
    } else if (['withdrawal', 'local_transfer', 'international_transfer', 'bill_payment', 'loan_payment'].includes(transaction.transaction_type)) {
      withdrawals += Math.abs(amount) + Math.abs(Number(transaction.fee) || 0);
    }
  }
  return { deposits, withdrawals };
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const accounts = await accountStore.listAccountsForUser(req.session.userId);
    return res.render('accounts/index', {
      title: 'My Accounts - Think Union Credit Bank',
      page: 'accounts',
      accounts
    });
  } catch (error) {
    console.error('[accounts] Firestore list failed:', error.message);
    req.session.error = 'Unable to load your accounts right now.';
    return res.redirect('/user/dashboard');
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const account = await accountStore.getAccountById(req.params.id);
    if (!account || String(account.user_id || account.user_ref) !== String(req.session.userId)) {
      req.session.error = 'Account not found.';
      return res.redirect('/accounts');
    }

    const transactions = await accountStore.listTransactionsForAccount(account, 500);
    const totals = getCreditAndDebitTotals(transactions);
    return res.render('accounts/detail', {
      title: `${account.account_name} - Think Union Credit Bank`,
      page: 'accounts',
      account,
      transactions,
      totalDeposits: totals.deposits,
      totalWithdrawals: totals.withdrawals
    });
  } catch (error) {
    console.error('[accounts] Firestore detail failed:', error.message);
    req.session.error = 'Unable to load this account right now.';
    return res.redirect('/accounts');
  }
});

router.get('/open/new', requireAuth, requireVerified, (req, res) => {
  return res.render('accounts/open', {
    title: 'Open New Account - Think Union Credit Bank',
    page: 'accounts',
    accountTypes: getAccountTypes()
  });
});

router.post('/open', requireAuth, requireVerified, async (req, res) => {
  const { account_type, initial_deposit } = req.body;
  const selectedType = getAccountTypes().find((option) => option.type === account_type);
  if (!selectedType) {
    req.session.error = 'Please select a valid account type.';
    return res.redirect('/accounts/open/new');
  }
  const amount = initial_deposit === '' || initial_deposit == null ? 0 : Number(initial_deposit);
  if (!Number.isFinite(amount) || amount < 0) {
    req.session.error = 'Initial deposit must be a valid non-negative amount.';
    return res.redirect('/accounts/open/new');
  }
  if (amount < selectedType.min) {
    req.session.error = `The minimum initial deposit for this account is $${selectedType.min.toLocaleString()}.`;
    return res.redirect('/accounts/open/new');
  }

  try {
    await accountStore.createAccountForUser(req.session.userId, account_type, amount);
    req.session.success = `Your ${account_type} account has been opened successfully!`;
    return res.redirect('/accounts');
  } catch (error) {
    console.error('[accounts] Firestore create failed:', error.message);
    req.session.error = 'Unable to open this account right now. Please try again.';
    return res.redirect('/accounts/open/new');
  }
});

router.post('/:id/close', requireAuth, requireVerified, async (req, res) => {
  try {
    const result = await accountStore.closeAccountForUser(req.params.id, req.session.userId);
    if (result.status === 'not_found') {
      req.session.error = 'Account not found.';
      return res.redirect('/accounts');
    }
    if (result.status === 'positive_balance') {
      req.session.error = 'Please transfer remaining balance before closing.';
      return res.redirect(`/accounts/${req.params.id}`);
    }
    if (result.status !== 'closed') {
      req.session.error = getAccountStatusMessage({ status: result.status }, 'be closed');
      return res.redirect(`/accounts/${req.params.id}`);
    }
    req.session.success = 'Account closed successfully.';
    return res.redirect('/accounts');
  } catch (error) {
    console.error('[accounts] Firestore close failed:', error.message);
    req.session.error = 'Unable to close this account right now. Please try again.';
    return res.redirect(`/accounts/${req.params.id}`);
  }
});

module.exports = router;
