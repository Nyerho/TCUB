const { db } = require('../database');

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

function getAppBaseUrl(req) {
  return String(
    process.env.APP_BASE_URL ||
    (req && req.protocol && req.get ? `${req.protocol}://${req.get('host')}` : 'https://tcub.example')
  ).replace(/\/$/, '');
}

function getEmailConfig() {
  return {
    apiKey: String(process.env.BREVO_API_KEY || '').trim(),
    senderEmail: String(process.env.EMAIL_FROM || '').trim(),
    senderName: String(process.env.BREVO_SENDER_NAME || 'Think Union Credit Bank').trim(),
    replyTo: String(process.env.EMAIL_REPLY_TO || '').trim()
  };
}

function isEmailConfigured() {
  const config = getEmailConfig();
  return Boolean(config.apiKey && config.senderEmail);
}

function emailConfigurationStatus() {
  const config = getEmailConfig();
  return {
    configured: Boolean(config.apiKey && config.senderEmail),
    apiKeySet: Boolean(config.apiKey),
    senderEmailSet: Boolean(config.senderEmail),
    senderNameSet: Boolean(config.senderName),
    replyToSet: Boolean(config.replyTo)
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function userName(user) {
  return `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'there';
}

function frame(title, body) {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#18212f;line-height:1.6"><div style="max-width:640px;margin:0 auto;padding:24px"><h1 style="color:#c8102e">${escapeHtml(title)}</h1>${body}<hr style="border:0;border-top:1px solid #ddd;margin-top:32px"><p style="font-size:12px;color:#687386">Think Union Credit Bank. This is an automated message; please do not reply unless a reply address is configured.</p></div></body></html>`;
}

function normalizeRecipients(to) {
  const recipients = Array.isArray(to) ? to : [to];
  return recipients
    .map((recipient) => typeof recipient === 'string' ? { email: recipient } : recipient)
    .filter((recipient) => recipient?.email);
}

async function sendEmail({ to, subject, html, text }) {
  const config = getEmailConfig();
  if (!config.apiKey || !config.senderEmail) {
    const missing = [!config.apiKey && 'BREVO_API_KEY', !config.senderEmail && 'EMAIL_FROM'].filter(Boolean);
    console.warn(`[email] skipped: missing runtime configuration (${missing.join(', ')})`);
    return { sent: false, skipped: true, reason: 'email-not-configured' };
  }

  const recipients = normalizeRecipients(to);
  if (!recipients.length) {
    return { sent: false, skipped: true, reason: 'no-recipient' };
  }

  const payload = {
    sender: { email: config.senderEmail, name: config.senderName },
    to: recipients,
    subject: String(subject || 'Think Union Credit Bank notification'),
    htmlContent: html || `<p>${escapeHtml(text || '')}</p>`,
    textContent: text || ''
  };
  if (config.replyTo) payload.replyTo = { email: config.replyTo };

  let response;
  try {
    response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': config.apiKey
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });
  } catch (error) {
    throw new Error(`Brevo request failed: ${error.message}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Brevo email failed with HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }

  const result = await response.json().catch(() => ({}));
  console.info(`[email] Brevo accepted messageId=${result.messageId || 'not-returned'} recipients=${recipients.length}`);
  return { sent: true, messageId: result.messageId || null };
}

async function sendAccountWelcomeEmail(user) {
  const name = userName(user);
  return sendEmail({
    to: user.email,
    subject: 'Welcome to Think Union Credit Bank',
    html: frame('Welcome to Think Union Credit Bank', `<p>Hello ${escapeHtml(name)},</p><p>Your account has been created successfully. You can now sign in and complete your banking setup.</p>`),
    text: `Hello ${name}, your Think Union Credit Bank account has been created successfully.`
  });
}

async function sendLoginWelcomeEmail(user, context = {}) {
  const name = userName(user);
  const detail = [
    context.ip ? `IP address: ${context.ip}` : '',
    context.userAgent ? `Device: ${context.userAgent}` : ''
  ].filter(Boolean).join('<br>');
  const textDetail = [
    context.ip ? `IP address: ${context.ip}` : '',
    context.userAgent ? `Device: ${context.userAgent}` : ''
  ].filter(Boolean).join('\n');
  return sendEmail({
    to: user.email,
    subject: 'New sign-in to your TCUB account',
    html: frame('New sign-in detected', `<p>Hello ${escapeHtml(name)},</p><p>Your account was just accessed successfully.</p>${detail ? `<p>${detail}</p>` : ''}<p>If you did not make this sign-in, reset your password and contact support immediately.</p>`),
    text: `Hello ${name}, your account was just accessed successfully.${textDetail ? `\n${textDetail}` : ''}\nIf you did not make this sign-in, reset your password and contact support immediately.`
  });
}

async function sendPasswordResetEmail(user, resetUrl) {
  const safeUrl = escapeHtml(resetUrl);
  return sendEmail({
    to: user.email,
    subject: 'Reset your TCUB password',
    html: frame('Password reset requested', `<p>Hello ${escapeHtml(userName(user))},</p><p>Use the link below to reset your password:</p><p><a href="${safeUrl}">${safeUrl}</a></p><p>This link will expire soon. If you did not request this, you can ignore this email.</p>`),
    text: `Reset your TCUB password: ${resetUrl}`
  });
}

async function sendPasswordChangedEmail(user) {
  return sendEmail({
    to: user.email,
    subject: 'Your TCUB password was changed',
    html: frame('Password changed', `<p>Hello ${escapeHtml(userName(user))},</p><p>Your password was changed successfully.</p><p>If you did not make this change, contact support immediately.</p>`),
    text: `Hello ${userName(user)}, your password was changed successfully. If you did not make this change, contact support immediately.`
  });
}

function transactionLabel(transaction) {
  if (transaction.transaction_type === 'admin_adjustment') return 'Account adjustment';
  return String(transaction.transaction_type || 'transaction').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function productionDescription(description) {
  const value = String(description || '').trim();
  if (!value || /probe|tester|test transaction|balance adjusted by admin|admin adjustment/i.test(value)) return '';
  return value;
}

async function sendAccountFrozenEmail(user, reason) {
  const name = userName(user);
  const safeReason = String(reason || '').trim() || 'Your account is currently unavailable while we complete a security review.';
  return sendEmail({
    to: user.email,
    subject: 'Important notice about your TCUB account',
    html: frame('Important account notice', `<p>Hello ${escapeHtml(name)},</p><p>Your Think Union Credit Bank account has been temporarily frozen and account access is currently restricted.</p><p><strong>Reason:</strong> ${escapeHtml(safeReason)}</p><p>Please contact our customer support team if you need assistance or believe this action was taken in error.</p>`),
    text: `Hello ${name},\n\nYour Think Union Credit Bank account has been temporarily frozen and account access is currently restricted.\n\nReason: ${safeReason}\n\nPlease contact our customer support team if you need assistance or believe this action was taken in error.`
  });
}

function transactionAmount(transaction) {
  const amount = Number(transaction.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${transaction.currency || 'USD'} ${amount}`;
}

async function sendTransactionActivityEmailById(transactionId, options = {}) {
  const transaction = db.prepare(`
    SELECT t.*, u.email, u.first_name, u.last_name,
           a.account_name, a.account_number
    FROM transactions t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN accounts a ON a.id = t.account_id
    WHERE t.id = ?
  `).get(transactionId);

  if (!transaction) {
    return { sent: false, skipped: true, reason: 'transaction-not-found' };
  }
  if (!transaction.email) {
    return { sent: false, skipped: true, reason: 'transaction-recipient-missing' };
  }

  const label = transactionLabel(transaction);
  const amount = transactionAmount(transaction);
  const status = String(transaction.status || 'pending').replace(/_/g, ' ');
  const note = options.note ? String(options.note) : '';
  const reference = transaction.reference || transaction.id;
  const account = transaction.account_number ? `${transaction.account_name || 'Account'} ending ${String(transaction.account_number).slice(-4)}` : 'your account';
  const subject = `${label}: ${amount} — ${status}`;
  const detailRows = [
    `<tr><td style="padding:6px 12px 6px 0"><strong>Type</strong></td><td>${escapeHtml(label)}</td></tr>`,
    `<tr><td style="padding:6px 12px 6px 0"><strong>Amount</strong></td><td>${escapeHtml(amount)}</td></tr>`,
    `<tr><td style="padding:6px 12px 6px 0"><strong>Status</strong></td><td>${escapeHtml(status)}</td></tr>`,
    `<tr><td style="padding:6px 12px 6px 0"><strong>Account</strong></td><td>${escapeHtml(account)}</td></tr>`,
    `<tr><td style="padding:6px 12px 6px 0"><strong>Reference</strong></td><td>${escapeHtml(reference)}</td></tr>`
  ];
  const description = productionDescription(transaction.description);
  if (description) detailRows.push(`<tr><td style="padding:6px 12px 6px 0"><strong>Description</strong></td><td>${escapeHtml(description)}</td></tr>`);

  const name = userName(transaction);
  const text = [
    `Hello ${name},`,
    `A ${label.toLowerCase()} was recorded on ${account}.`,
    `Amount: ${amount}`,
    `Status: ${status}`,
    `Reference: ${reference}`,
    description ? `Description: ${description}` : '',
    note,
    'If you do not recognize this activity, contact support immediately.'
  ].filter(Boolean).join('\n');

  return sendEmail({
    to: transaction.email,
    subject,
    html: frame('Transaction activity', `<p>Hello ${escapeHtml(name)},</p><p>A ${escapeHtml(label.toLowerCase())} was recorded on ${escapeHtml(account)}.</p><table>${detailRows.join('')}</table>${note ? `<p><strong>Update:</strong> ${escapeHtml(note)}</p>` : ''}<p>If you do not recognize this activity, contact support immediately.</p>`),
    text
  });
}

module.exports = {
  getAppBaseUrl,
  getEmailConfig,
  emailConfigurationStatus,
  isEmailConfigured,
  sendEmail,
  sendAccountWelcomeEmail,
  sendLoginWelcomeEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendAccountFrozenEmail,
  sendTransactionActivityEmailById
};
