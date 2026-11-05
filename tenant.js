const monthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
const welcomeTitle = document.getElementById('tenant-welcome-title');
const emptyMessage = document.getElementById('tenant-empty');
const reminderTitle = document.getElementById('reminder-title');
const reminderCopy = document.getElementById('reminder-copy');
const paymentBadge = document.getElementById('rent-status-badge');
const roomList = document.getElementById('available-room-list');
const loanList = document.getElementById('tenant-loan-list');
const loanForm = document.getElementById('tenant-loan-form');
const loanLenderPicker = document.getElementById('loan-lender');
const paymentForm = document.getElementById('tenant-payment-form');
const tenantError = document.getElementById('tenant-error');
let currentTenant = null;
let tenantDirectory = [];
let records = { tenants: [], rooms: [], payments: [], loans: [], roomRequests: [] };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function money(value) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0
  }).format(Number(value) || 0);
}

function mapPayment(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    month: row.month,
    amount: Number(row.amount),
    status: row.status,
    paidOn: row.paid_on || '',
    method: row.method || '',
    proofImage: row.proof_image || '',
    reviewedAt: row.reviewed_at || ''
  };
}

async function loadTenantData(user) {
  const { data: tenant, error: tenantLoadError } = await window.bordsSupabase
    .from('tenants')
    .select('id, name, phone, room_id, monthly_rent, status')
    .eq('user_id', user.id)
    .maybeSingle();
  if (tenantLoadError) throw new Error(`Could not load your tenant profile: ${tenantLoadError.message}`);
  if (!tenant) throw new Error('Your login is not linked to a tenant record yet. Ask the Owner to link your account.');

  const [roomsResult, paymentsResult, loansResult, requestsResult, directoryResult] = await Promise.all([
    window.bordsSupabase.from('room_availability').select('*').order('number'),
    window.bordsSupabase.from('payments').select('*').eq('tenant_id', tenant.id).order('month', { ascending: false }),
    window.bordsSupabase.from('loans').select('*').or(`borrower_id.eq.${tenant.id},lender_id.eq.${tenant.id}`),
    window.bordsSupabase.from('room_requests').select('*').eq('tenant_id', tenant.id),
    window.bordsSupabase.from('tenant_directory').select('id, name').order('name')
  ]);
  for (const [table, result] of [
    ['room availability', roomsResult],
    ['payments', paymentsResult],
    ['loans', loansResult],
    ['room requests', requestsResult],
    ['tenant directory', directoryResult]
  ]) {
    if (result.error) throw new Error(`Could not load ${table}: ${result.error.message}`);
  }

  currentTenant = {
    id: tenant.id,
    name: tenant.name,
    phone: tenant.phone || '',
    roomId: tenant.room_id || '',
    monthlyRent: Number(tenant.monthly_rent),
    status: tenant.status
  };
  tenantDirectory = directoryResult.data || [];
  records = {
    tenants: [currentTenant, ...tenantDirectory.filter((entry) => entry.id !== currentTenant.id)],
    rooms: roomsResult.data.map((room) => ({
      id: room.id,
      number: room.number,
      type: room.type,
      beds: Number(room.beds),
      monthlyRent: Number(room.monthly_rent),
      condition: room.condition,
      occupiedBeds: Number(room.occupied_beds)
    })),
    payments: (paymentsResult.data || []).map(mapPayment),
    loans: (loansResult.data || []).map((loan) => ({
      id: loan.id,
      borrowerId: loan.borrower_id,
      lenderId: loan.lender_id,
      amount: Number(loan.amount),
      dueDate: loan.due_date || '',
      status: loan.status
    })),
    roomRequests: (requestsResult.data || []).map((request) => ({
      id: request.id,
      tenantId: request.tenant_id,
      roomId: request.room_id,
      status: request.status,
      requestedAt: request.requested_at || '',
      reviewedAt: request.reviewed_at || ''
    }))
  };
}

function tenantRoom(tenant) {
  return records.rooms.find((room) => room.id === tenant.roomId);
}

function activeOccupancy(room) {
  return Number(room.occupiedBeds) || 0;
}

function roomStatus(room) {
  if (room.condition === 'Needs repair') return 'Needs repair';
  return activeOccupancy(room) >= room.beds ? 'Occupied' : 'Available';
}

