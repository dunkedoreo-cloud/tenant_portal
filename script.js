const pageTitle = document.getElementById('page-title');
const navButtons = [...document.querySelectorAll('[data-nav]')];
const todayLabel = document.getElementById('today-label');
const viewRoot = document.getElementById('view-root');
const entryDialog = document.getElementById('entry-dialog');
const entryForm = document.getElementById('entry-form');
const toastRegion = document.getElementById('toast-region');
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
    return { id: row.id, number: row.number, type: row.type, beds: row.beds, monthlyRent: Number(row.monthly_rent), condition: row.condition };
  }
  if (collection === 'tenants') {
    return { id: row.id, name: row.name, email: row.email || '', accountUserId: row.user_id || null, phone: row.phone || '', roomId: row.room_id || '', monthlyRent: Number(row.monthly_rent), status: row.status };
  }
  if (collection === 'payments') {
    return { id: row.id, tenantId: row.tenant_id, month: row.month, amount: Number(row.amount), status: row.status, method: row.method || '', paidOn: row.paid_on || '', proofImage: row.proof_image || '', reviewedAt: row.reviewed_at || '' };
  }
  if (collection === 'loans') {
    return { id: row.id, borrowerId: row.borrower_id, lenderId: row.lender_id, amount: Number(row.amount), dueDate: row.due_date || '', status: row.status };
  }
  return { id: row.id, tenantId: row.tenant_id, roomId: row.room_id, status: row.status, requestedAt: row.requested_at || '', reviewedAt: row.reviewed_at || '' };
}

function toDatabaseRow(collection, record) {
  if (collection === 'rooms') {
    return { id: record.id, number: record.number, type: record.type, beds: record.beds, monthly_rent: record.monthlyRent, condition: record.condition };
  }
  if (collection === 'tenants') {
    return { id: record.id, name: record.name, email: record.email || null, user_id: record.accountUserId || null, phone: record.phone || null, room_id: record.roomId || null, monthly_rent: record.monthlyRent, status: record.status };
  }
  if (collection === 'payments') {
    return { id: record.id, tenant_id: record.tenantId, month: record.month, amount: record.amount, status: record.status, method: record.method || null, paid_on: record.paidOn || null, proof_image: record.proofImage || null, reviewed_at: record.reviewedAt || null };
  }
  if (collection === 'loans') {
    return { id: record.id, borrower_id: record.borrowerId, lender_id: record.lenderId, amount: record.amount, due_date: record.dueDate || null, status: record.status };
  }
  return { id: record.id, tenant_id: record.tenantId, room_id: record.roomId, status: record.status, requested_at: record.requestedAt || new Date().toISOString(), reviewed_at: record.reviewedAt || null };
}

async function loadRecords() {
  const results = await Promise.all(databaseCollections.map(({ key, table }) =>
    window.bordsSupabase.from(table).select('*').then(({ data, error }) => {
      if (error) throw new Error(`Could not load ${table}: ${error.message}`);
      return [key, data.map((row) => fromDatabaseRow(key, row))];
    })
  ));
  return Object.fromEntries(results);
}

