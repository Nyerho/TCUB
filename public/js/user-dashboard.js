document.addEventListener('DOMContentLoaded', () => {
  loadNotifications();
  startDashboardRefresh();
});

async function loadNotifications() {
  try {
    const dot = document.getElementById('notifDot');
    if (!dot) return;
    const data = await apiRequest('/api/user/notifications');
    dot.style.display = data && data.unread > 0 ? 'block' : 'none';
  } catch (_) {}
}

function startDashboardRefresh() {
  if (window.location.pathname !== '/user/dashboard') return;
  let refreshInProgress = false;

  const refreshDashboard = async () => {
    if (refreshInProgress || document.visibilityState !== 'visible') return;
    refreshInProgress = true;
    try {
      const response = await fetch(window.location.href, {
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Cache-Control': 'no-cache' },
        cache: 'no-store'
      });
      if (!response.ok) return;
      const html = await response.text();
      const nextDocument = new DOMParser().parseFromString(html, 'text/html');
      const currentContent = document.querySelector('.main .content');
      const updatedContent = nextDocument.querySelector('.main .content');
      if (!currentContent || !updatedContent || currentContent.innerHTML === updatedContent.innerHTML) return;

      const wasNearTop = window.scrollY < 120;
      currentContent.replaceWith(updatedContent);
      if (wasNearTop) window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (_) {
      // Keep the current dashboard usable while offline; retry on the next interval.
    } finally {
      refreshInProgress = false;
    }
  };

  window.setInterval(refreshDashboard, 15000);
  window.addEventListener('focus', refreshDashboard);
}

// Delegate clicks so account cards keep working after refreshed content is inserted.
document.addEventListener('click', (event) => {
  const notifyButton = event.target.closest('.mark-notif');
  if (notifyButton) {
    event.preventDefault();
    fetch(`/api/user/notifications/${notifyButton.dataset.id}/read`, { method: 'POST', credentials: 'same-origin' })
      .then((response) => {
        if (!response.ok) throw new Error('Unable to mark notification as read');
        const row = notifyButton.closest('tr');
        if (row) row.style.opacity = '0.6';
      })
      .catch(() => {});
    return;
  }
  const card = event.target.closest('.account-card');
  if (!card || event.target.closest('a, button')) return;
  const detailsLink = card.querySelector('a.btn-light');
  if (detailsLink) detailsLink.click();
});

function freezeAccount(id) {
  confirmAction('Are you sure you want to freeze/unfreeze this card?', async () => {
    try {
      const response = await fetch(`/cards/${id}/freeze`, { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Request failed');
      showUserActionNotice('Card status updated successfully.', true);
    } catch (_) {
      showUserActionNotice('We could not confirm the card update. Check its status before trying again.', false);
    }
  });
}

function cancelTransaction(id) {
  confirmAction('Cancel this transaction? Any held funds will be released.', async () => {
    try {
      const response = await fetch(`/transfers/${id}/cancel`, { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Request failed');
      showUserActionNotice('Transaction cancellation submitted.', true);
    } catch (_) {
      showUserActionNotice('We could not confirm the cancellation. Check the transaction before trying again.', false);
    }
  });
}

function showUserActionNotice(message, success) {
  const notice = document.createElement('div');
  notice.className = `alert alert-${success ? 'success' : 'danger'}`;
  notice.setAttribute('role', success ? 'status' : 'alert');
  notice.style.cssText = 'position:fixed;top:18px;right:18px;z-index:10050;max-width:min(420px,calc(100vw - 36px));box-shadow:0 12px 32px rgba(15,23,42,.18);';
  notice.textContent = message;
  document.body.append(notice);
  window.setTimeout(() => notice.remove(), 6000);
}
