const tenantSignupForm = document.getElementById('tenant-signup-form');
const tenantSignupFeedback = document.getElementById('tenant-signup-feedback');
const resendConfirmationButton = document.getElementById('resend-confirmation-button');
let submittedEmail = '';

tenantSignupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(tenantSignupForm);
  const email = String(formData.get('email')).trim().toLowerCase();
  submittedEmail = email;
  const password = String(formData.get('password'));
  const confirmation = String(formData.get('confirmPassword'));
  if (password !== confirmation) {
    tenantSignupFeedback.textContent = 'The passwords do not match.';
    return;
  }

  const submitButton = tenantSignupForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  tenantSignupFeedback.textContent = 'Creating your account…';
  try {
    const { error } = await window.bordsSupabase.auth.signUp({ email, password });
    if (error) throw error;
    tenantSignupForm.hidden = true;
    resendConfirmationButton.hidden = false;
    tenantSignupFeedback.textContent = 'Account request submitted. If Supabase requires email confirmation, open the confirmation email. Then return to sign in as Tenant. Your account is linked only when the Owner has entered this same email on your tenant record.';
  } catch (error) {
    tenantSignupFeedback.textContent = `Could not create account: ${error.message}`;
    submitButton.disabled = false;
    resendConfirmationButton.hidden = false;
  }
});

resendConfirmationButton.addEventListener('click', async () => {
  const emailInput = tenantSignupForm.elements.email;
  const email = tenantSignupForm.hidden ? submittedEmail : emailInput.value.trim().toLowerCase();
  if (!tenantSignupForm.hidden && !emailInput.reportValidity()) return;
  if (!email) {
    tenantSignupFeedback.textContent = 'Enter your email address first.';
    return;
  }

  resendConfirmationButton.disabled = true;
  tenantSignupFeedback.textContent = 'Sending confirmation email…';
  try {
    const { error } = await window.bordsSupabase.auth.resend({ type: 'signup', email });
    if (error) throw error;
    tenantSignupFeedback.textContent = 'If this address has an unconfirmed account, a new confirmation email has been sent.';
  } catch (error) {
    tenantSignupFeedback.textContent = `Could not resend confirmation email: ${error.message}`;
  } finally {
    resendConfirmationButton.disabled = false;
  }
});
