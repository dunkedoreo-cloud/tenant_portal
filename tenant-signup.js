const tenantSignupForm = document.getElementById('tenant-signup-form');
const tenantSignupFeedback = document.getElementById('tenant-signup-feedback');
const resendConfirmationButton = document.getElementById('resend-confirmation-button');
let submittedEmail = '';

tenantSignupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(tenantSignupForm);
  const name = String(formData.get('name')).trim();
  const email = String(formData.get('email')).trim().toLowerCase();
  const phone = String(formData.get('phone')).trim();
  submittedEmail = email;
  const password = String(formData.get('password'));
  const confirmation = String(formData.get('confirmPassword'));

  if (!name) {
    tenantSignupFeedback.textContent = 'Enter your full name.';
    return;
  }
  if (password.length < 8) {
    tenantSignupFeedback.textContent = 'Password must be at least 8 characters.';
    return;
  }
  if (password !== confirmation) {
    tenantSignupFeedback.textContent = 'The passwords do not match.';
    return;
  }

  const submitButton = tenantSignupForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  tenantSignupFeedback.textContent = 'Creating your account…';

  try {
    const { data, error } = await window.bordsSupabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          signup_type: 'tenant',
          role: 'tenant',
          full_name: name,
          phone
        }
      }
    });

    if (error) {
      // Check if error is due to database not-null constraint on room_id before SQL script was run
      if (error.message && error.message.includes('room_id')) {
        throw new Error('Database schema requires updating: please run the provided supabase-tenant-signup.sql migration in your Supabase SQL Editor.');
      }
      throw error;
    }

    // If Supabase returned an active session immediately (auto-confirm enabled)
    if (data.session) {
      tenantSignupFeedback.textContent = 'Account created successfully! Preparing your tenant portal…';
      try {
        await window.bordsSupabase.rpc('ensure_tenant_profile');
      } catch (rpcErr) {
        // Fallback: silent continue
      }
      setTimeout(() => {
        window.location.replace('tenant.html');
      }, 1000);
      return;
    }

    // If email confirmation is required by Supabase
    tenantSignupForm.hidden = true;
    resendConfirmationButton.hidden = false;
    tenantSignupFeedback.textContent = 'Account created! If your boarding house requires email confirmation, please check your inbox and confirm your address, then sign in as Tenant. If confirmation is not required, you can sign in directly.';
  } catch (error) {
    tenantSignupFeedback.textContent = `Could not create account: ${error.message}`;
    submitButton.disabled = false;
    if (submittedEmail) {
      resendConfirmationButton.hidden = false;
    }
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
