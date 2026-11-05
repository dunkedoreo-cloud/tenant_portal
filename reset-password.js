const newPasswordForm = document.getElementById('new-password-form');
const newPasswordIntro = document.getElementById('reset-password-intro');
const newPasswordFeedback = document.getElementById('reset-password-feedback');
const retryLink = document.getElementById('reset-retry-link');
const signInLink = document.getElementById('reset-success-link');
let hasRecoverySession = false;

async function checkRecoverySession() {
  const { data, error } = await window.bordsSupabase.auth.getSession();
  if (error) throw error;
  hasRecoverySession = Boolean(data.session);
  if (hasRecoverySession) {
    newPasswordForm.hidden = false;
    newPasswordIntro.textContent = 'Enter and confirm your new password.';
    return;
  }
  newPasswordIntro.textContent = 'This reset link is invalid or has expired. Request a new one to continue.';
  retryLink.hidden = false;
}

checkRecoverySession().catch((error) => {
  newPasswordIntro.textContent = 'We could not verify this reset link.';
  newPasswordFeedback.textContent = `Could not verify reset link: ${error.message}`;
});

newPasswordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!hasRecoverySession) {
    newPasswordFeedback.textContent = 'Request a new reset link before choosing a password.';
    return;
  }

  const formData = new FormData(newPasswordForm);
  const password = String(formData.get('password'));
  const confirmation = String(formData.get('confirmPassword'));
  if (password !== confirmation) {
    newPasswordFeedback.textContent = 'The passwords do not match.';
    return;
  }

  const submitButton = newPasswordForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  newPasswordFeedback.textContent = 'Updating password…';

  try {
    const { error } = await window.bordsSupabase.auth.updateUser({ password });
    if (error) throw error;
    newPasswordForm.hidden = true;
    newPasswordIntro.textContent = 'Your password has been updated. You can now sign in with it.';
    signInLink.hidden = false;
  } catch (error) {
    newPasswordFeedback.textContent = `Could not update password: ${error.message}`;
    submitButton.disabled = false;
  }
});
