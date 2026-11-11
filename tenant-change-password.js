const changePasswordForm = document.getElementById('tenant-change-password-form');
const changePasswordFeedback = document.getElementById('tenant-change-password-feedback');
let tenantUser = null;

async function initializeChangePassword() {
  const { data, error } = await window.bordsSupabase.auth.getSession();
  if (error) throw error;
  if (!data.session) {
    window.location.replace('index.html');
    return;
  }
  if (data.session.user.app_metadata?.role === 'owner') {
    window.location.replace('owner.html');
    return;
  }
  tenantUser = data.session.user;
}

initializeChangePassword().catch((error) => {
  changePasswordForm.hidden = true;
  changePasswordFeedback.textContent = `Could not verify your account: ${error.message}`;
});

changePasswordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!tenantUser) {
    changePasswordFeedback.textContent = 'Sign in to your tenant account before changing the password.';
    return;
  }

  const formData = new FormData(changePasswordForm);
  const currentPassword = String(formData.get('currentPassword'));
  const newPassword = String(formData.get('newPassword'));
  const confirmPassword = String(formData.get('confirmPassword'));
  if (newPassword.length < 8) {
    changePasswordFeedback.textContent = 'New password must be at least 8 characters.';
    return;
  }
  if (newPassword !== confirmPassword) {
    changePasswordFeedback.textContent = 'The new passwords do not match.';
    return;
  }
  if (newPassword === currentPassword) {
    changePasswordFeedback.textContent = 'Choose a new password different from your current password.';
    return;
  }

  const submitButton = changePasswordForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  changePasswordFeedback.textContent = 'Verifying current password…';
  try {
    const { error: verifyError } = await window.bordsSupabase.auth.signInWithPassword({
      email: tenantUser.email,
      password: currentPassword
    });
    if (verifyError) throw new Error('Current password is incorrect.');

    const { error } = await window.bordsSupabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    changePasswordForm.reset();
    changePasswordFeedback.textContent = 'Password updated successfully.';
  } catch (error) {
    changePasswordFeedback.textContent = `Could not update password: ${error.message}`;
  } finally {
    submitButton.disabled = false;
  }
});
