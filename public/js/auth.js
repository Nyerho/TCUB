document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', e => {
      const email = loginForm.querySelector('[name=email]').value;
      const password = loginForm.querySelector('[name=password]').value;

      if (!validateEmail(email)) {
        e.preventDefault();
        alert('Please enter a valid email address.');
        return false;
      }
      if (password.length < 6) {
        e.preventDefault();
        alert('Password must be at least 6 characters.');
        return false;
      }
    });
  }

  const regForm = document.getElementById('registerForm');
  if (regForm) {
    const pwd = document.getElementById('regPwd');
    const pwdC = document.getElementById('regPwdConfirm');
    const matchDiv = document.getElementById('pwdMatch');

    const checkMatch = () => {
      if (!pwdC.value) { matchDiv.innerHTML = ''; return; }
      if (pwd.value === pwdC.value) {
        matchDiv.innerHTML = '<span class="form-hint" style="color:var(--success);">✓ Passwords match</span>';
      } else {
        matchDiv.innerHTML = '<span class="form-error">✗ Passwords do not match</span>';
      }
    };

    pwd && pwd.addEventListener('input', checkMatch);
    pwdC && pwdC.addEventListener('input', checkMatch);

    const submitButton = regForm.querySelector('button[type=submit]');
    const formNotice = document.createElement('div');
    formNotice.className = 'form-error';
    formNotice.setAttribute('role', 'alert');
    formNotice.style.display = 'none';
    formNotice.style.marginBottom = '12px';
    regForm.insertBefore(formNotice, regForm.firstChild);

    regForm.addEventListener('invalid', event => {
      event.preventDefault();
      const field = event.target;
      const label = field.closest('.form-group')?.querySelector('label')?.textContent?.replace('*', '').trim()
        || field.name || 'required field';
      formNotice.textContent = `Please complete the ${label} field before continuing.`;
      formNotice.style.display = 'block';
      field.focus({ preventScroll: true });
    }, true);

    regForm.addEventListener('submit', e => {
      formNotice.style.display = 'none';
      const pwdVal = pwd.value;
      if (pwdVal.length < 8) {
        e.preventDefault();
        formNotice.textContent = 'Password must be at least 8 characters long.';
        formNotice.style.display = 'block';
        pwd.focus();
        return false;
      }
      if (pwdVal !== pwdC.value) {
        e.preventDefault();
        formNotice.textContent = 'Passwords do not match.';
        formNotice.style.display = 'block';
        pwdC.focus();
        return false;
      }
      if (!regForm.querySelector('[name=terms]').checked) {
        e.preventDefault();
        formNotice.textContent = 'Please accept the Terms & Conditions before opening your account.';
        formNotice.style.display = 'block';
        regForm.querySelector('[name=terms]').focus();
        return false;
      }
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Submitting application…';
      }
    });
  }
});
