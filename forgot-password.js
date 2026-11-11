const resetRequestForm = document.getElementById('reset-request-form');
const resetRequestFeedback = document.getElementById('reset-request-feedback');

resetRequestForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = resetRequestForm.querySelector('button[type="submit"]');
  const email = String(new FormData(resetRequestForm).get('email')).trim().toLowerCase();
  const redirectTo = new URL('reset-password.html', window.location.href).href;
  submitButton.disabled = true;
  resetRequestFeedback.textContent = 'Sending reset link…';

  try {
    const { error } = await window.bordsSupabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
    resetRequestFeedback.textContent = 'If an account exists for that email, a password reset link has been sent.';
  } catch (error) {
    resetRequestFeedback.textContent = `Could not send reset link: ${error.message}`;
  } finally {
    submitButton.disabled = false;
  }
});
