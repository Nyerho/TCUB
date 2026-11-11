'use strict';

const NON_OPERABLE_ACCOUNT_STATUSES = new Set(['frozen', 'blocked', 'closed']);

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    req.session.error = 'Please login to access this page.';
    return res.redirect('/auth/login');
  }
  next();
}

function requireVerified(req, res, next) {
  const sessionUser = req.user || req.session.user || null;
  if (sessionUser && Number(sessionUser.is_frozen) === 1) {
    req.session.error = 'Your account has been frozen. Please contact support.';
    return res.redirect('/auth/login');
  }
  if (!sessionUser || Number(sessionUser.is_verified) !== 1) {
    req.session.error = 'Complete and approve your KYC verification before using this feature.';
    return res.redirect('/kyc');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    req.session.error = 'Please login to access this page.';
    return res.redirect('/auth/login');
  }
  if (!req.session.user || Number(req.session.user.is_admin) !== 1) {
    req.session.error = 'Access denied. Admin privileges required.';
    return res.redirect('/user/dashboard');
  }
  next();
}

function getAccountStatusMessage(account, action = 'complete this action') {
  if (!account) return 'Invalid account selected.';
  const status = String(account.status || 'active').toLowerCase();
  if (!NON_OPERABLE_ACCOUNT_STATUSES.has(status)) return null;
  if (status === 'frozen') return `This account is frozen and cannot be used to ${action}.`;
  if (status === 'blocked') return `This account is blocked and cannot be used to ${action}.`;
  return `This account is closed and cannot be used to ${action}.`;
}

function isAccountOperable(account) {
  return !getAccountStatusMessage(account);
}

function formatCurrency(amount, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount || 0);
}

module.exports = {
  requireAuth,
  requireVerified,
  requireAdmin,
  getAccountStatusMessage,
  isAccountOperable,
  formatCurrency
};