async function saveRecords(nextRecords = records) {
  const upsertOrder = databaseCollections;
  const deleteOrder = [...databaseCollections].reverse();
  for (const { key, table } of upsertOrder) {
    const previousById = new Map(records[key].map((record) => [record.id, record]));
    const changedRows = nextRecords[key]
      .filter((record) => JSON.stringify(toDatabaseRow(key, previousById.get(record.id) || {})) !== JSON.stringify(toDatabaseRow(key, record)))
      .map((record) => toDatabaseRow(key, record));
    if (!changedRows.length) continue;
    const { error } = await window.bordsSupabase.from(table).upsert(changedRows, { onConflict: 'id' });
    if (error) throw new Error(`Could not save ${table}: ${error.message}`);
  }
  for (const { key, table } of deleteOrder) {
    const nextIds = new Set(nextRecords[key].map((record) => record.id));
    const removedIds = records[key].filter((record) => !nextIds.has(record.id)).map((record) => record.id);
    if (!removedIds.length) continue;
    const { error } = await window.bordsSupabase.from(table).delete().in('id', removedIds);
    if (error) throw new Error(`Could not delete from ${table}: ${error.message}`);
  }
  records = nextRecords;
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

function renderOverview() {
  const activeTenants = records.tenants.filter((tenant) => tenant.status === 'Active');
  const availableRooms = records.rooms.filter((room) => roomStatus(room) === 'Available');
  const pendingLoans = records.loans.filter((loan) => loan.status === 'Pending');
  const paidCount = activeTenants.filter((tenant) => paymentLabel(tenant) === 'Paid in full').length;
  const paymentRows = activeTenants.map((tenant) => {
    const room = roomForTenant(tenant);
    const payment = paymentForTenant(tenant.id);
    return [escapeHtml(tenant.name), escapeHtml(room?.number || 'Unassigned'), statusBadge(payment?.status || 'Unpaid'), money(payment?.amount || 0)];
  });
  const roomRows = availableRooms.slice(0, 3).map((room) => {
    const occupants = tenantsInRoom(room.id);
    const freeBeds = room.beds - occupants.length;
    return `<div class="room-item"><div><strong>Room ${escapeHtml(room.number)}</strong><small>${escapeHtml(room.type)} · ${freeBeds} ${freeBeds === 1 ? 'bed' : 'beds'} free</small></div>${statusBadge('Available')}</div>`;
  }).join('');
  const rosterRows = activeTenants.map((tenant) => {
    const room = roomForTenant(tenant);
    return [escapeHtml(tenant.name), escapeHtml(room?.number || 'Unassigned'), escapeHtml(room?.type || '—'), statusBadge(tenant.status)];
  });
  const loanRows = pendingLoans.slice(0, 3).map((loan) => {
    const borrower = tenantById(loan.borrowerId);
    const lender = tenantById(loan.lenderId);
    return `<div class="loan-item"><div><strong>${escapeHtml(borrower?.name || 'Former tenant')}</strong><small>Lender: ${escapeHtml(lender?.name || 'Former tenant')}</small></div><span class="loan-meta"><strong>${money(loan.amount)}</strong><small>Pending</small></span></div>`;
  }).join('');

  viewRoot.innerHTML = `
    <section class="stats-grid">
      <article class="stat-card accent-blue"><div class="stat-header"><span>Tenants paid in full</span></div><div class="stat-value">${paidCount}</div><div class="stat-subtext">of ${activeTenants.length} active tenants this month</div></article>
      <article class="stat-card accent-green"><div class="stat-header"><span>Rooms available</span></div><div class="stat-value">${availableRooms.length}</div><div class="stat-subtext">Room available for vacancy</div></article>
      <article class="stat-card accent-gold"><div class="stat-header"><span>Total tenants</span></div><div class="stat-value">${activeTenants.length}</div><div class="stat-subtext">Currently staying</div></article>
      <article class="stat-card accent-red"><div class="stat-header"><span>Pending tenant loans</span></div><div class="stat-value">${pendingLoans.length}</div><div class="stat-subtext">Between house tenants</div></article>
    </section>
    <section class="content-grid">
      <div class="panel"><div class="panel-header"><div><div class="panel-label">Payments · ${escapeHtml(new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(today))}</div><h2>Tenant payment status</h2></div><span class="panel-count">${activeTenants.length} tenants</span></div>${renderTable(['Tenant', 'Room', 'Payment', 'Amount paid'], paymentRows, 'No payment records to show.')}</div>
      <div class="panel"><div class="panel-header"><div><div class="panel-label">Rooms</div><h2>Available rooms</h2></div></div><div class="stack-list ${roomRows ? '' : 'is-empty'}">${roomRows || '<p class="empty-state">No available beds.</p>'}<p class="room-note">Showing ${Math.min(availableRooms.length, 3)} of ${availableRooms.length} available rooms</p></div></div>
    </section>
    <section class="bottom-grid">
      <div class="panel"><div class="panel-header"><div><div class="panel-label">Tenants</div><h2>House roster</h2></div><span class="panel-count">${activeTenants.length} active</span></div>${renderTable(['Tenant', 'Room', 'Room type', 'Rent status'], rosterRows, 'No active tenants to show.')}</div>
      <div class="panel"><div class="panel-header"><div><div class="panel-label">Between tenants</div><h2>Pending loan requests</h2></div></div><div class="loan-list ${loanRows ? '' : 'is-empty'}">${loanRows || '<p class="empty-state">No pending loan requests.</p>'}</div></div>
    </section>`;
}

function renderView(view = currentView) {
  currentView = view;
  if (view === 'overview') {
    renderOverview();
    return;
  }

  if (view === 'tenants') {
    const rows = records.tenants.map((tenant) => {
      const room = roomForTenant(tenant);
      return [escapeHtml(tenant.name), escapeHtml(tenant.email || '—'), escapeHtml(tenant.phone || '—'), escapeHtml(room?.number || 'Unassigned'), statusBadge(paymentLabel(tenant)), statusBadge(tenant.status), actionButtons('tenant', tenant.id)];
    });
    viewRoot.innerHTML = `<section class="data-view"><div class="view-heading"><div><span class="panel-label">HOUSE RECORDS</span><h2>All tenants</h2></div><div class="heading-actions"><span class="panel-count">${records.tenants.length} tenants</span><button class="button button-primary" data-action="add" data-type="tenant">＋ Add tenant</button></div></div><div class="panel">${renderTable(['Tenant', 'Account email', 'Phone', 'Room', 'Rent status', 'Tenancy', 'Actions'], rows)}</div></section>`;
  } else if (view === 'rooms') {
    const pendingRoomRequests = records.roomRequests.filter((request) => request.status === 'Pending');
    const requestsPanel = pendingRoomRequests.length
      ? `<section class="panel room-requests-panel"><div class="panel-header"><div><div class="panel-label">TENANT REQUESTS</div><h2>Room requests awaiting approval</h2></div><span class="panel-count">${pendingRoomRequests.length} pending</span></div><div class="room-request-list">${pendingRoomRequests.map((request) => {
        const tenant = tenantById(request.tenantId);
        const room = records.rooms.find((record) => record.id === request.roomId);
        return `<div class="room-request-item"><div><strong>${escapeHtml(tenant?.name || 'Former tenant')}</strong><small>Pending occupancy · Room ${escapeHtml(room?.number || 'removed room')} · ${request.requestedAt ? escapeHtml(new Date(request.requestedAt).toLocaleString()) : 'Date not recorded'}</small></div><div class="row-actions"><button type="button" class="text-button" data-action="review-room-request" data-status="approve" data-id="${escapeHtml(request.id)}">Approve</button><button type="button" class="text-button danger-text" data-action="review-room-request" data-status="decline" data-id="${escapeHtml(request.id)}">Decline</button></div></div>`;
      }).join('')}</div></section>`
      : '';
    const cards = records.rooms.map((room) => {
      const occupants = tenantsInRoom(room.id);
      const status = roomStatus(room);
      const freeBeds = Math.max(0, room.beds - occupants.length);
      const conditionLabel = room.condition === 'Needs repair' ? 'Needs repair' : 'Ready for tenants';
      return `<article class="room-card"><div class="room-card-top"><div><span class="room-card-label">ROOM</span><h3>${escapeHtml(room.number)}</h3></div>${statusBadge(status)}</div><div class="room-card-details"><div><span>TYPE</span><strong>${escapeHtml(room.type)}</strong></div><div><span>BEDS</span><strong>${freeBeds} free / ${room.beds}</strong></div><div><span>MONTHLY RENT</span><strong>${money(room.monthlyRent)} <small>/ tenant</small></strong></div><div class="room-card-tenants"><span>TENANTS</span><strong>${escapeHtml(occupants.map((tenant) => tenant.name).join(', ') || 'No tenants assigned')}</strong></div></div><div class="room-card-footer"><span class="room-condition">${escapeHtml(conditionLabel)}</span><div class="row-actions"><button type="button" class="text-button" data-action="edit" data-type="room" data-id="${escapeHtml(room.id)}">Edit</button><button type="button" class="text-button danger-text" data-action="delete" data-type="room" data-id="${escapeHtml(room.id)}">Delete</button></div><button type="button" class="text-button room-repair-action" data-action="toggle-repair" data-id="${escapeHtml(room.id)}">${room.condition === 'Needs repair' ? 'Mark ready' : 'Needs repair'}</button></div></article>`;
    });
    const availableCount = records.rooms.filter((room) => roomStatus(room) === 'Available').length;
    viewRoot.innerHTML = `<section class="data-view"><div class="view-heading"><div><span class="panel-label">HOUSE RECORDS</span><h2>Rooms</h2></div><div class="heading-actions"><span class="panel-count">${availableCount} available · ${records.rooms.length} total</span><button class="button button-primary" data-action="add" data-type="room">＋ Add room</button></div></div>${requestsPanel}<div class="panel room-catalog"><div class="room-grid">${cards.length ? cards.join('') : '<div class="room-grid-empty"><strong>No rooms yet</strong><span>Add your first room to start managing availability.</span></div>'}</div></div></section>`;
  } else if (view === 'rent') {
    const rows = records.payments.map((payment) => {
      const tenant = tenantById(payment.tenantId);
      const room = tenant ? roomForTenant(tenant) : null;
      const submittedAt = payment.paidOn ? new Date(payment.paidOn).toLocaleString() : '—';
      const proof = payment.proofImage
        ? `<a class="proof-link" href="${escapeHtml(payment.proofImage)}" target="_blank" rel="noopener noreferrer">View proof</a>`
        : '—';
      const reviewActions = payment.status === 'Pending review'
        ? `<div class="row-actions"><button type="button" class="text-button" data-action="review-payment" data-status="approve" data-id="${escapeHtml(payment.id)}">Approve</button><button type="button" class="text-button danger-text" data-action="review-payment" data-status="decline" data-id="${escapeHtml(payment.id)}">Decline</button></div>`
        : actionButtons('payment', payment.id);
      return [escapeHtml(tenant?.name || 'Former tenant'), escapeHtml(room?.number || '—'), escapeHtml(payment.month), statusBadge(payment.status), money(payment.amount), escapeHtml(payment.method || '—'), escapeHtml(submittedAt), proof, reviewActions];
    });
    viewRoot.innerHTML = `<section class="data-view"><div class="view-heading"><div><span class="panel-label">HOUSE RECORDS</span><h2>Rent payments</h2></div><div class="heading-actions"><span class="panel-count">${records.payments.filter((payment) => payment.status === 'Pending review').length} awaiting review · ${records.payments.length} total</span><button class="button button-primary" data-action="add" data-type="payment">＋ Record payment</button></div></div><div class="panel">${renderTable(['Tenant', 'Room', 'Month', 'Status', 'Amount', 'Method', 'Payment date & time', 'Proof', 'Actions'], rows, 'No rent payments to show.')}</div></section>`;
  } else if (view === 'loans') {
    const rows = records.loans.map((loan) => [escapeHtml(tenantById(loan.borrowerId)?.name || 'Former tenant'), escapeHtml(tenantById(loan.lenderId)?.name || 'Former tenant'), money(loan.amount), escapeHtml(loan.dueDate || '—'), statusBadge(loan.status), actionButtons('loan', loan.id)]);
    viewRoot.innerHTML = `<section class="data-view"><div class="view-heading"><div><span class="panel-label">BETWEEN TENANTS</span><h2>Loan requests</h2></div><div class="heading-actions"><span class="panel-count">${records.loans.filter((loan) => loan.status === 'Pending').length} pending</span><button class="button button-primary" data-action="add" data-type="loan">＋ Add loan</button></div></div><div class="panel">${renderTable(['Borrower', 'Lender', 'Amount', 'Due date', 'Status', 'Actions'], rows)}</div></section>`;
  }
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
  const existing = editing ? records[`${type}s`].find((record) => record.id === id) : null;
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
    entryForm.innerHTML = `${inputField('name', 'Full name', existing?.name || '')}${inputField('email', 'Account email for self-signup', existing?.email || '', 'email', false, 'autocomplete="email"')}${inputField('phone', 'Phone number', existing?.phone || '', 'tel', false)}${selectField('roomId', 'Assigned room', roomOptions, existing?.roomId || '', false)}${inputField('monthlyRent', 'Monthly rent (₱)', existing?.monthlyRent ?? '', 'number', true, 'min="0" step="1"')}${selectField('status', 'Tenancy status', ['Active', 'Inactive'].map((value) => ({ value, label: value })), existing?.status || 'Active')}<div class="form-actions"><button type="button" class="button button-secondary" data-action="close-dialog">Cancel</button><button class="button button-primary" type="submit">${editing ? 'Save changes' : 'Add tenant'}</button></div>`;
  } else if (type === 'room') {
    entryForm.innerHTML = `${inputField('number', 'Room number', existing?.number || '')}${selectField('type', 'Room type', ['Single', 'Shared'].map((value) => ({ value, label: value })), existing?.type || 'Single')}${inputField('beds', 'Number of beds', existing?.beds ?? 1, 'number', true, 'min="1" step="1"')}${inputField('monthlyRent', 'Monthly rent per tenant (₱)', existing?.monthlyRent ?? '', 'number', true, 'min="0" step="1"')}${selectField('condition', 'Room condition', [{ value: 'Ready', label: 'Ready for tenants' }, { value: 'Needs repair', label: 'Needs repair · unavailable' }], existing?.condition || 'Ready')}<div class="form-actions"><button type="button" class="button button-secondary" data-action="close-dialog">Cancel</button><button class="button button-primary" type="submit">${editing ? 'Save changes' : 'Add room'}</button></div>`;
  } else if (type === 'payment') {
    const tenantOptions = records.tenants.map((tenant) => ({ value: tenant.id, label: tenant.name }));
    const statusOptions = ['Paid in full', 'Partial', 'Due', 'Overdue', 'Pending review', 'Declined'].map((value) => ({ value, label: value }));
    const paidOn = existing?.paidOn
      ? (existing.paidOn.length === 10 ? `${existing.paidOn}T00:00` : existing.paidOn.slice(0, 16))
      : '';
    entryForm.innerHTML = `${selectField('tenantId', 'Tenant', tenantOptions, existing?.tenantId || '')}${inputField('month', 'Rent month', existing?.month || currentMonth, 'month')}${selectField('status', 'Payment status', statusOptions, existing?.status || 'Paid in full')}${inputField('amount', 'Amount paid (₱)', existing?.amount ?? '', 'number', true, 'min="0" step="1"')}${inputField('paidOn', 'Payment date and time', paidOn, 'datetime-local', false)}<div class="form-actions"><button type="button" class="button button-secondary" data-action="close-dialog">Cancel</button><button class="button button-primary" type="submit">${editing ? 'Save changes' : 'Record payment'}</button></div>`;
  } else if (type === 'loan') {
    const tenantOptions = records.tenants.filter((tenant) => tenant.status === 'Active').map((tenant) => ({ value: tenant.id, label: tenant.name }));
    const statusOptions = ['Pending', 'Approved', 'Declined', 'Repaid'].map((value) => ({ value, label: value }));
    entryForm.innerHTML = `${selectField('borrowerId', 'Borrower', tenantOptions, existing?.borrowerId || '')}${selectField('lenderId', 'Lender', tenantOptions, existing?.lenderId || '')}${inputField('amount', 'Loan amount (₱)', existing?.amount ?? '', 'number', true, 'min="1" step="1"')}${inputField('dueDate', 'Due date', existing?.dueDate || '', 'date', false)}${selectField('status', 'Loan status', statusOptions, existing?.status || 'Pending')}<div class="form-actions"><button type="button" class="button button-secondary" data-action="close-dialog">Cancel</button><button class="button button-primary" type="submit">${editing ? 'Save changes' : 'Add loan'}</button></div>`;
  }
  entryDialog.showModal();
}

