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
let isRequestingRoom = false;

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
  let tenant = null;

  // 1. Try to find tenant record by user_id
  const { data: tenantByUid, error: uidError } = await window.bordsSupabase
    .from('tenants')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (tenantByUid) {
    tenant = tenantByUid;
  } else if (user.email) {
    // 2. Try to find tenant record by email
    const { data: tenantByEmail, error: emailError } = await window.bordsSupabase
      .from('tenants')
      .select('*')
      .ilike('email', user.email.trim())
      .maybeSingle();

    if (tenantByEmail) {
      tenant = tenantByEmail;
      // Link user_id to this record
      if (!tenant.user_id) {
        try {
          await window.bordsSupabase
            .from('tenants')
            .update({ user_id: user.id })
            .eq('id', tenant.id);
          tenant.user_id = user.id;
        } catch (linkErr) {
          console.warn('Could not update tenant user_id link:', linkErr.message);
        }
      }
    }
  }

  // 3. Fallback: If still no tenant record, auto-create one
  if (!tenant) {
    const fullName = user.user_metadata?.full_name || (user.email ? user.email.split('@')[0] : 'Tenant');
    const phone = user.user_metadata?.phone || '';
    const newRecord = {
      id: crypto.randomUUID(),
      name: fullName,
      email: user.email,
      phone,
      room_id: null,
      monthly_rent: 0,
      status: 'Active',
      user_id: user.id
    };

    try {
      const { data: insertedTenant, error: insertError } = await window.bordsSupabase
        .from('tenants')
        .insert([newRecord])
        .select()
        .single();
      if (!insertError && insertedTenant) {
        tenant = insertedTenant;
      } else {
        tenant = newRecord;
      }
    } catch (e) {
      tenant = newRecord;
    }
  }

  const [roomsResult, paymentsResult, loansResult, requestsResult, directoryResult] = await Promise.all([
    window.bordsSupabase.from('room_availability').select('*').order('number'),
    window.bordsSupabase.from('payments').select('*').eq('tenant_id', tenant.id).order('month', { ascending: false }),
    window.bordsSupabase.from('loans').select('*').or(`borrower_id.eq.${tenant.id},lender_id.eq.${tenant.id}`),
    window.bordsSupabase.from('room_requests').select('*').eq('tenant_id', tenant.id),
    window.bordsSupabase.from('tenant_directory').select('id, name').order('name')
  ]);

  const meta = user.user_metadata || {};
  const emailPrefix = (user.email || tenant.email || '').split('@')[0].trim().toLowerCase();

  // Local storage cache for zero-latency persistence across tab reloads
  let localCache = null;
  try {
    const rawCache = localStorage.getItem(`bords_tenant_profile_${user.id}`);
    if (rawCache) localCache = JSON.parse(rawCache);
  } catch (e) {}

  // Name Resolution:
  // If tenant.name is missing or is just the default email username (e.g. 'jsenil45'),
  // prefer the user's explicit saved full name from auth user metadata or local cache.
  const tenantRawName = (tenant.name || '').trim();
  const metaFullName = (meta.full_name || meta.name || localCache?.name || '').trim();
  let resolvedName = '';

  if (metaFullName && (!tenantRawName || tenantRawName.toLowerCase() === emailPrefix)) {
    resolvedName = metaFullName;
  } else if (tenantRawName && tenantRawName.toLowerCase() !== emailPrefix) {
    resolvedName = tenantRawName;
  } else if (metaFullName) {
    resolvedName = metaFullName;
  } else {
    resolvedName = tenantRawName || emailPrefix || 'Tenant';
  }

  currentTenant = {
    id: tenant.id,
    name: resolvedName,
    email: tenant.email || user.email || '',
    phone: tenant.phone || meta.phone || localCache?.phone || '',
    age: (tenant.age != null && tenant.age !== '') ? Number(tenant.age) : ((meta.age != null && meta.age !== '') ? Number(meta.age) : ((localCache?.age != null && localCache?.age !== '') ? Number(localCache.age) : '')),
    gender: tenant.gender || meta.gender || localCache?.gender || '',
    address: tenant.address || meta.address || localCache?.address || '',
    occupation: tenant.occupation || meta.occupation || localCache?.occupation || '',
    emergencyContactName: tenant.emergency_contact_name || meta.emergency_contact_name || localCache?.emergencyContactName || '',
    emergencyContactPhone: tenant.emergency_contact_phone || meta.emergency_contact_phone || localCache?.emergencyContactPhone || '',
    roomId: tenant.room_id || '',
    monthlyRent: Number(tenant.monthly_rent) || 0,
    status: tenant.status || 'Active',
    user_id: tenant.user_id || user.id
  };

  // Self-heal public.tenants: sync resolved real name and user_id to database row
  if (tenant && (tenant.name !== resolvedName || !tenant.user_id)) {
    tenant.name = resolvedName;
    tenant.user_id = user.id;
    window.bordsSupabase
      .from('tenants')
      .update({ name: resolvedName, user_id: user.id })
      .eq('id', tenant.id)
      .then(() => {})
      .catch((err) => {
        console.warn('Could not auto-heal tenant record in database:', err.message);
      });
  }

  tenantDirectory = directoryResult.data || [];
  records = {
    tenants: [currentTenant, ...tenantDirectory.filter((entry) => entry.id !== currentTenant.id)],
    rooms: (roomsResult.data || []).map((room) => ({
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
  const countEl = document.getElementById('available-room-count');
  if (countEl) countEl.textContent = `${availableCount} available · ${records.rooms.length} total`;

  const tenant = currentTenant;
  const pendingRequest = tenant && records.roomRequests.find((request) =>
    request.tenantId === tenant.id && request.status === 'Pending'
  );
  const feedback = document.getElementById('tenant-room-feedback');
  if (feedback) {
    feedback.textContent = pendingRequest
      ? `Your request for Room ${records.rooms.find((room) => room.id === pendingRequest.roomId)?.number || ''} is awaiting Owner approval.`
      : '';
  }

  if (!roomList) return;
  roomList.innerHTML = records.rooms.length
    ? records.rooms.map((room) => {
      const status = roomStatus(room);
      const isCurrentRoom = tenant?.roomId === room.id;
      const hasPendingForThisRoom = pendingRequest?.roomId === room.id;
      const canRequest = Boolean(tenant) && status === 'Available' && !isCurrentRoom && !pendingRequest;
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

  const rentMonthLabel = document.getElementById('rent-month-label');
  if (rentMonthLabel) {
    rentMonthLabel.textContent =
      `CURRENT MONTH · ${new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(today)}`;
  }

  if (!tenant || !tenant.roomId) {
    reminderTitle.textContent = 'Welcome to Bords';
    reminderCopy.textContent = 'Select an available room below to submit your room occupancy request.';
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
  
  if (loanLenderPicker) {
    loanLenderPicker.innerHTML = '<option value="">Choose another tenant</option>';
    possibleLenders.forEach((candidate) => {
      const option = document.createElement('option');
      option.value = candidate.id;
      option.textContent = candidate.name;
      loanLenderPicker.append(option);
    });
    loanLenderPicker.disabled = possibleLenders.length === 0;
  }

  if (loanForm) {
    loanForm.hidden = !tenant;
    const submitBtn = loanForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = possibleLenders.length === 0;
  }

  const loanError = document.getElementById('tenant-loan-error');
  if (loanError) {
    loanError.textContent = possibleLenders.length
      ? ''
      : 'At least one other active tenant is needed to request a loan.';
  }

  const loanCount = document.getElementById('tenant-loan-count');
  if (loanCount) loanCount.textContent = `${tenantLoans.length} ${tenantLoans.length === 1 ? 'loan' : 'loans'}`;

  if (loanList) {
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
}

function renderTenant() {
  const tenant = currentTenant;
  const payment = tenant
    ? records.payments.find((record) => record.tenantId === tenant.id && record.month === monthKey)
    : null;
  const room = tenant ? tenantRoom(tenant) : null;
  const hasRoom = Boolean(tenant && tenant.roomId);

  welcomeTitle.textContent = tenant ? `Welcome, ${tenant.name}` : 'Welcome to your tenant space';
  
  if (emptyMessage) {
    emptyMessage.hidden = hasRoom;
    if (!hasRoom) {
      emptyMessage.textContent = 'You have not been assigned a room yet. Please browse the available rooms below and select one to request occupancy.';
    }
  }

  const rentDetails = document.getElementById('rent-details');
  if (rentDetails) rentDetails.hidden = false;

  const rentTenantName = document.getElementById('rent-tenant-name');
  if (rentTenantName) rentTenantName.textContent = tenant?.name || 'Tenant profile';

  const rentRoom = document.getElementById('rent-room');
  if (rentRoom) rentRoom.textContent = room ? `Room ${room.number}` : 'No room assigned';

  const rentAmount = document.getElementById('rent-amount');
  if (rentAmount) rentAmount.textContent = hasRoom ? money(tenant.monthlyRent) : '₱0 (No room)';

  const rentPaid = document.getElementById('rent-paid');
  if (rentPaid) rentPaid.textContent = payment ? money(payment.amount) : 'No payment recorded';

  const rentMethod = document.getElementById('rent-method');
  if (rentMethod) rentMethod.textContent = payment?.method || '—';

  const rentPaidOn = document.getElementById('rent-paid-on');
  if (rentPaidOn) {
    rentPaidOn.textContent = payment?.paidOn
      ? new Date(payment.paidOn).toLocaleString()
      : '—';
  }

  if (paymentBadge) {
    paymentBadge.textContent = payment ? payment.status : (hasRoom ? 'Unpaid' : 'No room');
    paymentBadge.className = `status ${payment ? statusTone(payment.status) : (hasRoom ? 'warning' : 'pending')}`;
  }

  const paymentSubmit = document.getElementById('tenant-payment-submit');
  const paymentForm = document.getElementById('tenant-payment-form');
  const feedback = document.getElementById('tenant-submission-feedback');
  const canSubmit = hasRoom && (!payment || ['Declined', 'Due', 'Overdue', 'Unpaid', 'Partial'].includes(payment.status));
  const isPartial = payment?.status === 'Partial';
  const remainingBalance = isPartial ? Math.max(0, (tenant?.monthlyRent || 0) - (payment?.amount || 0)) : (tenant?.monthlyRent || 0);

  if (paymentSubmit) paymentSubmit.hidden = !hasRoom;
  if (paymentForm) {
    paymentForm.hidden = !canSubmit;
    if (paymentForm.elements.amount) paymentForm.elements.amount.value = remainingBalance || '';
    const localNow = new Date();
    localNow.setMinutes(localNow.getMinutes() - localNow.getTimezoneOffset());
    if (paymentForm.elements.paidOn) paymentForm.elements.paidOn.value = localNow.toISOString().slice(0, 16);
    const selectedMethod = paymentForm.elements.method?.value;
    if (paymentForm.elements.proof) paymentForm.elements.proof.required = canSubmit && selectedMethod !== 'Cash';
    const noteEl = paymentForm.querySelector('.tenant-payment-note');
    if (noteEl) {
      noteEl.textContent = isPartial
        ? `Previous payment of ${money(payment.amount)} was recorded. Paying ${money(remainingBalance)} completes your rent for this month.`
        : 'Your payment stays pending until the Owner reviews it.';
    }
  }

  if (feedback) {
    feedback.textContent = payment?.status === 'Pending review'
      ? 'Your proof has been submitted and is waiting for Owner review.'
      : payment?.status === 'Declined'
        ? 'Your last payment proof was declined. You can submit it again.'
        : payment?.status === 'Paid in full'
          ? 'Your rent payment has been approved.'
          : payment?.status === 'Partial'
            ? `Your payment was reviewed as partial (${money(payment.amount)} paid). Submit your payment for the remaining ${money(remainingBalance)} balance.`
            : '';
  }

  const paymentError = document.getElementById('tenant-payment-error');
  if (paymentError) paymentError.textContent = '';

  renderReminder(tenant, payment);
  renderLoans(tenant);
  renderProfile(tenant);
}

function renderProfile(tenant = currentTenant) {
  if (!tenant) return;

  const initial = (tenant.name || tenant.email || 'T').trim().charAt(0).toUpperCase();

  // Topbar user badge
  const topAvatar = document.getElementById('tenant-top-avatar');
  if (topAvatar) topAvatar.textContent = initial || 'T';

  const accountNameEl = document.getElementById('tenant-account-name');
  if (accountNameEl) accountNameEl.textContent = tenant.name || 'Tenant';

  // Profile Hero
  const heroAvatar = document.getElementById('tenant-profile-avatar');
  if (heroAvatar) heroAvatar.textContent = initial || 'T';

  const displayName = document.getElementById('tenant-profile-display-name');
  if (displayName) displayName.textContent = tenant.name || 'Tenant';

  const displayEmail = document.getElementById('tenant-profile-display-email');
  if (displayEmail) displayEmail.textContent = tenant.email || '—';

  const room = tenantRoom(tenant);
  const statRoom = document.getElementById('profile-stat-room');
  if (statRoom) statRoom.textContent = room ? `Room ${room.number} (${room.type})` : 'No room assigned';

  const statRent = document.getElementById('profile-stat-rent');
  if (statRent) statRent.textContent = tenant.roomId ? `${money(tenant.monthlyRent)} / month` : '₱0 (No room)';

  // Hero Quick Stat Pills (Age, Gender, Occupation)
  const ageGenderParts = [];
  if (tenant.age != null && tenant.age !== '') ageGenderParts.push(`${tenant.age} yrs`);
  if (tenant.gender) ageGenderParts.push(tenant.gender);

  const heroAgeGenderPill = document.getElementById('profile-hero-age-gender-pill');
  const heroAgeGender = document.getElementById('profile-hero-age-gender');
  if (heroAgeGenderPill && heroAgeGender) {
    const ageGenderText = ageGenderParts.join(' · ');
    heroAgeGender.textContent = ageGenderText;
    heroAgeGenderPill.hidden = !ageGenderText;
  }

  const heroOccPill = document.getElementById('profile-hero-occ-pill');
  const heroOcc = document.getElementById('profile-hero-occupation');
  if (heroOccPill && heroOcc) {
    heroOcc.textContent = tenant.occupation || '';
    heroOccPill.hidden = !tenant.occupation;
  }

  // Editable Form Inputs (do not overwrite if currently focused by user)
  const fields = [
    { id: 'profile-name', val: tenant.name || '' },
    { id: 'profile-age', val: tenant.age != null ? tenant.age : '' },
    { id: 'profile-gender', val: tenant.gender || '' },
    { id: 'profile-occupation', val: tenant.occupation || '' },
    { id: 'profile-phone', val: tenant.phone || '' },
    { id: 'profile-address', val: tenant.address || '' },
    { id: 'profile-emergency-name', val: tenant.emergencyContactName || '' },
    { id: 'profile-emergency-phone', val: tenant.emergencyContactPhone || '' }
  ];

  fields.forEach(({ id, val }) => {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) {
      el.value = val;
    }
  });

  // Official Records Card Grid
  const profileEmailVal = document.getElementById('profile-email-val');
  if (profileEmailVal) profileEmailVal.textContent = tenant.email || '—';

  const roomVal = document.getElementById('profile-room');
  if (roomVal) roomVal.textContent = room ? `Room ${room.number} · ${room.type}` : 'No room assigned';

  const rentVal = document.getElementById('profile-rent');
  if (rentVal) rentVal.textContent = tenant.roomId ? `${money(tenant.monthlyRent)} / month` : '₱0 (No room)';

  const ageGenderVal = document.getElementById('profile-age-gender-val');
  if (ageGenderVal) {
    ageGenderVal.textContent = ageGenderParts.length ? ageGenderParts.join(' · ') : 'Not specified';
  }

  const occVal = document.getElementById('profile-occupation-val');
  if (occVal) {
    occVal.textContent = tenant.occupation || 'Not specified';
  }

  const addrVal = document.getElementById('profile-address-val');
  if (addrVal) {
    addrVal.textContent = tenant.address || 'Not specified';
  }

  const emergencyVal = document.getElementById('profile-emergency-val');
  if (emergencyVal) {
    const emParts = [];
    if (tenant.emergencyContactName) emParts.push(tenant.emergencyContactName);
    if (tenant.emergencyContactPhone) emParts.push(tenant.emergencyContactPhone);
    emergencyVal.textContent = emParts.length ? emParts.join(' · ') : 'Not specified';
  }

  const roleBadge = document.getElementById('profile-role-badge');
  if (roleBadge) {
    roleBadge.textContent = tenant.status === 'Active' ? 'Active Tenant' : (tenant.status || 'Tenant');
  }
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

if (paymentForm) {
  paymentForm.addEventListener('change', (event) => {
    if (event.target.name !== 'method') return;
    const isOnline = event.target.value === 'Online';
    const isCash = event.target.value === 'Cash';
    const qrEl = document.getElementById('tenant-qr-placeholder');
    const hintEl = document.getElementById('tenant-qr-hint');
    if (qrEl) qrEl.hidden = !isOnline;
    if (hintEl) {
      hintEl.textContent = isOnline
        ? 'Temporary QR placeholder — replace with your payment QR before use.'
        : (isCash ? 'Cash payment: Picture proof is optional.' : 'Choose Online to view the payment QR placeholder.');
    }
    if (paymentForm.elements.proof) {
      paymentForm.elements.proof.required = !isCash;
    }
  });

  paymentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const errorMessage = document.getElementById('tenant-payment-error');
    const tenant = currentTenant;
    if (!tenant || !tenant.roomId) {
      if (errorMessage) errorMessage.textContent = 'You must have an assigned room to submit rent payment.';
      return;
    }

    const formData = new FormData(form);
    const amount = Number(formData.get('amount'));
    const paidOn = String(formData.get('paidOn'));
    const method = String(formData.get('method'));
    const proofFile = formData.get('proof');
    const isCash = method === 'Cash';
    const hasProof = (proofFile instanceof File) && proofFile.size > 0;

    if (!Number.isFinite(amount) || amount <= 0 || !paidOn || !method) {
      if (errorMessage) errorMessage.textContent = 'Enter the payment amount, method, and date and time.';
      return;
    }
    if (!isCash && !hasProof) {
      if (errorMessage) errorMessage.textContent = 'Please attach picture proof of payment for online or bank transfer.';
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    if (errorMessage) errorMessage.textContent = '';
    submitButton.textContent = 'Submitting…';
    try {
      let proofImage = null;
      if (hasProof) {
        proofImage = await compressProofImage(proofFile);
      }
      const existingPayment = records.payments.find((payment) =>
        payment.tenantId === tenant.id && payment.month === monthKey
      );
      const existingIndex = records.payments.findIndex((payment) =>
        payment.tenantId === tenant.id && payment.month === monthKey
      );
      // If previous payment was Partial, accumulate towards total rent
      const recordedAmount = (existingPayment && existingPayment.status === 'Partial')
        ? (amount >= tenant.monthlyRent ? amount : (Number(existingPayment.amount) + amount))
        : amount;

      const payload = {
        tenant_id: tenant.id,
        month: monthKey,
        amount: recordedAmount,
        status: 'Pending review',
        paid_on: new Date(paidOn).toISOString(),
        method,
        proof_image: proofImage || existingPayment?.proofImage || null,
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
      if (errorMessage) errorMessage.textContent = `Could not submit payment: ${error.message}`;
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Submit for review';
    }
  });
}

if (loanForm) {
  loanForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const tenant = currentTenant;
    const errorMessage = document.getElementById('tenant-loan-error');
    const formData = new FormData(loanForm);
    const lenderId = String(formData.get('lenderId'));
    const amount = Number(formData.get('amount'));
    const dueDate = String(formData.get('dueDate'));
    if (!tenant || !tenantDirectory.some((candidate) => candidate.id === lenderId && candidate.id !== tenant.id)) {
      if (errorMessage) errorMessage.textContent = 'Choose another active tenant for this loan request.';
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      if (errorMessage) errorMessage.textContent = 'Enter a loan amount greater than zero.';
      return;
    }
    if (records.loans.some((loan) =>
      loan.borrowerId === tenant.id && loan.lenderId === lenderId && loan.status === 'Pending'
    )) {
      if (errorMessage) errorMessage.textContent = 'You already have a pending request to this tenant.';
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
      if (errorMessage) errorMessage.textContent = 'Loan request sent to the Owner for review.';
    } catch (error) {
      if (errorMessage) errorMessage.textContent = `Could not save the loan request: ${error.message}`;
    } finally {
      submitButton.disabled = false;
    }
  });
}

const profileForm = document.getElementById('tenant-profile-form');
const profileFeedback = document.getElementById('tenant-profile-feedback');
const tenantUserBadge = document.getElementById('tenant-user-badge');

function switchTenantTab(tabKey) {
  const tabs = {
    rent: document.getElementById('rent-status'),
    rooms: document.getElementById('available-rooms'),
    loans: document.getElementById('tenant-loans'),
    profile: document.getElementById('tenant-profile')
  };
  const reminder = document.getElementById('rent-reminder');

  if (!tabs[tabKey]) tabKey = 'rent';

  // 1. Update tab navigation buttons
  document.querySelectorAll('.tenant-nav-tab').forEach((btn) => {
    const isActive = btn.dataset.tab === tabKey;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });

  // 2. Hide / show panels
  Object.entries(tabs).forEach(([key, panel]) => {
    if (panel) panel.hidden = (key !== tabKey);
  });

  // 3. Show reminder banner on rent tab only
  if (reminder) reminder.hidden = (tabKey !== 'rent');

  // 4. Update welcome header copy
  const welcomeSection = document.querySelector('.tenant-welcome');
  const welcomeSubtitle = welcomeSection?.querySelector('p');
  const panelLabel = welcomeSection?.querySelector('.panel-label');

  if (panelLabel && welcomeSubtitle) {
    if (tabKey === 'rent') {
      panelLabel.textContent = 'TENANT SPACE · RENT';
      welcomeSubtitle.textContent = 'View your monthly rent status, payment schedule, and submit receipts.';
    } else if (tabKey === 'rooms') {
      panelLabel.textContent = 'TENANT SPACE · ROOMS';
      welcomeSubtitle.textContent = 'Browse available boarding house rooms and submit occupancy requests.';
    } else if (tabKey === 'loans') {
      panelLabel.textContent = 'TENANT SPACE · LOANS';
      welcomeSubtitle.textContent = 'Manage micro-loans between housemates and review status.';
    } else if (tabKey === 'profile') {
      panelLabel.textContent = 'TENANT SPACE · PROFILE';
      welcomeSubtitle.textContent = 'Manage your name, phone number, and boarding house tenancy record.';
    }
  }

  // 5. Update browser hash history smoothly
  if (window.location.hash !== `#${tabKey}`) {
    history.replaceState(null, '', `#${tabKey}`);
  }

  // 6. Autofocus name input if opening profile tab
  if (tabKey === 'profile') {
    const nameInput = document.getElementById('profile-name');
    if (nameInput) setTimeout(() => nameInput.focus(), 150);
  }
}

document.querySelectorAll('.tenant-nav-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    switchTenantTab(btn.dataset.tab);
  });
});

if (tenantUserBadge) {
  tenantUserBadge.addEventListener('click', () => {
    switchTenantTab('profile');
  });
}

window.addEventListener('hashchange', () => {
  const hash = window.location.hash ? window.location.hash.replace('#', '').toLowerCase() : '';
  const validTabs = ['rent', 'rooms', 'loans', 'profile'];
  if (validTabs.includes(hash)) switchTenantTab(hash);
});

if (profileForm) {
  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const tenant = currentTenant;
    if (!tenant) return;

    const formData = new FormData(profileForm);
    const newName = String(formData.get('name') || '').trim();
    const newAgeRaw = String(formData.get('age') || '').trim();
    const newAge = newAgeRaw ? parseInt(newAgeRaw, 10) : null;
    const newGender = String(formData.get('gender') || '').trim();
    const newOccupation = String(formData.get('occupation') || '').trim();
    const newPhone = String(formData.get('phone') || '').trim();
    const newAddress = String(formData.get('address') || '').trim();
    const newEmergencyName = String(formData.get('emergencyContactName') || '').trim();
    const newEmergencyPhone = String(formData.get('emergencyContactPhone') || '').trim();

    if (!newName) {
      if (profileFeedback) {
        profileFeedback.textContent = 'Please enter your full name.';
        profileFeedback.className = 'tenant-profile-feedback is-error';
      }
      return;
    }

    if (newAge !== null && (isNaN(newAge) || newAge < 1 || newAge > 120)) {
      if (profileFeedback) {
        profileFeedback.textContent = 'Please enter a valid age between 1 and 120.';
        profileFeedback.className = 'tenant-profile-feedback is-error';
      }
      return;
    }

    const saveButton = document.getElementById('profile-save-button');
    if (saveButton) saveButton.disabled = true;
    if (profileFeedback) {
      profileFeedback.textContent = 'Saving changes…';
      profileFeedback.className = 'tenant-profile-feedback';
    }

    try {
      const { data: sessionData } = await window.bordsSupabase.auth.getSession();
      const authUser = sessionData?.session?.user;
      const currentUserId = authUser?.id || tenant.user_id;

      // 1. Instant Cache to localStorage for zero-latency persistence
      if (currentUserId) {
        try {
          localStorage.setItem(`bords_tenant_profile_${currentUserId}`, JSON.stringify({
            name: newName,
            phone: newPhone,
            age: newAge,
            gender: newGender,
            address: newAddress,
            occupation: newOccupation,
            emergencyContactName: newEmergencyName,
            emergencyContactPhone: newEmergencyPhone
          }));
        } catch (storageErr) {
          console.warn('Could not cache profile locally:', storageErr.message);
        }
      }

      // 2. Update public.tenants table (including user_id to ensure permanent linking)
      const fullPayload = {
        name: newName,
        phone: newPhone,
        age: newAge,
        gender: newGender,
        address: newAddress,
        occupation: newOccupation,
        emergency_contact_name: newEmergencyName,
        emergency_contact_phone: newEmergencyPhone
      };
      if (currentUserId) fullPayload.user_id = currentUserId;

      const { error: fullUpdateErr } = await window.bordsSupabase
        .from('tenants')
        .update(fullPayload)
        .eq('id', tenant.id);

      if (fullUpdateErr) {
        // Fallback to base columns if optional columns do not exist in table
        console.warn('Could not update all tenant columns, saving base columns:', fullUpdateErr.message);
        const basePayload = { name: newName, phone: newPhone };
        if (currentUserId) basePayload.user_id = currentUserId;
        await window.bordsSupabase
          .from('tenants')
          .update(basePayload)
          .eq('id', tenant.id);
      }

      // 3. Call RPC if available
      try {
        const { error: rpcErr } = await window.bordsSupabase.rpc('update_tenant_profile', {
          p_name: newName,
          p_phone: newPhone,
          p_age: newAge,
          p_gender: newGender,
          p_address: newAddress,
          p_occupation: newOccupation,
          p_emergency_contact_name: newEmergencyName,
          p_emergency_contact_phone: newEmergencyPhone
        });
        if (rpcErr) {
          await window.bordsSupabase.rpc('update_tenant_profile', {
            p_name: newName,
            p_phone: newPhone
          });
        }
      } catch (rpcErr) {
        // Silent fallback
      }

      // 4. Sync to Supabase Auth user metadata (saving both full_name & name)
      try {
        const { data: updatedAuthUser, error: authErr } = await window.bordsSupabase.auth.updateUser({
          data: {
            full_name: newName,
            name: newName,
            phone: newPhone,
            age: newAge,
            gender: newGender,
            address: newAddress,
            occupation: newOccupation,
            emergency_contact_name: newEmergencyName,
            emergency_contact_phone: newEmergencyPhone
          }
        });
        if (!authErr && updatedAuthUser?.user) {
          if (authUser) authUser.user_metadata = updatedAuthUser.user.user_metadata;
        }
      } catch (authErr) {
        console.warn('Could not sync user metadata:', authErr.message);
      }

      // 4. Update local state
      currentTenant.name = newName;
      currentTenant.phone = newPhone;
      currentTenant.age = newAge;
      currentTenant.gender = newGender;
      currentTenant.address = newAddress;
      currentTenant.occupation = newOccupation;
      currentTenant.emergencyContactName = newEmergencyName;
      currentTenant.emergencyContactPhone = newEmergencyPhone;

      const dirEntry = tenantDirectory.find((t) => t.id === tenant.id);
      if (dirEntry) dirEntry.name = newName;
      const recEntry = records.tenants.find((t) => t.id === tenant.id);
      if (recEntry) {
        recEntry.name = newName;
        recEntry.phone = newPhone;
        recEntry.age = newAge;
        recEntry.gender = newGender;
        recEntry.address = newAddress;
        recEntry.occupation = newOccupation;
        recEntry.emergencyContactName = newEmergencyName;
        recEntry.emergencyContactPhone = newEmergencyPhone;
      }

      // 5. Update UI displays across the page
      renderTenant();
      renderProfile(currentTenant);

      if (profileFeedback) {
        profileFeedback.textContent = '✓ Profile details saved successfully!';
        profileFeedback.className = 'tenant-profile-feedback is-success';
        setTimeout(() => {
          if (profileFeedback && profileFeedback.textContent.includes('saved successfully')) {
            profileFeedback.textContent = '';
          }
        }, 4000);
      }
    } catch (error) {
      if (profileFeedback) {
        profileFeedback.textContent = `Could not update profile: ${error.message}`;
        profileFeedback.className = 'tenant-profile-feedback is-error';
      }
    } finally {
      if (saveButton) saveButton.disabled = false;
    }
  });
}