function statusTone(status) {
  if (['Paid in full', 'Repaid', 'Available'].includes(status)) return 'success';
  if (['Overdue', 'Declined', 'Needs repair'].includes(status)) return 'danger';
  if (status === 'Occupied') return 'pending';
  if (['Due', 'Unpaid'].includes(status)) return 'warning';
  return 'pending';
}

function statusBadge(status) {
  return `<span class="status ${statusTone(status)}">${escapeHtml(status)}</span>`;
}

function renderRooms() {
  const availableCount = records.rooms.filter((room) => roomStatus(room) === 'Available').length;
  document.getElementById('available-room-count').textContent = `${availableCount} available · ${records.rooms.length} total`;
  const tenant = currentTenant;
  const pendingRequest = tenant && records.roomRequests.find((request) =>
    request.tenantId === tenant.id && request.status === 'Pending'
  );
  const feedback = document.getElementById('tenant-room-feedback');
  const resultText = pendingRequest
    ? `Your request for Room ${records.rooms.find((room) => room.id === pendingRequest.roomId)?.number || ''} is awaiting Owner approval.`
    : '';
  feedback.textContent = resultText;
  roomList.innerHTML = records.rooms.length
    ? records.rooms.map((room) => {
      const status = roomStatus(room);
      const isCurrentRoom = tenant?.roomId === room.id;
      const hasPendingForThisRoom = pendingRequest?.roomId === room.id;
      const canRequest = Boolean(tenant && tenant.status === 'Active') && status === 'Available' && !isCurrentRoom && !pendingRequest;
      const action = hasPendingForThisRoom
        ? '<span class="tenant-room-pending">Pending approval</span>'
        : canRequest
          ? '<span class="tenant-room-prompt">Select to request occupancy</span>'
          : isCurrentRoom
            ? '<span class="tenant-room-current">Your room</span>'
            : pendingRequest
              ? '<span class="tenant-room-note">Another request is pending</span>'
              : status === 'Occupied'
                ? '<span class="tenant-room-note">No vacancy</span>'
                : '<span class="tenant-room-note">Unavailable</span>';
      const requestAttributes = canRequest
        ? `data-request-room-id="${escapeHtml(room.id)}" tabindex="0" role="button" aria-label="Request occupancy in Room ${escapeHtml(room.number)}"`
        : '';
      const availability = status === 'Available' ? 'Vacancy' : status;
      return `<article class="room-card tenant-room-card" ${requestAttributes}><div class="room-card-top"><div><span class="room-card-label">ROOM</span><h3>${escapeHtml(room.number)}</h3></div>${statusBadge(status)}</div><div class="room-card-details"><div><span>TYPE</span><strong>${escapeHtml(room.type)}</strong></div><div><span>MONTHLY RENT</span><strong>${money(room.monthlyRent)} <small>/ month</small></strong></div></div><div class="room-card-footer"><span class="room-condition">${availability}</span>${action}</div></article>`;
    }).join('')
    : '<div class="room-grid-empty"><strong>No rooms to show</strong><span>Room listings will appear here when the Owner adds rooms.</span></div>';
}

function renderReminder(tenant, payment) {
  const today = new Date();
  const dueDate = new Date(today.getFullYear(), today.getMonth(), 3);
  const monthName = new Intl.DateTimeFormat(undefined, { month: 'long' }).format(today);

  document.getElementById('rent-month-label').textContent =
    `CURRENT MONTH · ${new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(today)}`;

  if (!tenant) {
    reminderTitle.textContent = 'Monthly rent reminder';
    reminderCopy.textContent = 'Rent is due on the 3rd of each month.';
    return;
  }
  if (payment?.status === 'Paid in full') {
    const nextDue = new Date(today.getFullYear(), today.getMonth() + 1, 3);
    reminderTitle.textContent = 'Rent payment recorded';
    reminderCopy.textContent = `Your ${monthName} rent is paid. Your next rent is due ${new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' }).format(nextDue)}.`;
    return;
  }
  if (payment?.status === 'Pending review') {
    reminderTitle.textContent = 'Payment awaiting review';
    reminderCopy.textContent = 'Your submitted rent proof is waiting for the Owner to review it.';
    return;
  }
  if (today.getDate() < 3) {
    const daysLeft = 3 - today.getDate();
    reminderTitle.textContent = 'Rent reminder';
    reminderCopy.textContent = `Your rent is due on the 3rd${daysLeft === 1 ? ' (tomorrow)' : ` (in ${daysLeft} days)`} of this month.`;
    return;
  }
  reminderTitle.textContent = 'Rent payment reminder';
  reminderCopy.textContent = `Rent was due on ${new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' }).format(dueDate)}. Current status: ${payment?.status || 'Unpaid'}.`;
}

