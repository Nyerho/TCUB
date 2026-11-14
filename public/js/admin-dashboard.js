function initializeAdminDashboard() {
  loadStatsNotifications();
  setupApprovalActions();
  setupUserSearch();
  setupFreezeButtons();
}

document.addEventListener('DOMContentLoaded', initializeAdminDashboard);
document.addEventListener('admin:content-updated', initializeAdminDashboard);

function loadStatsNotifications() {
  const dot = document.getElementById('notifDot');
  if (!dot) return;
  fetch('/api/user/notifications')
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data) dot.style.display = data.unread > 0 ? 'block' : 'none';
    })
    .catch(() => {});
}

function setupApprovalActions() {
  document.querySelectorAll('[data-action]').forEach(btn => {
    if (btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', e => {
      e.preventDefault();
      const form = btn.closest('form');
      if (!form) return;
      const action = btn.dataset.action;
      const isReject = action.includes('reject') || action.includes('Reject');
      const doIt = () => form.requestSubmit ? form.requestSubmit() : form.submit();

      if (isReject) {
        const reason = prompt('Please enter rejection reason:');
        if (reason === null) return;
        const reasonField = document.createElement('input');
        reasonField.type = 'hidden';
        reasonField.name = 'reason';
        reasonField.value = reason || 'No reason provided';
        form.appendChild(reasonField);
        doIt();
      } else {
        confirmAction('Confirm this approval?', doIt);
      }
    });
  });
}

function setupUserSearch() {
  const bar = document.getElementById('topbarSearch');
  if (bar && window.location.pathname.startsWith('/admin/users') && bar.dataset.bound !== 'true') {
    bar.dataset.bound = 'true';
    bar.placeholder = 'Search users by name, email, phone...';
    let t;
    bar.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const q = bar.value.trim();
        window.location.search = q ? `?search=${encodeURIComponent(q)}` : '';
      }, 500);
    });
  }
}

function setupFreezeButtons() {
  document.querySelectorAll('[data-freeze-user]').forEach(btn => {
    if (btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', async () => {
      const id = btn.dataset.freezeUser;
      if (!confirm('Toggle freeze status for this user?')) return;
      btn.disabled = true;
      try {
        const r = await fetch(`/admin/users/${id}/freeze`, { method: 'POST' });
        const data = await r.json();
        if (!data.success) throw new Error(data.message || 'The user status was not changed.');
        if (window.showActionToast) window.showActionToast('success', data.message || `User ${data.frozen ? 'frozen' : 'unfrozen'} successfully.`);
        setTimeout(() => location.reload(), 450);
      } catch (e) {
        btn.disabled = false;
        if (window.showActionToast) window.showActionToast('error', e.message || 'Error toggling freeze.');
        else alert(e.message || 'Error toggling freeze');
      }
    });
  });
}

function submitAdminAction(action, fields = {}) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = action;
  Object.entries(fields).forEach(([name, value]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  });
  document.body.appendChild(form);
  if (form.requestSubmit) form.requestSubmit();
  else form.submit();
}

function captureFreezeReason(form, isCurrentlyFrozen) {
  if (isCurrentlyFrozen) return true;
  const reason = prompt('Enter the reason for freezing this account. This will be included in the customer email:', 'Account security review');
  if (reason === null) return false;
  const field = form.querySelector('input[name="reason"]');
  if (field) field.value = reason.trim().slice(0, 500);
  return true;
}

function deleteUser(id, name) {
  if (!confirm(`DELETE user "${name}"?\nThis action cannot be undone and will remove ALL their data.`)) return;
  submitAdminAction(`/admin/users/${id}/delete`);
}

function resetUserPwd(id, name) {
  const pwd = prompt(`Enter NEW password for ${name}:`, 'TempPass2026!');
  if (!pwd || pwd.length < 8) {
    if (window.showActionToast) window.showActionToast('error', 'Password must be at least 8 characters.');
    else alert('Password must be at least 8 chars');
    return;
  }
  submitAdminAction(`/admin/users/${id}/reset-password`, { password: pwd });
}

document.addEventListener('click', e => {
  const btn = e.target.closest('.toggle-user-accounts');
  if (btn) {
    const sec = document.getElementById(btn.dataset.target);
    if (sec) sec.style.display = sec.style.display === 'none' ? '' : 'none';
  }
});
