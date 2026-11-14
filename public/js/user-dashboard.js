document.addEventListener('DOMContentLoaded', () => {
  bindAccountCards();
  loadNotifications();
  window.setInterval(refreshDashboard, 30000);
});

function bindAccountCards() {
  document.querySelectorAll('.account-card').forEach(card => {
    if (card.dataset.bound === 'true') return;
    card.dataset.bound = 'true';
    card.addEventListener('click', e => {
      if (e.target.tagName.toLowerCase() === 'a' || e.target.tagName.toLowerCase() === 'button') return;
      const link = card.querySelector('a.btn-light');
      if (link) link.click();
    });
  });
}

async function loadNotifications() {
  try {
    const dot = document.getElementById('notifDot');
    if (!dot) return;
    const data = await apiRequest('/api/user/notifications');
    if (data) dot.style.display = data.unread > 0 ? 'block' : 'none';
  } catch (e) {}
}

async function refreshDashboard() {
  if (document.hidden || document.querySelector('form:focus-within')) return;
  try {
    const response = await fetch(`${window.location.pathname}?partial=1`, {
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      cache: 'no-store'
    });
    if (!response.ok) return;
    const html = await response.text();
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const currentContent = document.querySelector('.content');
    const nextContent = parsed.querySelector('.content');
    if (currentContent && nextContent) {
      currentContent.innerHTML = nextContent.innerHTML;
      bindAccountCards();
      loadNotifications();
    }
  } catch (e) {}
}

function freezeAccount(id) {
  confirmAction('Are you sure you want to freeze/unfreeze this card?', () => {
    fetch(`/cards/${id}/freeze`, { method: 'POST' })
      .then(r => r.json ? r.json() : {})
      .then(() => location.reload());
  });
}

function cancelTransaction(id) {
  confirmAction('Cancel this transaction? Any held funds will be released.', () => {
    fetch(`/transfers/${id}/cancel`, { method: 'POST' })
      .then(() => location.reload());
  });
}

document.addEventListener('click', e => {
  const notifyBtn = e.target.closest('.mark-notif');
  if (notifyBtn) {
    e.preventDefault();
    const id = notifyBtn.dataset.id;
    fetch(`/api/user/notifications/${id}/read`, { method: 'POST' })
      .then(() => {
        const row = notifyBtn.closest('tr');
        if (row) row.style.opacity = '0.6';
      });
  }
});