const todayEl = document.getElementById('tenant-today');
if (todayEl) {
  todayEl.textContent = new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  }).format(new Date());
}

async function requestRoomOccupancy(roomId) {
  if (isRequestingRoom) return false;
  const tenant = currentTenant;
  const room = records.rooms.find((record) => record.id === roomId);
  const feedback = document.getElementById('tenant-room-feedback');

  if (!tenant || !room || roomStatus(room) !== 'Available') {
    if (feedback) feedback.textContent = 'That room is no longer available. Refresh the page to see current availability.';
    return false;
  }
  if (tenant.roomId === room.id) {
    if (feedback) feedback.textContent = 'This is already your assigned room.';
    return false;
  }
  if (records.roomRequests.some((request) => request.tenantId === tenant.id && request.status === 'Pending')) {
    if (feedback) feedback.textContent = 'You already have a room request awaiting Owner approval.';
    renderRooms();
    return false;
  }

  isRequestingRoom = true;
  if (feedback) feedback.textContent = `Requesting Room ${room.number}…`;

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
    if (feedback) feedback.textContent = `Your request for Room ${room.number} is waiting for Owner approval.`;
    return true;
  } catch (error) {
    if (feedback) feedback.textContent = `Could not save room request: ${error.message}`;
    return false;
  } finally {
    isRequestingRoom = false;
  }
}

