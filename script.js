const pageTitle = document.getElementById('page-title');
const navButtons = [...document.querySelectorAll('[data-nav]')];
const todayLabel = document.getElementById('today-label');
const viewRoot = document.getElementById('view-root');
const entryDialog = document.getElementById('entry-dialog');
const entryForm = document.getElementById('entry-form');
const toastRegion = document.getElementById('toast-region');
const searchInput = document.getElementById('owner-search-input');
const quickAddBtn = document.getElementById('quick-add-btn');
const quickAddDropdown = document.getElementById('quick-add-dropdown');
const tenantDetailDialog = document.getElementById('tenant-detail-dialog');
const tenantModalContent = document.getElementById('tenant-modal-content');
const tenantModalName = document.getElementById('tenant-modal-name');

const navTitles = { overview: 'Overview', tenants: 'Tenants', rooms: 'Rooms', rent: 'Rent payments', loans: 'Loans' };
const today = new Date();
const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
const databaseCollections = [
  { key: 'rooms', table: 'rooms' },
  { key: 'tenants', table: 'tenants' },
  { key: 'payments', table: 'payments' },
  { key: 'loans', table: 'loans' },
  { key: 'roomRequests', table: 'room_requests' }
];

let searchQuery = '';

function makeId() {
  return crypto.randomUUID();
}

function emptyRecords() {
  return { tenants: [], rooms: [], payments: [], loans: [], roomRequests: [] };
}

let records = emptyRecords();
let currentView = 'overview';

function fromDatabaseRow(collection, row) {
  if (collection === 'rooms') {
    return {
      id: row.id,
      number: row.number,
      type: row.type,
      beds: row.beds,
      monthlyRent: Number(row.monthly_rent),
      condition: row.condition
    };
  }
  if (collection === 'tenants') {
    return {
      id: row.id,
      name: row.name,
      email: row.email || '',
      accountUserId: row.user_id || null,
      phone: row.phone || '',
      roomId: row.room_id || '',
      monthlyRent: Number(row.monthly_rent),
      status: row.status,
      age: row.age ? Number(row.age) : null,
      gender: row.gender || '',
      address: row.address || '',
      occupation: row.occupation || '',
      emergencyContactName: row.emergency_contact_name || '',
      emergencyContactPhone: row.emergency_contact_phone || ''
    };
  }
  if (collection === 'payments') {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      month: row.month,
      amount: Number(row.amount),
      status: row.status,
      method: row.method || '',
      paidOn: row.paid_on || '',
      proofImage: row.proof_image || '',
      reviewedAt: row.reviewed_at || ''
    };
  }
  if (collection === 'loans') {
    return {
      id: row.id,
      borrowerId: row.borrower_id,
      lenderId: row.lender_id,
      amount: Number(row.amount),
      dueDate: row.due_date || '',
      status: row.status
    };
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    roomId: row.room_id,
    status: row.status,
    requestedAt: row.requested_at || '',
    reviewedAt: row.reviewed_at || ''
  };
}

function toDatabaseRow(collection, record) {
  if (collection === 'rooms') {
    return {
      id: record.id,
      number: record.number,
      type: record.type,
      beds: record.beds,
      monthly_rent: record.monthlyRent,
      condition: record.condition
    };
  }
  if (collection === 'tenants') {
    const row = {
      id: record.id,
      name: record.name,
      email: record.email || null,
      user_id: record.accountUserId || null,
      phone: record.phone || null,
      room_id: record.roomId || null,
      monthly_rent: record.monthlyRent,
      status: record.status
    };
    if (record.age !== undefined && record.age !== null && record.age !== '') {
      row.age = Number(record.age);
    }
    if (record.gender !== undefined) row.gender = record.gender || '';
    if (record.address !== undefined) row.address = record.address || '';
    if (record.occupation !== undefined) row.occupation = record.occupation || '';
    if (record.emergencyContactName !== undefined) row.emergency_contact_name = record.emergencyContactName || '';
    if (record.emergencyContactPhone !== undefined) row.emergency_contact_phone = record.emergencyContactPhone || '';
    return row;
  }
  if (collection === 'payments') {
    return {
      id: record.id,
      tenant_id: record.tenantId,
      month: record.month,
      amount: record.amount,
      status: record.status,
      method: record.method || null,
      paid_on: record.paidOn || null,
      proof_image: record.proofImage || null,
      reviewed_at: record.reviewedAt || null
    };
  }
  if (collection === 'loans') {
    return {
      id: record.id,
      borrower_id: record.borrowerId,
      lender_id: record.lenderId,
      amount: record.amount,
      due_date: record.dueDate || null,
      status: record.status
    };
  }
  return {
    id: record.id,
    tenant_id: record.tenantId,
    room_id: record.roomId,
    status: record.status,
    requested_at: record.requestedAt || new Date().toISOString(),
    reviewed_at: record.reviewedAt || null
  };
}

async function loadRecords() {
  const results = await Promise.all(databaseCollections.map(({ key, table }) =>
    window.bordsSupabase.from(table).select('*').then(({ data, error }) => {
      if (error) throw new Error(`Could not load ${table}: ${error.message}`);
      return [key, (data || []).map((row) => fromDatabaseRow(key, row))];
    })
  ));
  return Object.fromEntries(results);
}