async function saveForm(form) {
  const type = form.dataset.type;
  const id = form.dataset.id;
  const values = Object.fromEntries(new FormData(form));
  const collection = `${type}s`;
  const existing = id ? records[collection].find((record) => record.id === id) : null;
  const existingIndex = id ? records[collection].findIndex((record) => record.id === id) : -1;
  let updated = { ...records };

  if (type === 'tenant') {
    const email = values.email.trim().toLowerCase();
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
    const record = { id: id || makeId(), name: values.name.trim(), email, accountUserId: existing?.accountUserId || null, phone: values.phone.trim(), roomId: values.roomId, monthlyRent: Number(values.monthlyRent), status: values.status };
    updated.tenants = [...records.tenants];
    if (existingIndex >= 0) updated.tenants[existingIndex] = record;
    else updated.tenants.push(record);
  } else if (type === 'room') {
    if (records.rooms.some((room) => room.id !== id && room.number.toLowerCase() === values.number.trim().toLowerCase())) {
      showToast('A room with that number already exists.');
      return;
    }
    if (tenantsInRoom(id).length && !editingRoomStillFits(id, Number(values.beds))) {
      showToast('Cannot reduce the room capacity below its active tenant count.');
      return;
    }
    const record = { id: id || makeId(), number: values.number.trim(), type: values.type, beds: Number(values.beds), monthlyRent: Number(values.monthlyRent), condition: values.condition };
    updated.rooms = [...records.rooms];
    if (existingIndex >= 0) updated.rooms[existingIndex] = record;
    else updated.rooms.push(record);
  } else if (type === 'payment') {
    const duplicateIndex = records.payments.findIndex((payment) => payment.id !== id && payment.tenantId === values.tenantId && payment.month === values.month);
    if (duplicateIndex >= 0) {
      showToast('A rent record already exists for this tenant and month. Edit that record instead.');
      return;
    }
    const record = { ...records.payments[existingIndex], id: id || makeId(), tenantId: values.tenantId, month: values.month, status: values.status, amount: Number(values.amount), paidOn: values.paidOn };
    updated.payments = [...records.payments];
    if (existingIndex >= 0) updated.payments[existingIndex] = record;
    else updated.payments.push(record);
  } else if (type === 'loan') {
    if (values.borrowerId === values.lenderId) {
      showToast('Choose two different tenants for a loan.');
      return;
    }
    const record = { id: id || makeId(), borrowerId: values.borrowerId, lenderId: values.lenderId, amount: Number(values.amount), dueDate: values.dueDate, status: values.status };
    updated.loans = [...records.loans];
    if (existingIndex >= 0) updated.loans[existingIndex] = record;
    else updated.loans.push(record);
  }

  try {
    await saveRecords(updated);
    entryDialog.close();
    renderView();
    showToast(`${titlesForType(type)} ${id ? 'updated' : 'added'}.`);
  } catch (error) {
    showToast(`Could not save changes: ${error.message}`);
  }
}

