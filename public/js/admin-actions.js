(() => {
  const pendingForms = new WeakSet();

  function showAdminNotice(type, message, title) {
    document.querySelectorAll('.admin-action-notice').forEach((notice) => notice.remove());
    const notice = document.createElement('div');
    notice.className = `alert alert-${type} admin-action-notice`;
    notice.setAttribute('role', type === 'danger' ? 'alert' : 'status');
    notice.setAttribute('aria-live', type === 'danger' ? 'assertive' : 'polite');
    notice.style.cssText = 'position:fixed;top:18px;right:18px;z-index:10050;max-width:min(420px,calc(100vw - 36px));box-shadow:0 12px 32px rgba(15,23,42,.18);';
    const icon = type === 'success' ? '✓' : type === 'warning' ? '!' : '×';
    const heading = document.createElement('strong');
    heading.textContent = title || (type === 'success' ? 'Action completed' : type === 'warning' ? 'Action status unclear' : 'Action failed');
    const body = document.createElement('div');
    body.style.marginTop = '4px';
    body.textContent = message;
    notice.innerHTML = `<span class="alert-icon" aria-hidden="true">${icon}</span>`;
    const content = document.createElement('div');
    content.className = 'alert-content';
    content.append(heading, body);
    notice.append(content);
    document.body.append(notice);
    if (type !== 'danger') {
      window.setTimeout(() => notice.remove(), 6500);
    }
  }

  function readNotice(documentNode, id) {
    const node = documentNode.getElementById(id);
    return node ? node.querySelector('.alert-message')?.textContent.trim() || node.textContent.trim() : '';
  }

  document.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.closest('.main')) return;
    if ((form.method || 'get').toLowerCase() !== 'post' || form.dataset.nativeSubmit === 'true') return;
    if (pendingForms.has(form)) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    pendingForms.add(form);
    form.dataset.submitting = 'true';
    const controls = [...form.querySelectorAll('button[type="submit"], input[type="submit"]')];
    const labels = controls.map((control) => control instanceof HTMLInputElement ? control.value : control.innerHTML);
    controls.forEach((control) => {
      control.disabled = true;
      if (control instanceof HTMLInputElement) control.value = 'Saving…';
      else control.innerHTML = 'Saving…';
    });

    try {
      const response = await fetch(form.action || window.location.href, {
        method: 'POST',
        body: new URLSearchParams(new FormData(form)),
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
        }
      });
      const html = await response.text();
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const result = JSON.parse(html);
        if (!response.ok || result.success === false) {
          showAdminNotice('danger', result.message || result.error || `The server returned ${response.status}.`, 'Action failed');
          pendingForms.delete(form);
          delete form.dataset.submitting;
          controls.forEach((control, index) => {
            control.disabled = false;
            if (control instanceof HTMLInputElement) control.value = labels[index];
            else control.innerHTML = labels[index];
          });
          return;
        }
        if (typeof result.frozen === 'boolean') {
          const button = form.querySelector('button[type="submit"]');
          if (button) button.textContent = result.frozen ? '🔥 Unfreeze' : '❄️ Freeze';
        }
        showAdminNotice('success', result.message || 'The request was processed successfully.', 'Action completed');
        pendingForms.delete(form);
        delete form.dataset.submitting;
        controls.forEach((control, index) => {
          control.disabled = false;
          if (control instanceof HTMLInputElement) control.value = labels[index];
          else if (typeof result.frozen !== 'boolean') control.innerHTML = labels[index];
        });
        return;
      }
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      const successMessage = readNotice(parsed, 'toast-success');
      const errorMessage = readNotice(parsed, 'toast-error');
      const currentMain = document.querySelector('.main');
      const nextMain = parsed.querySelector('.main');

      if (!response.ok || !nextMain) {
        throw new Error(errorMessage || `The server returned ${response.status}.`);
      }

      nextMain.querySelectorAll('script').forEach((oldScript) => {
        const script = document.createElement('script');
        [...oldScript.attributes].forEach((attribute) => script.setAttribute(attribute.name, attribute.value));
        script.textContent = oldScript.textContent;
        oldScript.replaceWith(script);
      });
      currentMain.replaceWith(nextMain);
      const destination = new URL(response.url, window.location.origin);
      window.history.pushState({}, '', destination.pathname + destination.search + destination.hash);

      if (errorMessage) {
        showAdminNotice('danger', errorMessage, 'Action failed');
        pendingForms.delete(form);
        form.dataset.submitting = 'false';
      } else {
        showAdminNotice('success', successMessage || 'The request was processed successfully.', 'Action completed');
      }
    } catch (error) {
      // A network failure can happen after a request has reached the server. Keep
      // this submit locked so the admin does not accidentally apply it twice.
      showAdminNotice('warning', `We couldn't confirm the result (${error.message}). Check the affected record before trying again.`, 'Please verify before retrying');
      form.querySelectorAll('button[type="submit"], input[type="submit"]').forEach((control, index) => {
        control.disabled = true;
        if (control instanceof HTMLInputElement) control.value = labels[index] || 'Submitted';
        else control.innerHTML = labels[index] || 'Submitted';
      });
    }
  });

  window.addEventListener('pageshow', () => {
    document.querySelectorAll('.main form[data-submitting="true"]').forEach((form) => {
      delete form.dataset.submitting;
      form.querySelectorAll('button[type="submit"], input[type="submit"]').forEach((control) => { control.disabled = false; });
    });
  });
})();