function toDatetimeLocal(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function sanitizeProofUrl(url) {
  if (!url) return '';
  const trimmed = String(url).trim();
  if (/^https?:\/\//i.test(trimmed) || /^data:image\/(jpeg|png|webp|gif);base64,/i.test(trimmed)) {
    return escapeHtml(trimmed);
  }
  return '';
}

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
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function roomForTenant(tenant) {
  return records.rooms.find((room) => room.id === tenant.roomId);
}

function tenantsInRoom(roomId, excludeTenantId = '') {
  return records.tenants.filter((tenant) => tenant.id !== excludeTenantId && tenant.status === 'Active' && tenant.roomId === roomId);
}

function tenantById(id) {
  return records.tenants.find((tenant) => tenant.id === id);
}

function paymentForTenant(tenantId, month = currentMonth) {
  return records.payments.find((payment) => payment.tenantId === tenantId && payment.month === month);
}

function paymentLabel(tenant) {
  return paymentForTenant(tenant.id)?.status || 'Unpaid';
}

function roomStatus(room) {
  if (room.condition === 'Needs repair') return 'Needs repair';
  return tenantsInRoom(room.id).length >= room.beds ? 'Occupied' : 'Available';
}

function statusClass(status) {
  return String(status).toLowerCase().replaceAll(' ', '-');
}

function statusBadge(status) {
  const tone = status === 'Available' || status === 'Active' || status === 'Paid in full' || status === 'Repaid'
    ? 'success'
    : status === 'Overdue' || status === 'Declined'
      ? 'danger'
      : status === 'Due' || status === 'Unpaid'
        ? 'warning'
        : 'pending';
  return `<span class="status ${tone} ${statusClass(status)}">${escapeHtml(status)}</span>`;
}

function actionButtons(type, id) {
  return `<div class="row-actions"><button type="button" class="text-button" data-action="edit" data-type="${type}" data-id="${escapeHtml(id)}">Edit</button><button type="button" class="text-button danger-text" data-action="delete" data-type="${type}" data-id="${escapeHtml(id)}">Delete</button></div>`;
}

function renderTable(headers, rows, emptyMessage = 'No records yet. Add one to get started.') {
  if (!rows.length) return `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
  return `<div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function updateSidebarBadges() {
  const tenantsBadge = document.getElementById('nav-count-tenants');
  const roomsBadge = document.getElementById('nav-count-rooms');
  const rentBadge = document.getElementById('nav-count-rent');
  const loansBadge = document.getElementById('nav-count-loans');

  const pendingPayments = records.payments.filter((p) => p.status === 'Pending review').length;
  const pendingLoans = records.loans.filter((l) => l.status === 'Pending').length;
  const availableRooms = records.rooms.filter((r) => roomStatus(r) === 'Available').length;

  if (tenantsBadge) tenantsBadge.textContent = records.tenants.length;
  if (roomsBadge) roomsBadge.textContent = availableRooms;
  if (rentBadge) {
    rentBadge.textContent = pendingPayments || records.payments.length;
    rentBadge.classList.toggle('has-pending', pendingPayments > 0);
    rentBadge.title = pendingPayments > 0 ? `${pendingPayments} payment proof(s) awaiting review` : 'Rent payments';
  }
  if (loansBadge) {
    loansBadge.textContent = pendingLoans || records.loans.length;
    loansBadge.classList.toggle('has-pending', pendingLoans > 0);
    loansBadge.title = pendingLoans > 0 ? `${pendingLoans} loan request(s) pending` : 'Loans';
  }
}

function showTenantDetail(tenantId) {
  if (!tenantDetailDialog || !tenantModalContent) return;
  const tenant = tenantById(tenantId);
  if (!tenant) {
    showToast('Tenant record not found.');
    return;
  }
  const room = roomForTenant(tenant);
  const payment = paymentForTenant(tenant.id);
  const currentRentStatus = paymentLabel(tenant);
  const monthlyRent = tenant.monthlyRent || room?.monthlyRent || 0;
  const initial = (tenant.name || 'T').charAt(0).toUpperCase();

  if (tenantModalName) tenantModalName.textContent = tenant.name;

  const phoneLink = tenant.phone
    ? `<a class="phone-call-link" href="tel:${escapeHtml(tenant.phone)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>${escapeHtml(tenant.phone)}</a>`
    : '<span style="color:#94a3b8;font-weight:400;">Not provided</span>';

  const emergencyPhoneLink = tenant.emergencyContactPhone
    ? `<a class="phone-call-link" href="tel:${escapeHtml(tenant.emergencyContactPhone)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>${escapeHtml(tenant.emergencyContactPhone)}</a>`
    : '<span style="color:#94a3b8;font-weight:400;">None</span>';

  tenantModalContent.innerHTML = `
    <div class="tenant-modal-body">
      <div class="tenant-modal-hero">
        <div class="tenant-modal-avatar">${escapeHtml(initial)}</div>
        <div class="tenant-modal-title">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <h3 style="margin:0;font-size:18px;font-weight:800;color:#0f172a;">${escapeHtml(tenant.name)}</h3>
            ${statusBadge(tenant.status)}
            ${tenant.accountUserId ? '<span class="verified-pill">App User</span>' : '<span class="stat-pill" style="font-size:11px;">Manual Record</span>'}
          </div>
          <p style="margin:4px 0 0;font-size:12.5px;color:#64748b;">${escapeHtml(tenant.email || 'No email registered')}</p>
        </div>
      </div>

      <div class="tenant-modal-meta-grid">
        <div class="dossier-item">
          <span class="dossier-label">Assigned Room</span>
          <div class="dossier-val">${room ? `Room ${escapeHtml(room.number)} (${escapeHtml(room.type)})` : '<span class="unassigned-badge">Unassigned</span>'}</div>
        </div>
        <div class="dossier-item">
          <span class="dossier-label">Monthly Rent</span>
          <div class="dossier-val">${money(monthlyRent)} / mo</div>
        </div>
        <div class="dossier-item">
          <span class="dossier-label">Current Rent Status</span>
          <div class="dossier-val" style="display:flex;align-items:center;gap:8px;">
            ${statusBadge(currentRentStatus)}
            <small style="color:#64748b;font-weight:600;">${money(payment?.amount || 0)} paid</small>
          </div>
        </div>
        <div class="dossier-item">
          <span class="dossier-label">Phone Contact</span>
          <div class="dossier-val">${phoneLink}</div>
        </div>
        <div class="dossier-item">
          <span class="dossier-label">Age & Gender</span>
          <div class="dossier-val">${tenant.age ? `${tenant.age} yrs old` : '—'} · ${escapeHtml(tenant.gender || 'Not specified')}</div>
        </div>
        <div class="dossier-item">
          <span class="dossier-label">Occupation / School</span>
          <div class="dossier-val">${escapeHtml(tenant.occupation || 'Not specified')}</div>
        </div>
        <div class="dossier-item dossier-full">
          <span class="dossier-label">Permanent Hometown Address</span>
          <div class="dossier-val">${escapeHtml(tenant.address || 'Not specified')}</div>
        </div>
        <div class="dossier-item dossier-full">
          <span class="dossier-label">Emergency Contact</span>
          <div class="dossier-val" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
            <span>${escapeHtml(tenant.emergencyContactName || 'No emergency contact designated')}</span>
            ${emergencyPhoneLink}
          </div>
        </div>
      </div>
    </div>
    <div class="tenant-modal-actions">
      <button type="button" class="button button-secondary" data-action="quick-assign-room" data-id="${tenant.id}">
        ${room ? 'Change Room' : '＋ Assign Room'}
      </button>
      <button type="button" class="button button-secondary" data-action="add-payment-for" data-id="${tenant.id}">
        Record Rent
      </button>
      <button type="button" class="button button-primary" data-action="edit" data-type="tenant" data-id="${tenant.id}">
        Edit Profile
      </button>
    </div>
  `;

  tenantDetailDialog.showModal();
}

function renderOverview() {
  const activeTenants = records.tenants.filter((tenant) => tenant.status === 'Active');
  const availableRooms = records.rooms.filter((room) => roomStatus(room) === 'Available');
  const pendingLoans = records.loans.filter((loan) => loan.status === 'Pending');
  const pendingPayments = records.payments.filter((payment) => payment.status === 'Pending review');
  const pendingRoomRequests = records.roomRequests.filter((request) => request.status === 'Pending');
  const paidCount = activeTenants.filter((tenant) => paymentLabel(tenant) === 'Paid in full').length;

  // Real financial & occupancy metrics
  const totalExpectedRent = activeTenants.reduce((sum, t) => sum + (Number(t.monthlyRent) || Number(roomForTenant(t)?.monthlyRent) || 0), 0);
  const totalCollectedRent = records.payments
    .filter((p) => p.month === currentMonth && (p.status === 'Paid in full' || p.status === 'Partial'))
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const rentProgressPct = totalExpectedRent > 0 ? Math.min(100, Math.round((totalCollectedRent / totalExpectedRent) * 100)) : (paidCount > 0 ? 100 : 0);

  const totalBeds = records.rooms.filter((r) => r.condition !== 'Needs repair').reduce((sum, r) => sum + r.beds, 0);
  const assignedBeds = activeTenants.filter((t) => t.roomId).length;
  const freeBeds = Math.max(0, totalBeds - assignedBeds);
  const occupancyRate = totalBeds > 0 ? Math.round((assignedBeds / totalBeds) * 100) : 0;
  const unassignedTenants = activeTenants.filter((t) => !t.roomId);

  const totalPendingActionCount = pendingPayments.length + pendingRoomRequests.length + pendingLoans.length;

  // Real-time search filter
  const query = searchQuery.trim().toLowerCase();
  const filteredTenants = query
    ? activeTenants.filter((t) => {
        const room = roomForTenant(t);
        return t.name.toLowerCase().includes(query) ||
               (t.email || '').toLowerCase().includes(query) ||
               (t.phone || '').toLowerCase().includes(query) ||
               (room?.number || '').toLowerCase().includes(query);
      })
    : activeTenants;

  const paymentRows = filteredTenants.map((tenant) => {
    const room = roomForTenant(tenant);
    const payment = paymentForTenant(tenant.id);
    const tenantCell = `<button type="button" class="tenant-name-link" data-action="view-tenant" data-id="${tenant.id}" title="Click to view tenant dossier">${escapeHtml(tenant.name)}</button>`;
    const roomCell = room ? `Room ${escapeHtml(room.number)}` : `<span class="unassigned-badge">Unassigned</span>`;
    return [tenantCell, roomCell, statusBadge(payment?.status || 'Unpaid'), money(payment?.amount || 0)];
  });

  const roomRows = availableRooms.slice(0, 3).map((room) => {
    const occupants = tenantsInRoom(room.id);
    const freeBedsCount = Math.max(0, room.beds - occupants.length);
    return `<div class="room-item"><div><strong>Room ${escapeHtml(room.number)}</strong><small>${escapeHtml(room.type)} · ${freeBedsCount} ${freeBedsCount === 1 ? 'bed' : 'beds'} free</small></div>${statusBadge('Available')}</div>`;
  }).join('');

  const rosterRows = filteredTenants.map((tenant) => {
    const room = roomForTenant(tenant);
    const tenantCell = `<button type="button" class="tenant-name-link" data-action="view-tenant" data-id="${tenant.id}" title="Click to view tenant dossier">${escapeHtml(tenant.name)}</button>`;
    const roomCell = room
      ? `Room ${escapeHtml(room.number)}`
      : `<span class="unassigned-badge">Unassigned</span> <button type="button" class="quick-assign-btn" data-action="quick-assign-room" data-id="${tenant.id}">+ Assign</button>`;
    return [tenantCell, roomCell, escapeHtml(room?.type || '—'), statusBadge(tenant.status)];
  });

  const loanRows = pendingLoans.slice(0, 3).map((loan) => {
    const borrower = tenantById(loan.borrowerId);
    const lender = tenantById(loan.lenderId);
    return `<div class="loan-item"><div><strong>${escapeHtml(borrower?.name || 'Former tenant')}</strong><small>Lender: ${escapeHtml(lender?.name || 'Former tenant')}</small></div><span class="loan-meta"><strong>${money(loan.amount)}</strong><small>Pending</small></span></div>`;
  }).join('');

  // Action Alert Banner if reviews are pending
  const alertBanner = (pendingPayments.length > 0 || pendingRoomRequests.length > 0)
    ? `
      <div class="owner-alert-banner">
        <div class="alert-banner-left">
          <div class="alert-banner-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <div class="alert-banner-text">
            <strong>Action Required: ${pendingPayments.length + pendingRoomRequests.length} pending review${(pendingPayments.length + pendingRoomRequests.length) === 1 ? '' : 's'}</strong>
            <span>${pendingPayments.length} rent payment proof${pendingPayments.length === 1 ? '' : 's'} and ${pendingRoomRequests.length} room occupancy request${pendingRoomRequests.length === 1 ? '' : 's'} awaiting your review.</span>
          </div>
        </div>
        <div class="alert-banner-btns">
          ${pendingPayments.length ? `<button type="button" class="button button-primary alert-action-btn" data-action="go-to-tab" data-tab="rent">Review Payments (${pendingPayments.length})</button>` : ''}
          ${pendingRoomRequests.length ? `<button type="button" class="button button-secondary alert-action-btn" data-action="go-to-tab" data-tab="rooms">Review Requests (${pendingRoomRequests.length})</button>` : ''}
        </div>
      </div>
    `
    : '';

  viewRoot.innerHTML = `
    ${alertBanner}
    <section class="stats-grid">
      <article class="stat-card accent-blue">
        <div class="stat-card-top">
          <span class="stat-card-title">Rent Collected (${escapeHtml(new Intl.DateTimeFormat(undefined, { month: 'short' }).format(today))})</span>
          <div class="stat-icon-wrap stat-icon-blue">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
          </div>
        </div>
        <div class="stat-value">${money(totalCollectedRent)}</div>
        <div class="stat-progress-bar"><div class="stat-progress-fill" style="width: ${rentProgressPct}%"></div></div>
        <div class="stat-subtext">${rentProgressPct}% of ${money(totalExpectedRent)} · ${paidCount} of ${activeTenants.length} paid in full</div>
      </article>

      <article class="stat-card accent-green">
        <div class="stat-card-top">
          <span class="stat-card-title">Bed & Room Occupancy</span>
          <div class="stat-icon-wrap stat-icon-green">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>
          </div>
        </div>
        <div class="stat-value">${availableRooms.length} <small style="font-size:15px;color:#64748b;font-weight:600;">/ ${records.rooms.length} rooms free</small></div>
        <div class="stat-progress-bar"><div class="stat-progress-fill" style="width: ${occupancyRate}%; background: linear-gradient(90deg, #16a34a, #22c55e);"></div></div>
        <div class="stat-subtext">${occupancyRate}% bed occupancy · ${freeBeds} ${freeBeds === 1 ? 'bed' : 'beds'} currently available</div>
      </article>

      <article class="stat-card accent-gold">
        <div class="stat-card-top">
          <span class="stat-card-title">House Residents</span>
          <div class="stat-icon-wrap stat-icon-gold">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
        </div>
        <div class="stat-value">${activeTenants.length} <small style="font-size:15px;color:#64748b;font-weight:600;">resident${activeTenants.length === 1 ? '' : 's'}</small></div>
        <div class="stat-subtext" style="margin-top:10px;">
          ${unassignedTenants.length > 0 ? `<span style="color:#d97706;font-weight:700;">⚠ ${unassignedTenants.length} unassigned</span> · ${activeTenants.length - unassignedTenants.length} housed` : `All ${activeTenants.length} residents assigned to rooms`}
        </div>
      </article>

      <article class="stat-card accent-red">
        <div class="stat-card-top">
          <span class="stat-card-title">Pending Reviews</span>
          <div class="stat-icon-wrap ${totalPendingActionCount > 0 ? 'stat-icon-red' : 'stat-icon-green'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
        </div>
        <div class="stat-value">${totalPendingActionCount}</div>
        <div class="stat-subtext" style="margin-top:10px;">
          ${totalPendingActionCount > 0
            ? `${pendingPayments.length} payment${pendingPayments.length === 1 ? '' : 's'}, ${pendingRoomRequests.length} room req${pendingRoomRequests.length === 1 ? '' : 's'}, ${pendingLoans.length} loan${pendingLoans.length === 1 ? '' : 's'}`
            : 'Everything up to date · 0 pending'}
        </div>
      </article>
    </section>

    <section class="content-grid">
      <div class="panel">
        <div class="panel-header">
          <div>
            <div class="panel-label">Payments · ${escapeHtml(new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(today))}</div>
            <h2>Tenant payment status</h2>
          </div>
          <span class="panel-count">${filteredTenants.length} tenants</span>
        </div>
        ${renderTable(['Tenant', 'Room', 'Payment', 'Amount paid'], paymentRows, query ? 'No matching tenants for your search.' : 'No payment records to show.')}
      </div>

      <div class="panel">
        <div class="panel-header">
          <div>
            <div class="panel-label">Rooms</div>
            <h2>Available rooms</h2>
          </div>
        </div>
        <div class="stack-list ${roomRows ? '' : 'is-empty'}">
          ${roomRows || '<p class="empty-state">No available beds.</p>'}
          <p class="room-note">Showing ${Math.min(availableRooms.length, 3)} of ${availableRooms.length} available rooms</p>
        </div>
      </div>
    </section>

    <section class="bottom-grid">
      <div class="panel">
        <div class="panel-header">
          <div>
            <div class="panel-label">Tenants</div>
            <h2>House roster</h2>
          </div>
          <span class="panel-count">${filteredTenants.length} active</span>
        </div>
        ${renderTable(['Tenant', 'Room', 'Room type', 'Rent status'], rosterRows, query ? 'No matching tenants for your search.' : 'No active tenants to show.')}
      </div>

      <div class="panel">
        <div class="panel-header">
          <div>
            <div class="panel-label">Between tenants</div>
            <h2>Pending loan requests</h2>
          </div>
        </div>
        <div class="loan-list ${loanRows ? '' : 'is-empty'}">
          ${loanRows || '<p class="empty-state">No pending loan requests.</p>'}
        </div>
      </div>
    </section>
  `;

  updateSidebarBadges();
}

function renderView(view = currentView) {
  currentView = view;
  if (view === 'overview') {
    renderOverview();
    return;
  }

  const query = searchQuery.trim().toLowerCase();

  if (view === 'tenants') {
    const filteredTenants = query
      ? records.tenants.filter((tenant) => {
          const room = roomForTenant(tenant);
          return tenant.name.toLowerCase().includes(query) ||
                 (tenant.email || '').toLowerCase().includes(query) ||
                 (tenant.phone || '').toLowerCase().includes(query) ||
                 (room?.number || '').toLowerCase().includes(query);
        })
      : records.tenants;

    const rows = filteredTenants.map((tenant) => {
      const room = roomForTenant(tenant);
      const tenantCell = `<button type="button" class="tenant-name-link" data-action="view-tenant" data-id="${tenant.id}" title="Click to view tenant dossier">${escapeHtml(tenant.name)}</button>`;
      const roomCell = room
        ? `Room ${escapeHtml(room.number)}`
        : `<span class="unassigned-badge">Unassigned</span> <button type="button" class="quick-assign-btn" data-action="quick-assign-room" data-id="${tenant.id}">+ Assign</button>`;
      return [
        tenantCell,
        escapeHtml(tenant.email || '—'),
        tenant.phone ? `<a class="phone-call-link" href="tel:${escapeHtml(tenant.phone)}">${escapeHtml(tenant.phone)}</a>` : '—',
        roomCell,
        statusBadge(paymentLabel(tenant)),
        statusBadge(tenant.status),
        actionButtons('tenant', tenant.id)
      ];
    });
    viewRoot.innerHTML = `<section class="data-view"><div class="view-heading"><div><span class="panel-label">HOUSE RECORDS</span><h2>All tenants</h2></div><div class="heading-actions"><span class="panel-count">${filteredTenants.length} tenants</span><button class="button button-primary" data-action="add" data-type="tenant">＋ Add tenant</button></div></div><div class="panel">${renderTable(['Tenant', 'Account email', 'Phone', 'Room', 'Rent status', 'Tenancy', 'Actions'], rows, query ? 'No tenants match your search.' : 'No records yet. Add one to get started.')}</div></section>`;
  } else if (view === 'rooms') {
    const pendingRoomRequests = records.roomRequests.filter((request) => request.status === 'Pending');
    const requestsPanel = pendingRoomRequests.length
      ? `<section class="panel room-requests-panel"><div class="panel-header"><div><div class="panel-label">TENANT REQUESTS</div><h2>Room requests awaiting approval</h2></div><span class="panel-count">${pendingRoomRequests.length} pending</span></div><div class="room-request-list">${pendingRoomRequests.map((request) => {
        const tenant = tenantById(request.tenantId);
        const room = records.rooms.find((record) => record.id === request.roomId);
        return `<div class="room-request-item"><div><strong>${escapeHtml(tenant?.name || 'Former tenant')}</strong><small>Pending occupancy · Room ${escapeHtml(room?.number || 'removed room')} · ${request.requestedAt ? escapeHtml(new Date(request.requestedAt).toLocaleString()) : 'Date not recorded'}</small></div><div class="row-actions"><button type="button" class="text-button" data-action="review-room-request" data-status="approve" data-id="${escapeHtml(request.id)}">Approve</button><button type="button" class="text-button danger-text" data-action="review-room-request" data-status="decline" data-id="${escapeHtml(request.id)}">Decline</button></div></div>`;
      }).join('')}</div></section>`
      : '';

    const filteredRooms = query
      ? records.rooms.filter((room) => {
          return room.number.toLowerCase().includes(query) ||
                 room.type.toLowerCase().includes(query) ||
                 tenantsInRoom(room.id).some((t) => t.name.toLowerCase().includes(query));
        })
      : records.rooms;

    const cards = filteredRooms.map((room) => {
      const occupants = tenantsInRoom(room.id);
      const status = roomStatus(room);
      const freeBeds = Math.max(0, room.beds - occupants.length);
      const conditionLabel = room.condition === 'Needs repair' ? 'Needs repair' : 'Ready for tenants';
      return `<article class="room-card"><div class="room-card-top"><div><span class="room-card-label">ROOM</span><h3>${escapeHtml(room.number)}</h3></div>${statusBadge(status)}</div><div class="room-card-details"><div><span>TYPE</span><strong>${escapeHtml(room.type)}</strong></div><div><span>BEDS</span><strong>${freeBeds} free / ${room.beds}</strong></div><div><span>MONTHLY RENT</span><strong>${money(room.monthlyRent)} <small>/ tenant</small></strong></div><div class="room-card-tenants"><span>TENANTS</span><strong>${escapeHtml(occupants.map((tenant) => tenant.name).join(', ') || 'No tenants assigned')}</strong></div></div><div class="room-card-footer"><span class="room-condition">${escapeHtml(conditionLabel)}</span><div class="row-actions"><button type="button" class="text-button" data-action="edit" data-type="room" data-id="${escapeHtml(room.id)}">Edit</button><button type="button" class="text-button danger-text" data-action="delete" data-type="room" data-id="${escapeHtml(room.id)}">Delete</button></div><button type="button" class="text-button room-repair-action" data-action="toggle-repair" data-id="${escapeHtml(room.id)}">${room.condition === 'Needs repair' ? 'Mark ready' : 'Needs repair'}</button></div></article>`;
    });
    const availableCount = records.rooms.filter((room) => roomStatus(room) === 'Available').length;
    viewRoot.innerHTML = `<section class="data-view"><div class="view-heading"><div><span class="panel-label">HOUSE RECORDS</span><h2>Rooms</h2></div><div class="heading-actions"><span class="panel-count">${availableCount} available · ${records.rooms.length} total</span><button class="button button-primary" data-action="add" data-type="room">＋ Add room</button></div></div>${requestsPanel}<div class="panel room-catalog"><div class="room-grid">${cards.length ? cards.join('') : '<div class="room-grid-empty"><strong>No rooms found</strong><span>Try clearing your search or add a new room.</span></div>'}</div></div></section>`;
  } else if (view === 'rent') {
    const filteredPayments = query
      ? records.payments.filter((payment) => {
          const tenant = tenantById(payment.tenantId);
          const room = tenant ? roomForTenant(tenant) : null;
          return (tenant?.name || '').toLowerCase().includes(query) ||
                 (room?.number || '').toLowerCase().includes(query) ||
                 payment.month.toLowerCase().includes(query) ||
                 (payment.method || '').toLowerCase().includes(query) ||
                 payment.status.toLowerCase().includes(query);
        })
      : records.payments;

    const rows = filteredPayments.map((payment) => {
      const tenant = tenantById(payment.tenantId);
      const room = tenant ? roomForTenant(tenant) : null;
      const submittedAt = payment.paidOn ? new Date(payment.paidOn).toLocaleString() : '—';
      const safeProof = sanitizeProofUrl(payment.proofImage);
      const proof = safeProof
        ? `<a class="proof-link" href="${safeProof}" target="_blank" rel="noopener noreferrer">View proof</a>`
        : '—';
      const reviewActions = payment.status === 'Pending review'
        ? `<div class="row-actions"><button type="button" class="text-button" data-action="review-payment" data-status="approve" data-id="${escapeHtml(payment.id)}">Approve</button><button type="button" class="text-button danger-text" data-action="review-payment" data-status="decline" data-id="${escapeHtml(payment.id)}">Decline</button></div>`
        : actionButtons('payment', payment.id);

      const tenantCell = tenant
        ? `<button type="button" class="tenant-name-link" data-action="view-tenant" data-id="${tenant.id}" title="Click to view tenant dossier">${escapeHtml(tenant.name)}</button>`
        : 'Former tenant';

      return [
        tenantCell,
        escapeHtml(room?.number || '—'),
        escapeHtml(payment.month),
        statusBadge(payment.status),
        money(payment.amount),
        escapeHtml(payment.method || '—'),
        escapeHtml(submittedAt),
        proof,
        reviewActions
      ];
    });
    viewRoot.innerHTML = `<section class="data-view"><div class="view-heading"><div><span class="panel-label">HOUSE RECORDS</span><h2>Rent payments</h2></div><div class="heading-actions"><span class="panel-count">${records.payments.filter((payment) => payment.status === 'Pending review').length} awaiting review · ${records.payments.length} total</span><button class="button button-primary" data-action="add" data-type="payment">＋ Record payment</button></div></div><div class="panel">${renderTable(['Tenant', 'Room', 'Month', 'Status', 'Amount', 'Method', 'Payment date & time', 'Proof', 'Actions'], rows, query ? 'No payments match your search.' : 'No rent payments to show.')}</div></section>`;
  } else if (view === 'loans') {
    const filteredLoans = query
      ? records.loans.filter((loan) => {
          const borrower = tenantById(loan.borrowerId);
          const lender = tenantById(loan.lenderId);
          return (borrower?.name || '').toLowerCase().includes(query) ||
                 (lender?.name || '').toLowerCase().includes(query) ||
                 loan.status.toLowerCase().includes(query);
        })
      : records.loans;

    const rows = filteredLoans.map((loan) => {
      const borrower = tenantById(loan.borrowerId);
      const lender = tenantById(loan.lenderId);
      const reviewActions = loan.status === 'Pending'
        ? `<div class="row-actions"><button type="button" class="text-button" data-action="review-loan" data-status="approve" data-id="${escapeHtml(loan.id)}">Approve</button><button type="button" class="text-button danger-text" data-action="review-loan" data-status="decline" data-id="${escapeHtml(loan.id)}">Decline</button></div>`
        : actionButtons('loan', loan.id);

      const borrowerCell = borrower
        ? `<button type="button" class="tenant-name-link" data-action="view-tenant" data-id="${borrower.id}">${escapeHtml(borrower.name)}</button>`
        : 'Former tenant';
      const lenderCell = lender
        ? `<button type="button" class="tenant-name-link" data-action="view-tenant" data-id="${lender.id}">${escapeHtml(lender.name)}</button>`
        : 'Former tenant';

      return [
        borrowerCell,
        lenderCell,
        money(loan.amount),
        escapeHtml(loan.dueDate || '—'),
        statusBadge(loan.status),
        reviewActions
      ];
    });
    viewRoot.innerHTML = `<section class="data-view"><div class="view-heading"><div><span class="panel-label">BETWEEN TENANTS</span><h2>Loan requests</h2></div><div class="heading-actions"><span class="panel-count">${records.loans.filter((loan) => loan.status === 'Pending').length} pending</span><button class="button button-primary" data-action="add" data-type="loan">＋ Add loan</button></div></div><div class="panel">${renderTable(['Borrower', 'Lender', 'Amount', 'Due date', 'Status', 'Actions'], rows, query ? 'No loan records match your search.' : 'No loan records to show.')}</div></section>`;
  }

  updateSidebarBadges();
}

function selectField(name, label, options, selected = '', required = true) {
  return `<label class="form-field">${label}<select name="${name}" ${required ? 'required' : ''}>${options.map((option) => `<option value="${escapeHtml(option.value)}" ${String(option.value) === String(selected) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select></label>`;
}

function inputField(name, label, value = '', type = 'text', required = true, extra = '') {
  return `<label class="form-field">${label}<input name="${name}" type="${type}" value="${escapeHtml(value)}" ${required ? 'required' : ''} ${extra}></label>`;
}

function openForm(type, id = '') {
  if (!entryDialog || !entryForm) return;
  const editing = Boolean(id);
  const existing = editing ? records[`${type}s`]?.find((record) => record.id === id) : null;
  if (editing && !existing) {
    showToast('That record could not be found.');
    return;
  }
  if (type === 'payment' && records.tenants.length === 0) {
    showToast('Add a tenant before recording rent.');
    return;
  }
  if (type === 'loan' && records.tenants.filter((tenant) => tenant.status === 'Active').length < 2) {
    showToast('Add at least two active tenants before recording a loan between tenants.');
    return;
  }
  const titles = { tenant: 'tenant', room: 'room', payment: 'rent payment', loan: 'tenant loan' };
  document.getElementById('dialog-title').textContent = `${editing ? 'Edit' : 'Add'} ${titles[type]}`;
  document.getElementById('dialog-eyebrow').textContent = editing ? 'UPDATE HOUSE RECORD' : 'NEW HOUSE RECORD';
  entryForm.dataset.type = type;
  entryForm.dataset.id = id;

  if (type === 'tenant') {
    const availableRooms = records.rooms.filter((room) => room.condition !== 'Needs repair' && tenantsInRoom(room.id, id).length < room.beds);
    const currentRoom = existing?.roomId ? records.rooms.find((room) => room.id === existing.roomId) : null;
    const roomOptions = [{ value: '', label: 'No room assigned' }, ...availableRooms.map((room) => ({ value: room.id, label: `${room.number} · ${room.type}` }))];
    if (currentRoom && !roomOptions.some((room) => room.value === currentRoom.id)) {
      roomOptions.push({ value: currentRoom.id, label: `${currentRoom.number} · Needs repair (current tenant)` });
    }
    const genderOptions = [
      { value: '', label: 'Select gender...' },
      { value: 'Male', label: 'Male' },
      { value: 'Female', label: 'Female' },
      { value: 'Non-binary', label: 'Non-binary' },
      { value: 'Prefer not to say', label: 'Prefer not to say' }
    ];

    entryForm.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        ${inputField('name', 'Full name *', existing?.name || '')}
        ${inputField('email', 'Account email for self-signup', existing?.email || '', 'email', false, 'autocomplete="email"')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        ${inputField('phone', 'Phone number', existing?.phone || '', 'tel', false)}
        ${selectField('roomId', 'Assigned room', roomOptions, existing?.roomId || '', false)}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        ${inputField('monthlyRent', 'Monthly rent (₱) *', existing?.monthlyRent ?? '', 'number', true, 'min="0" step="1"')}
        ${selectField('status', 'Tenancy status', ['Active', 'Inactive'].map((value) => ({ value, label: value })), existing?.status || 'Active')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        ${inputField('age', 'Age (years)', existing?.age ?? '', 'number', false, 'min="1" max="120"')}
        ${selectField('gender', 'Gender', genderOptions, existing?.gender || '', false)}
      </div>
      <div style="display:grid;grid-template-columns:1fr;gap:12px;">
        ${inputField('occupation', 'Occupation / University', existing?.occupation || '', 'text', false)}
        ${inputField('address', 'Permanent Hometown Address', existing?.address || '', 'text', false)}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        ${inputField('emergencyContactName', 'Emergency Contact Name', existing?.emergencyContactName || '', 'text', false)}
        ${inputField('emergencyContactPhone', 'Emergency Contact Phone', existing?.emergencyContactPhone || '', 'tel', false)}
      </div>
      <div class="form-actions">
        <button type="button" class="button button-secondary" data-action="close-dialog">Cancel</button>
        <button class="button button-primary" type="submit">${editing ? 'Save changes' : 'Add tenant'}</button>
      </div>
    `;
  } else if (type === 'room') {
    entryForm.innerHTML = `${inputField('number', 'Room number *', existing?.number || '')}${selectField('type', 'Room type', ['Single', 'Shared'].map((value) => ({ value, label: value })), existing?.type || 'Single')}${inputField('beds', 'Number of beds *', existing?.beds ?? 1, 'number', true, 'min="1" step="1"')}${inputField('monthlyRent', 'Monthly rent per tenant (₱) *', existing?.monthlyRent ?? '', 'number', true, 'min="0" step="1"')}${selectField('condition', 'Room condition', [{ value: 'Ready', label: 'Ready for tenants' }, { value: 'Needs repair', label: 'Needs repair · unavailable' }], existing?.condition || 'Ready')}<div class="form-actions"><button type="button" class="button button-secondary" data-action="close-dialog">Cancel</button><button class="button button-primary" type="submit">${editing ? 'Save changes' : 'Add room'}</button></div>`;
  } else if (type === 'payment') {
    const tenantOptions = records.tenants.map((tenant) => ({ value: tenant.id, label: tenant.name }));
    const statusOptions = ['Paid in full', 'Partial', 'Due', 'Overdue', 'Pending review', 'Declined'].map((value) => ({ value, label: value }));
    const paidOn = toDatetimeLocal(existing?.paidOn);
    entryForm.innerHTML = `${selectField('tenantId', 'Tenant *', tenantOptions, existing?.tenantId || '')}${inputField('month', 'Rent month *', existing?.month || currentMonth, 'month')}${selectField('status', 'Payment status', statusOptions, existing?.status || 'Paid in full')}${inputField('amount', 'Amount paid (₱) *', existing?.amount ?? '', 'number', true, 'min="0" step="1"')}${inputField('paidOn', 'Payment date and time', paidOn, 'datetime-local', false)}<div class="form-actions"><button type="button" class="button button-secondary" data-action="close-dialog">Cancel</button><button class="button button-primary" type="submit">${editing ? 'Save changes' : 'Record payment'}</button></div>`;
  } else if (type === 'loan') {
    const tenantOptions = records.tenants.filter((tenant) => tenant.status === 'Active').map((tenant) => ({ value: tenant.id, label: tenant.name }));
    const statusOptions = ['Pending', 'Approved', 'Declined', 'Repaid'].map((value) => ({ value, label: value }));
    entryForm.innerHTML = `${selectField('borrowerId', 'Borrower *', tenantOptions, existing?.borrowerId || '')}${selectField('lenderId', 'Lender *', tenantOptions, existing?.lenderId || '')}${inputField('amount', 'Loan amount (₱) *', existing?.amount ?? '', 'number', true, 'min="1" step="1"')}${inputField('dueDate', 'Due date', existing?.dueDate || '', 'date', false)}${selectField('status', 'Loan status', statusOptions, existing?.status || 'Pending')}<div class="form-actions"><button type="button" class="button button-secondary" data-action="close-dialog">Cancel</button><button class="button button-primary" type="submit">${editing ? 'Save changes' : 'Add loan'}</button></div>`;
  }
  entryDialog.showModal();
}

function editingRoomStillFits(roomId, beds) {
  return records.tenants.filter((tenant) => tenant.status === 'Active' && tenant.roomId === roomId).length <= beds;
}

function titlesForType(type) {
  return { tenant: 'Tenant', room: 'Room', payment: 'Rent payment', loan: 'Loan' }[type] || type;
}

async function saveForm(form) {
  const type = form.dataset.type;
  const id = form.dataset.id;
  const values = Object.fromEntries(new FormData(form));
  const collection = `${type}s`;
  const existing = id ? records[collection]?.find((record) => record.id === id) : null;
  const existingIndex = id ? records[collection]?.findIndex((record) => record.id === id) : -1;
  let record;

  if (type === 'tenant') {
    const email = (values.email || '').trim().toLowerCase();
    if (email && records.tenants.some((tenant) => tenant.id !== id && tenant.email?.toLowerCase() === email)) {
      showToast('That account email is already assigned to another tenant.');
      return;
    }
    const selectedRoom = records.rooms.find((room) => room.id === values.roomId);
    const isKeepingExistingRepairRoom = selectedRoom?.condition === 'Needs repair'
      && values.roomId === existing?.roomId
      && existing?.status === 'Active';
    if (selectedRoom && values.status === 'Active' && !isKeepingExistingRepairRoom && (selectedRoom.condition === 'Needs repair' || tenantsInRoom(selectedRoom.id, id).length >= selectedRoom.beds)) {
      showToast(selectedRoom.condition === 'Needs repair' ? 'That room needs repair and cannot take tenants.' : 'That room has no beds available.');
      return;
    }
    record = {
      id: id || makeId(),
      name: values.name.trim(),
      email,
      accountUserId: existing?.accountUserId || null,
      phone: (values.phone || '').trim(),
      roomId: values.roomId || '',
      monthlyRent: Number(values.monthlyRent),
      status: values.status,
      age: values.age ? Number(values.age) : null,
      gender: values.gender || '',
      occupation: (values.occupation || '').trim(),
      address: (values.address || '').trim(),
      emergencyContactName: (values.emergencyContactName || '').trim(),
      emergencyContactPhone: (values.emergencyContactPhone || '').trim()
    };
  } else if (type === 'room') {
    if (records.rooms.some((room) => room.id !== id && room.number.toLowerCase() === values.number.trim().toLowerCase())) {
      showToast('A room with that number already exists.');
      return;
    }
    if (tenantsInRoom(id).length && !editingRoomStillFits(id, Number(values.beds))) {
      showToast('Cannot reduce the room capacity below its active tenant count.');
      return;
    }
    record = {
      id: id || makeId(),
      number: values.number.trim(),
      type: values.type,
      beds: Number(values.beds),
      monthlyRent: Number(values.monthlyRent),
      condition: values.condition
    };
  } else if (type === 'payment') {
    const duplicateIndex = records.payments.findIndex((payment) => payment.id !== id && payment.tenantId === values.tenantId && payment.month === values.month);
    if (duplicateIndex >= 0) {
      showToast('A rent record already exists for this tenant and month. Edit that record instead.');
      return;
    }
    const paidOnIso = values.paidOn ? new Date(values.paidOn).toISOString() : null;
    record = {
      ...records.payments[existingIndex],
      id: id || makeId(),
      tenantId: values.tenantId,
      month: values.month,
      status: values.status,
      amount: Number(values.amount),
      paidOn: paidOnIso
    };
  } else if (type === 'loan') {
    if (values.borrowerId === values.lenderId) {
      showToast('Choose two different tenants for a loan.');
      return;
    }
    record = {
      id: id || makeId(),
      borrowerId: values.borrowerId,
      lenderId: values.lenderId,
      amount: Number(values.amount),
      dueDate: values.dueDate,
      status: values.status
    };
  }

  try {
    const tableKey = type === 'payment' ? 'payments' : (type === 'loan' ? 'loans' : `${type}s`);
    const row = toDatabaseRow(tableKey, record);

    try {
      if (id) {
        const { error } = await window.bordsSupabase.from(tableKey).update(row).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await window.bordsSupabase.from(tableKey).insert([row]);
        if (error) throw error;
      }
    } catch (saveError) {
      // Graceful fallback if public.tenants lacks newly migrated profile columns
      if (type === 'tenant' && String(saveError.message).toLowerCase().includes('column')) {
        const coreRow = {
          id: record.id,
          name: record.name,
          email: record.email || null,
          user_id: record.accountUserId || null,
          phone: record.phone || null,
          room_id: record.roomId || null,
          monthly_rent: record.monthlyRent,
          status: record.status
        };
        const retry = id
          ? await window.bordsSupabase.from('tenants').update(coreRow).eq('id', id)
          : await window.bordsSupabase.from('tenants').insert([coreRow]);
        if (retry.error) throw retry.error;
      } else {
        throw saveError;
      }
    }

    records = await loadRecords();
    entryDialog.close();
    renderView();
    showToast(`${titlesForType(type)} ${id ? 'updated' : 'added'}.`);
  } catch (error) {
    showToast(`Could not save changes: ${error.message}`);
  }
}

async function deleteRecord(type, id) {
  const title = titlesForType(type).toLowerCase();
  if (!window.confirm(`Delete this ${title}? This cannot be undone.`)) return;

  if (type === 'room' && records.tenants.some((tenant) => tenant.roomId === id)) {
    showToast('Unassign every tenant from this room before deleting it.');
    return;
  }
  if (type === 'room' && records.roomRequests.some((request) => request.roomId === id && request.status === 'Pending')) {
    showToast('Resolve pending room requests for this room before deleting it.');
    return;
  }

  try {
    const table = databaseCollections.find((c) => c.key === `${type}s` || c.key === type)?.table || `${type}s`;
    const { error } = await window.bordsSupabase.from(table).delete().eq('id', id);
    if (error) throw error;
    records = await loadRecords();
    renderView();
    showToast(`${titlesForType(type)} deleted.`);
  } catch (error) {
    showToast(`Could not delete record: ${error.message}`);
  }
}

function showToast(message) {
  if (!toastRegion) return;
  toastRegion.textContent = message;
  toastRegion.classList.add('visible');
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toastRegion.classList.remove('visible'), 3600);
}

function updateActiveNav(view) {
  navButtons.forEach((button) => {
    const active = button.dataset.nav === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (pageTitle) pageTitle.textContent = navTitles[view] || 'Overview';
}

if (todayLabel) {
  todayLabel.textContent = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(today);
}

// Nav buttons
navButtons.forEach((button) => button.addEventListener('click', () => {
  currentView = button.dataset.nav;
  updateActiveNav(currentView);
  renderView(currentView);
}));

// Real-time Topbar Search
if (searchInput) {
  searchInput.addEventListener('input', (event) => {
    searchQuery = (event.target.value || '').trim().toLowerCase();
    renderView(currentView);
  });
}

// Quick Add Button & Dropdown
if (quickAddBtn && quickAddDropdown) {
  quickAddBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const isHidden = quickAddDropdown.hasAttribute('hidden');
    if (isHidden) {
      quickAddDropdown.removeAttribute('hidden');
      quickAddBtn.setAttribute('aria-expanded', 'true');
    } else {
      quickAddDropdown.setAttribute('hidden', '');
      quickAddBtn.setAttribute('aria-expanded', 'false');
    }
  });

  quickAddDropdown.addEventListener('click', (event) => {
    const item = event.target.closest('[data-quick-action]');
    if (!item) return;
    const action = item.dataset.quickAction;
    quickAddDropdown.setAttribute('hidden', '');
    quickAddBtn.setAttribute('aria-expanded', 'false');
    openForm(action);
  });

  document.addEventListener('click', (event) => {
    if (!quickAddBtn.contains(event.target) && !quickAddDropdown.contains(event.target)) {
      quickAddDropdown.setAttribute('hidden', '');
      quickAddBtn.setAttribute('aria-expanded', 'false');
    }
  });
}

// ViewRoot click delegation
viewRoot?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, type, id, tab } = button.dataset;

  if (action === 'go-to-tab') {
    if (tab) {
      currentView = tab;
      updateActiveNav(currentView);
      renderView(currentView);
    }
    return;
  }

  if (action === 'view-tenant') {
    showTenantDetail(id);
    return;
  }

  if (action === 'quick-assign-room') {
    openForm('tenant', id);
    return;
  }

  if (action === 'add') openForm(type);
  else if (action === 'edit') openForm(type, id);
  else if (action === 'delete') deleteRecord(type, id);
  else if (action === 'review-payment') {
    const payment = records.payments.find((record) => record.id === id);
    const tenant = payment && tenantById(payment.tenantId);
    if (!payment || !tenant || payment.status !== 'Pending review') {
      showToast('That payment is no longer awaiting review.');
      return;
    }
    const status = button.dataset.status === 'approve'
      ? (payment.amount >= tenant.monthlyRent ? 'Paid in full' : 'Partial')
      : 'Declined';
    try {
      const { error } = await window.bordsSupabase
        .from('payments')
        .update({ status, reviewed_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      payment.status = status;
      payment.reviewedAt = new Date().toISOString();
      renderView();
      showToast(`Payment ${status === 'Declined' ? 'declined' : 'approved'} for ${tenant.name}.`);
    } catch (error) {
      showToast(`Could not review payment: ${error.message}`);
    }
  }
  else if (action === 'review-room-request') {
    const request = records.roomRequests.find((record) => record.id === id);
    if (!request || request.status !== 'Pending') {
      showToast('That room request is no longer awaiting review.');
      return;
    }
    if (button.dataset.status === 'decline') {
      try {
        const { error } = await window.bordsSupabase
          .from('room_requests')
          .update({ status: 'Declined', reviewed_at: new Date().toISOString() })
          .eq('id', id);
        if (error) throw error;
        request.status = 'Declined';
        request.reviewedAt = new Date().toISOString();
        renderView();
        showToast('Room request declined.');
      } catch (error) {
        showToast(`Could not decline room request: ${error.message}`);
      }
      return;
    }

    const tenant = tenantById(request.tenantId);
    const room = records.rooms.find((record) => record.id === request.roomId);
    if (!room || room.condition === 'Needs repair' || tenantsInRoom(room.id, tenant?.id).length >= room.beds) {
      showToast('This room is no longer available. Decline the request or choose another room.');
      return;
    }

    try {
      let approved = false;
      try {
        const { data, error } = await window.bordsSupabase.rpc('approve_room_request', { p_request_id: id });
        if (!error && data && data.success) {
          approved = true;
        } else if (data && !data.success) {
          showToast(data.message || 'Could not approve room request.');
          return;
        }
      } catch (rpcErr) {
        approved = false;
      }

      if (!approved) {
        const now = new Date().toISOString();
        const { error: reqError } = await window.bordsSupabase
          .from('room_requests')
          .update({ status: 'Approved', reviewed_at: now })
          .eq('id', id);
        if (reqError) throw reqError;

        if (tenant) {
          const { error: tenantErr } = await window.bordsSupabase
            .from('tenants')
            .update({ room_id: room.id, monthly_rent: room.monthlyRent, status: 'Active' })
            .eq('id', tenant.id);
          if (tenantErr) throw tenantErr;
        }
      }

      records = await loadRecords();
      renderView();
      showToast(`Room request approved for ${tenant?.name || 'tenant'}!`);
    } catch (error) {
      showToast(`Could not approve room request: ${error.message}`);
    }
  }
  else if (action === 'review-loan') {
    const loan = records.loans.find((record) => record.id === id);
    if (!loan || loan.status !== 'Pending') {
      showToast('That loan request is no longer pending.');
      return;
    }
    const status = button.dataset.status === 'approve' ? 'Approved' : 'Declined';
    try {
      const { error } = await window.bordsSupabase
        .from('loans')
        .update({ status })
        .eq('id', id);
      if (error) throw error;
      loan.status = status;
      renderView();
      showToast(`Loan request ${status.toLowerCase()}.`);
    } catch (error) {
      showToast(`Could not review loan request: ${error.message}`);
    }
  }
  else if (action === 'toggle-repair') {
    const room = records.rooms.find((record) => record.id === id);
    if (!room) {
      showToast('That room could not be found.');
      return;
    }
    const needsRepair = room.condition !== 'Needs repair';
    const newCondition = needsRepair ? 'Needs repair' : 'Ready';
    try {
      const { error } = await window.bordsSupabase
        .from('rooms')
        .update({ condition: newCondition })
        .eq('id', id);
      if (error) throw error;
      room.condition = newCondition;
      renderView();
      showToast(`${room.number} marked ${needsRepair ? 'as needing repair' : 'ready for tenants'}.`);
    } catch (error) {
      showToast(`Could not update room: ${error.message}`);
    }
  }
});