function renderLoans(tenant) {
  const tenantLoans = tenant
    ? records.loans.filter((loan) => loan.borrowerId === tenant.id || loan.lenderId === tenant.id)
    : [];
  const possibleLenders = tenantDirectory.filter((candidate) => candidate.id !== tenant?.id);
  loanLenderPicker.innerHTML = '<option value="">Choose another tenant</option>';
  possibleLenders.forEach((candidate) => {
    const option = document.createElement('option');
    option.value = candidate.id;
    option.textContent = candidate.name;
    loanLenderPicker.append(option);
  });
  loanForm.hidden = !tenant || tenant.status !== 'Active';
  loanLenderPicker.disabled = possibleLenders.length === 0;
  loanForm.querySelector('button[type="submit"]').disabled = possibleLenders.length === 0;
  document.getElementById('tenant-loan-error').textContent = possibleLenders.length
    ? ''
    : 'At least one other active tenant is needed to request a loan.';
  document.getElementById('tenant-loan-count').textContent = `${tenantLoans.length} ${tenantLoans.length === 1 ? 'loan' : 'loans'}`;
  loanList.innerHTML = tenantLoans.length
    ? tenantLoans.map((loan) => {
      const isBorrower = loan.borrowerId === tenant.id;
      const otherTenantId = isBorrower ? loan.lenderId : loan.borrowerId;
      const otherTenant = records.tenants.find((record) => record.id === otherTenantId);
      const role = isBorrower ? 'Borrowed from' : 'Lent to';
      return `<div class="tenant-loan-item"><div><strong>${escapeHtml(role)} ${escapeHtml(otherTenant?.name || 'Former tenant')}</strong><small>Due ${escapeHtml(loan.dueDate || 'date not set')}</small></div><span class="tenant-loan-amount">${money(loan.amount)}<br>${statusBadge(loan.status)}</span></div>`;
    }).join('')
    : '<p class="tenant-empty">No loans to show.</p>';
}

function renderTenant() {
  const tenant = currentTenant;
  const payment = tenant
    ? records.payments.find((record) => record.tenantId === tenant.id && record.month === monthKey)
    : null;
  const room = tenant ? tenantRoom(tenant) : null;
  const selected = Boolean(tenant && tenant.status === 'Active');

  welcomeTitle.textContent = tenant ? `Welcome, ${tenant.name}` : 'Welcome to your tenant space';
  emptyMessage.hidden = selected;
  document.getElementById('rent-details').hidden = !selected;
  document.getElementById('rent-tenant-name').textContent = tenant?.name || 'Tenant profile unavailable';
  document.getElementById('rent-room').textContent = room ? `Room ${room.number}` : 'No room assigned';
  document.getElementById('rent-amount').textContent = tenant ? money(tenant.monthlyRent) : '—';
  document.getElementById('rent-paid').textContent = payment ? money(payment.amount) : 'No payment recorded';
  document.getElementById('rent-method').textContent = payment?.method || '—';
  document.getElementById('rent-paid-on').textContent = payment?.paidOn
    ? new Date(payment.paidOn).toLocaleString()
    : '—';
  paymentBadge.textContent = tenant ? payment?.status || 'Unpaid' : 'Select tenant';
  paymentBadge.className = `status ${tenant ? statusTone(payment?.status || 'Unpaid') : 'pending'}`;
  const paymentForm = document.getElementById('tenant-payment-form');
  const paymentSubmit = document.getElementById('tenant-payment-submit');
  const feedback = document.getElementById('tenant-submission-feedback');
  const canSubmit = selected && (!payment || ['Declined', 'Due', 'Overdue', 'Unpaid', 'Partial'].includes(payment.status));
  paymentSubmit.hidden = !selected;
  paymentForm.hidden = !canSubmit;
  paymentForm.elements.amount.value = tenant?.monthlyRent || '';
  const localNow = new Date();
  localNow.setMinutes(localNow.getMinutes() - localNow.getTimezoneOffset());
  paymentForm.elements.paidOn.value = localNow.toISOString().slice(0, 16);
  paymentForm.elements.proof.required = canSubmit;
  feedback.textContent = payment?.status === 'Pending review'
    ? 'Your proof has been submitted and is waiting for Owner review.'
    : payment?.status === 'Declined'
      ? 'Your last payment proof was declined. You can submit it again.'
      : payment?.status === 'Paid in full'
        ? 'Your rent payment has been approved.'
        : payment?.status === 'Partial'
          ? 'Your payment was reviewed as partial. Submit another payment proof for the remaining balance.'
          : '';
  document.getElementById('tenant-payment-error').textContent = '';

  if (tenant && tenant.status !== 'Active') {
    emptyMessage.hidden = false;
    emptyMessage.textContent = 'Your tenant account is inactive. Contact the Owner for help.';
  } else if (!tenant) {
    emptyMessage.hidden = false;
    emptyMessage.textContent = 'Your tenant profile could not be loaded. Contact the Owner for help.';
  }

  renderReminder(tenant, payment);
  renderLoans(tenant);
}

function compressProofImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Choose an image file for your payment proof.'));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      reject(new Error('The image must be 10 MB or smaller.'));
      return;
    }
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('This browser could not process the proof image.'));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
      if (dataUrl.length > 450_000) {
        reject(new Error('The proof image is too large after compression. Choose a smaller image.'));
        return;
      }
      resolve(dataUrl);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('The selected image could not be read.'));
    };
    image.src = objectUrl;
  });
}

paymentForm.addEventListener('change', (event) => {
  if (event.target.name !== 'method') return;
  const online = event.target.value === 'Online';
  document.getElementById('tenant-qr-placeholder').hidden = !online;
  document.getElementById('tenant-qr-hint').textContent = online
    ? 'Temporary QR placeholder — replace with your payment QR before use.'
    : 'Choose Online to view the payment QR placeholder.';
});

paymentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorMessage = document.getElementById('tenant-payment-error');
  const tenant = currentTenant;
  if (!tenant || tenant.status !== 'Active') {
    errorMessage.textContent = 'Your active tenant account is required to submit payment.';
    return;
  }

  const formData = new FormData(form);
  const amount = Number(formData.get('amount'));
  const paidOn = String(formData.get('paidOn'));
  const method = String(formData.get('method'));
  const proofFile = formData.get('proof');
  if (!Number.isFinite(amount) || amount <= 0 || !paidOn || !method || !(proofFile instanceof File) || proofFile.size === 0) {
    errorMessage.textContent = 'Enter the payment amount, method, date and time, and attach proof.';
    return;
  }

  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  errorMessage.textContent = '';
  submitButton.textContent = 'Submitting…';
  try {
    const proofImage = await compressProofImage(proofFile);
    const existingIndex = records.payments.findIndex((payment) =>
      payment.tenantId === tenant.id && payment.month === monthKey
    );
    const payload = {
      tenant_id: tenant.id,
      month: monthKey,
      amount,
      status: 'Pending review',
      paid_on: new Date(paidOn).toISOString(),
      method,
      proof_image: proofImage,
      reviewed_at: null
    };
    const { data, error } = await window.bordsSupabase
      .from('payments')
      .upsert(payload, { onConflict: 'tenant_id,month' })
      .select()
      .single();
    if (error) throw error;
    const payment = mapPayment(data);
    if (existingIndex >= 0) records.payments[existingIndex] = payment;
    else records.payments.push(payment);
    renderTenant();
  } catch (error) {
    errorMessage.textContent = `Could not submit payment proof: ${error.message}`;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Submit for review';
  }
});

loanForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const tenant = currentTenant;
  const errorMessage = document.getElementById('tenant-loan-error');
  const formData = new FormData(loanForm);
  const lenderId = String(formData.get('lenderId'));
  const amount = Number(formData.get('amount'));
  const dueDate = String(formData.get('dueDate'));
  if (!tenant || tenant.status !== 'Active' || !tenantDirectory.some((candidate) => candidate.id === lenderId && candidate.id !== tenant.id)) {
    errorMessage.textContent = 'Choose another active tenant for this loan request.';
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    errorMessage.textContent = 'Enter a loan amount greater than zero.';
    return;
  }
  if (records.loans.some((loan) =>
    loan.borrowerId === tenant.id && loan.lenderId === lenderId && loan.status === 'Pending'
  )) {
    errorMessage.textContent = 'You already have a pending request to this tenant.';
    return;
  }

  const submitButton = loanForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const { data, error } = await window.bordsSupabase
      .from('loans')
      .insert({
        borrower_id: tenant.id,
        lender_id: lenderId,
        amount,
        due_date: dueDate || null,
        status: 'Pending'
      })
      .select()
      .single();
    if (error) throw error;
    records.loans.push({
      id: data.id,
      borrowerId: data.borrower_id,
      lenderId: data.lender_id,
      amount: Number(data.amount),
      dueDate: data.due_date || '',
      status: data.status
    });
    loanForm.reset();
    renderTenant();
    document.getElementById('tenant-loan-error').textContent = 'Loan request sent to the Owner for review.';
  } catch (error) {
    errorMessage.textContent = `Could not save the loan request: ${error.message}`;
  } finally {
    submitButton.disabled = false;
  }
});

document.getElementById('tenant-today').textContent =
  new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date());

async function requestRoomOccupancy(roomId) {
  const tenant = currentTenant;
  const room = records.rooms.find((record) => record.id === roomId);
  const feedback = document.getElementById('tenant-room-feedback');
  if (!tenant || tenant.status !== 'Active' || !room || roomStatus(room) !== 'Available') {
    feedback.textContent = 'That room is no longer available. Refresh the page to see current availability.';
    return false;
  }
  if (tenant.roomId === room.id) {
    feedback.textContent = 'This is already your assigned room.';
    return false;
  }
  if (records.roomRequests.some((request) => request.tenantId === tenant.id && request.status === 'Pending')) {
    feedback.textContent = 'You already have a room request awaiting Owner approval.';
    renderRooms();
    return false;
  }

  try {
    const { data, error } = await window.bordsSupabase
      .from('room_requests')
      .insert({ tenant_id: tenant.id, room_id: room.id, status: 'Pending' })
      .select()
      .single();
    if (error) throw error;
    records.roomRequests.push({
      id: data.id,
      tenantId: data.tenant_id,
      roomId: data.room_id,
      status: data.status,
      requestedAt: data.requested_at || '',
      reviewedAt: data.reviewed_at || ''
    });
    renderRooms();
    feedback.textContent = `Your request for Room ${room.number} is waiting for Owner approval.`;
    return true;
  } catch (error) {
    feedback.textContent = `Could not save the room request: ${error.message}`;
    return false;
  }
}

roomList.addEventListener('click', async (event) => {
  const card = event.target.closest('[data-request-room-id]');
  if (card) await requestRoomOccupancy(card.dataset.requestRoomId);
});

roomList.addEventListener('keydown', async (event) => {
  const card = event.target.closest('[data-request-room-id]');
  if (!card || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  await requestRoomOccupancy(card.dataset.requestRoomId);
});

document.querySelectorAll('.tenant-app .nav-item').forEach((link) => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.tenant-app .nav-item').forEach((item) => item.classList.remove('active'));
    link.classList.add('active');
  });
});

document.getElementById('tenant-logout-button').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const { error } = await window.bordsSupabase.auth.signOut();
    if (error) throw error;
    window.location.replace('index.html');
  } catch (error) {
    button.disabled = false;
    tenantError.textContent = `Could not sign out: ${error.message}`;
  }
});

async function startTenantPortal() {
  tenantError.textContent = 'Connecting to your tenant account…';
  try {
    const { data, error } = await window.bordsSupabase.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      window.location.replace('index.html');
      return;
    }
    if (data.session.user.app_metadata.role !== 'tenant') {
      const { error: signOutError } = await window.bordsSupabase.auth.signOut();
      if (signOutError) throw signOutError;
      window.location.replace('index.html');
      return;
    }
    await loadTenantData(data.session.user);
    document.getElementById('tenant-account-name').textContent = currentTenant.name;
    tenantError.textContent = '';
    renderRooms();
    renderTenant();
  } catch (error) {
    tenantError.textContent = `Could not load tenant data: ${error.message}`;
  }
}

startTenantPortal();
