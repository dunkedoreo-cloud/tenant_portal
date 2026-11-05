const roleOptions = [...document.querySelectorAll('[data-role-choice]')];
const loginForm = document.getElementById('login-form');
const continueButton = document.getElementById('continue-role');
const feedback = document.getElementById('login-feedback');
let selectedRole = '';

roleOptions.forEach((option) => option.addEventListener('click', () => {
  selectedRole = option.dataset.roleChoice;
  roleOptions.forEach((roleOption) => roleOption.setAttribute('aria-pressed', String(roleOption === option)));
  continueButton.disabled = false;
  continueButton.textContent = `Sign in as ${selectedRole === 'owner' ? 'Owner' : 'Tenant'}`;
  feedback.textContent = '';
}));

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedRole) {
    feedback.textContent = 'Choose Owner or Tenant first.';
    return;
  }

  const requestedRole = selectedRole;
  const submitButton = loginForm.querySelector('button[type="submit"]');
  const formData = new FormData(loginForm);
  roleOptions.forEach((option) => { option.disabled = true; });
  submitButton.disabled = true;
  feedback.textContent = 'Signing in…';

  try {
    const { data, error } = await window.bordsSupabase.auth.signInWithPassword({
      email: String(formData.get('email')).trim(),
      password: String(formData.get('password'))
    });
    if (error) throw error;

    if (data.user.app_metadata.role !== requestedRole) {
      const { error: signOutError } = await window.bordsSupabase.auth.signOut();
      if (signOutError) throw signOutError;
      throw new Error('This account is not configured for the selected role. Contact the owner.');
    }

    window.location.href = requestedRole === 'owner' ? 'owner.html' : 'tenant.html';
  } catch (error) {
    feedback.textContent = `Could not sign in: ${error.message}`;
    roleOptions.forEach((option) => { option.disabled = false; });
    submitButton.disabled = false;
  }
});