// Tenant Detail Dialog Click Events
tenantDetailDialog?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, type, id } = button.dataset;

  if (action === 'close-tenant-modal') {
    tenantDetailDialog.close();
  } else if (action === 'quick-assign-room') {
    tenantDetailDialog.close();
    openForm('tenant', id);
  } else if (action === 'add-payment-for') {
    tenantDetailDialog.close();
    openForm('payment');
    setTimeout(() => {
      if (entryForm && entryForm.elements['tenantId']) {
        entryForm.elements['tenantId'].value = id;
      }
    }, 10);
  } else if (action === 'edit' && type === 'tenant') {
    tenantDetailDialog.close();
    openForm('tenant', id);
  }
});

// Entry form submission
entryForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = entryForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    await saveForm(entryForm);
  } finally {
    submitButton.disabled = false;
  }
});

entryForm?.addEventListener('click', (event) => {
  if (event.target.closest('[data-action="close-dialog"]')) entryDialog.close();
});
entryDialog?.addEventListener('click', (event) => {
  if (event.target.closest('[data-action="close-dialog"]')) entryDialog.close();
});

document.getElementById('logout-button')?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const { error } = await window.bordsSupabase.auth.signOut();
    if (error) throw error;
    window.location.replace('index.html');
  } catch (error) {
    button.disabled = false;
    showToast(`Could not sign out: ${error.message}`);
  }
});

async function startOwnerDashboard() {
  viewRoot.innerHTML = '<p class="empty-state">Connecting to Supabase…</p>';
  try {
    const { data, error } = await window.bordsSupabase.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      window.location.replace('index.html');
      return;
    }
    if (data.session.user.app_metadata?.role !== 'owner') {
      const { error: signOutError } = await window.bordsSupabase.auth.signOut();
      if (signOutError) throw signOutError;
      window.location.replace('index.html');
      return;
    }
    records = await loadRecords();
    renderView('overview');
  } catch (error) {
    viewRoot.innerHTML = `<section class="empty-state" role="alert">Could not load the Owner dashboard: ${escapeHtml(error.message)}</section>`;
  }
}

startOwnerDashboard();