function editingRoomStillFits(roomId, beds) {
  return records.tenants.filter((tenant) => tenant.status === 'Active' && tenant.roomId === roomId).length <= beds;
}

function titlesForType(type) {
  return { tenant: 'Tenant', room: 'Room', payment: 'Rent payment', loan: 'Loan' }[type];
}

async function deleteRecord(type, id) {
  const title = titlesForType(type).toLowerCase();
  if (!window.confirm(`Delete this ${title}? This cannot be undone.`)) return;
  const updated = { ...records, [ `${type}s` ]: [...records[`${type}s`]] };
  updated[`${type}s`] = updated[`${type}s`].filter((record) => record.id !== id);
  if (type === 'tenant') {
    updated.payments = records.payments.filter((payment) => payment.tenantId !== id);
    updated.loans = records.loans.filter((loan) => loan.borrowerId !== id && loan.lenderId !== id);
    updated.roomRequests = records.roomRequests.filter((request) => request.tenantId !== id);
  }
  if (type === 'room' && records.tenants.some((tenant) => tenant.roomId === id)) {
    showToast('Unassign every tenant from this room before deleting it.');
    return;
  }
  if (type === 'room' && records.roomRequests.some((request) => request.roomId === id)) {
    showToast('Resolve room requests for this room before deleting it.');
    return;
  }
  try {
    await saveRecords(updated);
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

navButtons.forEach((button) => button.addEventListener('click', () => {
  currentView = button.dataset.nav;
  updateActiveNav(currentView);
  renderView(currentView);
}));

viewRoot?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, type, id } = button.dataset;
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
      await saveRecords({
        ...records,
        payments: records.payments.map((record) => record.id === id
          ? { ...record, status, reviewedAt: new Date().toISOString() }
          : record)
      });
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
        await saveRecords({
          ...records,
          roomRequests: records.roomRequests.map((record) => record.id === id
            ? { ...record, status: 'Declined', reviewedAt: new Date().toISOString() }
            : record)
        });
        renderView();
        showToast('Room request declined.');
      } catch (error) {
        showToast(`Could not decline room request: ${error.message}`);
      }
      return;
    }
    const tenant = tenantById(request.tenantId);
    const room = records.rooms.find((record) => record.id === request.roomId);
    if (!tenant || tenant.status !== 'Active' || !room || room.condition === 'Needs repair' ||
        tenantsInRoom(room.id, tenant.id).length >= room.beds) {
      showToast('This room is no longer available. Decline the request or choose another room.');
      return;
    }
    try {
      await saveRecords({
        ...records,
        tenants: records.tenants.map((record) => record.id === tenant.id
          ? { ...record, roomId: room.id, monthlyRent: room.monthlyRent }
          : record),
        roomRequests: records.roomRequests.map((record) => record.id === id
          ? { ...record, status: 'Approved', reviewedAt: new Date().toISOString() }
          : record)
      });
      renderView();
      showToast(`${tenant.name} assigned to Room ${room.number}.`);
    } catch (error) {
      showToast(`Could not approve room request: ${error.message}`);
    }
  }
  else if (action === 'toggle-repair') {
    const room = records.rooms.find((record) => record.id === id);
    if (!room) {
      showToast('That room could not be found.');
      return;
    }
    const needsRepair = room.condition !== 'Needs repair';
    const updated = {
      ...records,
      rooms: records.rooms.map((record) => record.id === id ? { ...record, condition: needsRepair ? 'Needs repair' : 'Ready' } : record)
    };
    try {
      await saveRecords(updated);
      renderView();
      showToast(`${room.number} marked ${needsRepair ? 'as needing repair' : 'ready for tenants'}.`);
    } catch (error) {
      showToast(`Could not update room: ${error.message}`);
    }
  }
});

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
    if (data.session.user.app_metadata.role !== 'owner') {
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