if (roomList) {
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
}


const logoutBtn = document.getElementById('tenant-logout-button');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { error } = await window.bordsSupabase.auth.signOut();
      if (error) throw error;
      window.location.replace('index.html');
    } catch (error) {
      button.disabled = false;
      if (tenantError) tenantError.textContent = `Could not sign out: ${error.message}`;
    }
  });
}

async function startTenantPortal() {
  if (tenantError) tenantError.textContent = 'Connecting to your tenant account…';
  try {
    const { data, error } = await window.bordsSupabase.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      window.location.replace('index.html');
      return;
    }

    const user = data.session.user;
    if (user.app_metadata?.role === 'owner') {
      window.location.replace('owner.html');
      return;
    }

    // Attempt RPC self-heal to ensure role is tenant
    if (user.app_metadata?.role !== 'tenant') {
      try {
        await window.bordsSupabase.rpc('ensure_tenant_profile');
        await window.bordsSupabase.auth.refreshSession();
      } catch (rpcErr) {
        // Fallback
      }
    }

    // Retrieve fresh auth user to guarantee up-to-date user_metadata
    let currentAuthUser = user;
    try {
      const { data: freshUserData } = await window.bordsSupabase.auth.getUser();
      if (freshUserData?.user) currentAuthUser = freshUserData.user;
    } catch (userErr) {
      // Fallback to session user
    }

    await loadTenantData(currentAuthUser);
    const accountNameEl = document.getElementById('tenant-account-name');
    if (accountNameEl && currentTenant) accountNameEl.textContent = currentTenant.name;
    if (tenantError) tenantError.textContent = '';
    renderRooms();
    renderTenant();

    const initialHash = window.location.hash ? window.location.hash.replace('#', '').toLowerCase() : '';
    const validTabs = ['rent', 'rooms', 'loans', 'profile'];
    switchTenantTab(validTabs.includes(initialHash) ? initialHash : 'rent');
  } catch (error) {
    if (tenantError) tenantError.textContent = `Could not load tenant data: ${error.message}`;
  }
}

startTenantPortal();
