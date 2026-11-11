document.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-password-toggle]');
  if (!toggle) return;

  const targetId = toggle.getAttribute('aria-controls');
  const passwordInput = document.getElementById(targetId);
  if (!passwordInput) return;

  const isVisible = passwordInput.type === 'text';
  passwordInput.type = isVisible ? 'password' : 'text';
  toggle.textContent = isVisible ? 'Show' : 'Hide';
  toggle.setAttribute('aria-label', `${isVisible ? 'Show' : 'Hide'} password`);
  toggle.setAttribute('aria-pressed', String(!isVisible));
});
