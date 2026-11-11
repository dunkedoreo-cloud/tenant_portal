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
    const email = String(formData.get('email')).trim().toLowerCase();
    const password = String(formData.get('password'));

    const { data, error } = await window.bordsSupabase.auth.signInWithPassword({
      email,
      password
    });
    if (error) throw error;

    const user = data.user;
    const appRole = user?.app_metadata?.role;
    const userRole = user?.user_metadata?.signup_type || user?.user_metadata?.role;

    if (requestedRole === 'tenant') {
      // If user is explicitly configured as owner, prevent tenant sign-in
      if (appRole === 'owner') {
        await window.bordsSupabase.auth.signOut();
        throw new Error('This account is registered as an Owner. Please choose the Owner role above to sign in.');
      }

      // Self-heal: ensure tenant profile and role are active
      try {
        await window.bordsSupabase.rpc('ensure_tenant_profile');
        await window.bordsSupabase.auth.refreshSession();
      } catch (rpcErr) {
        // Fallback: silent proceed if RPC is not installed yet
      }

      window.location.replace('tenant.html');
      return;
    }

    if (requestedRole === 'owner') {
      // If explicitly a tenant
      if (appRole === 'tenant' || (userRole === 'tenant' && appRole !== 'owner')) {
        await window.bordsSupabase.auth.signOut();
        throw new Error('This account is registered as a Tenant, not an Owner. Please choose Tenant above to sign in.');
      }

      if (appRole !== 'owner') {
        await window.bordsSupabase.auth.signOut();
        throw new Error(`This account does not have Owner permissions yet. In your Supabase SQL Editor, run: SELECT public.assign_owner_role('${email}'); then sign in again.`);
      }

      window.location.replace('owner.html');
      return;
    }
  } catch (error) {
    feedback.textContent = `Could not sign in: ${error.message}`;
    roleOptions.forEach((option) => { option.disabled = false; });
    submitButton.disabled = false;
  }
});
