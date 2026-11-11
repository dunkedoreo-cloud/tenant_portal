-- ============================================================================
-- BORDS: Tenant Access & Row Level Security (RLS) Policies
-- ============================================================================

-- 1. Table schema & constraint adjustments
alter table public.tenants
  alter column room_id drop not null;

alter table public.tenants
  alter column phone drop not null;

alter table public.tenants
  alter column phone set default '';

alter table public.tenants
  add column if not exists user_id uuid unique references auth.users (id) on delete set null;

create unique index if not exists payments_tenant_month_key
  on public.payments (tenant_id, month);

create unique index if not exists room_requests_one_pending_per_tenant
  on public.room_requests (tenant_id)
  where status = 'Pending';

create unique index if not exists loans_one_pending_per_pair
  on public.loans (borrower_id, lender_id)
  where status = 'Pending';

-- Missing Foreign Key & Filter Indexes for Performance
create index if not exists idx_tenants_room_id on public.tenants (room_id);
create index if not exists idx_tenants_user_id on public.tenants (user_id);
create index if not exists idx_room_requests_room_status on public.room_requests (room_id, status);
create index if not exists idx_loans_borrower_status on public.loans (borrower_id, status);
create index if not exists idx_loans_lender_status on public.loans (lender_id, status);
create index if not exists idx_payments_tenant_status on public.payments (tenant_id, status);

-- Enable RLS on all domain tables
alter table public.rooms enable row level security;
alter table public.tenants enable row level security;
alter table public.payments enable row level security;
alter table public.loans enable row level security;
alter table public.room_requests enable row level security;

-- 2. Directory & Availability Views
create or replace view public.tenant_directory with (security_invoker = true) as
  select id, name
  from public.tenants
  where status = 'Active';

grant select on public.tenant_directory to authenticated;

create or replace view public.room_availability with (security_invoker = true) as
  select
    r.id,
    r.number,
    r.type,
    r.beds,
    r.monthly_rent,
    r.condition,
    count(t.id)::integer as occupied_beds
  from public.rooms r
  left join public.tenants t
    on t.room_id = r.id and t.status = 'Active'
  group by r.id, r.number, r.type, r.beds, r.monthly_rent, r.condition;

grant select on public.room_availability to authenticated;

-- 3. Room Policies
drop policy if exists "bords tenant reads rooms" on public.rooms;
create policy "bords tenant reads rooms"
  on public.rooms for select to authenticated
  using (true);

drop policy if exists "bords owner manages rooms" on public.rooms;
create policy "bords owner manages rooms"
  on public.rooms for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner');

-- 4. Tenant Profile Policies
drop policy if exists "bords tenant reads own profile" on public.tenants;
create policy "bords tenant reads own profile"
  on public.tenants for select to authenticated
  using (
    user_id = (select auth.uid())
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
    or status = 'Active'
  );

drop policy if exists "bords tenant creates own profile" on public.tenants;
create policy "bords tenant creates own profile"
  on public.tenants for insert to authenticated
  with check (
    user_id = (select auth.uid())
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  );

drop policy if exists "bords tenant updates own profile" on public.tenants;
create policy "bords tenant updates own profile"
  on public.tenants for update to authenticated
  using (
    user_id = (select auth.uid())
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  )
  with check (
    user_id = (select auth.uid())
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  );

drop policy if exists "bords owner manages tenants" on public.tenants;
create policy "bords owner manages tenants"
  on public.tenants for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner');

-- 5. Payment Policies
drop policy if exists "bords tenant reads own payments" on public.payments;
create policy "bords tenant reads own payments"
  on public.payments for select to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where t.id = tenant_id and t.user_id = (select auth.uid())
    )
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  );

drop policy if exists "bords tenant submits own payments" on public.payments;
create policy "bords tenant submits own payments"
  on public.payments for insert to authenticated
  with check (
    status = 'Pending review'
    and reviewed_at is null
    and exists (
      select 1 from public.tenants t
      where t.id = tenant_id and t.user_id = (select auth.uid())
    )
  );

drop policy if exists "bords tenant resubmits own unreviewed payments" on public.payments;
create policy "bords tenant resubmits own unreviewed payments"
  on public.payments for update to authenticated
  using (
    status in ('Declined', 'Due', 'Overdue', 'Unpaid', 'Partial')
    and exists (
      select 1 from public.tenants t
      where t.id = tenant_id and t.user_id = (select auth.uid())
    )
  )
  with check (
    status = 'Pending review'
    and reviewed_at is null
    and exists (
      select 1 from public.tenants t
      where t.id = tenant_id and t.user_id = (select auth.uid())
    )
  );

drop policy if exists "bords owner manages payments" on public.payments;
create policy "bords owner manages payments"
  on public.payments for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner');

-- 6. Loan Policies
drop policy if exists "bords tenant reads related loans" on public.loans;
create policy "bords tenant reads related loans"
  on public.loans for select to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where (t.id = borrower_id or t.id = lender_id)
        and t.user_id = (select auth.uid())
    )
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  );

drop policy if exists "bords tenant requests loans" on public.loans;
create policy "bords tenant requests loans"
  on public.loans for insert to authenticated
  with check (
    status = 'Pending'
    and borrower_id <> lender_id
    and exists (
      select 1 from public.tenants t
      where t.id = borrower_id and t.user_id = (select auth.uid())
    )
  );

drop policy if exists "bords owner manages loans" on public.loans;
create policy "bords owner manages loans"
  on public.loans for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner');

-- 7. Room Request Policies
drop policy if exists "bords tenant reads own room requests" on public.room_requests;
create policy "bords tenant reads own room requests"
  on public.room_requests for select to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where t.id = tenant_id and t.user_id = (select auth.uid())
    )
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  );

drop policy if exists "bords tenant requests rooms" on public.room_requests;
create policy "bords tenant requests rooms"
  on public.room_requests for insert to authenticated
  with check (
    status = 'Pending'
    and exists (
      select 1 from public.tenants t
      where t.id = tenant_id and t.user_id = (select auth.uid())
    )
  );

drop policy if exists "bords owner manages room requests" on public.room_requests;
create policy "bords owner manages room requests"
  on public.room_requests for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner');

-- 8. Atomic Room Approval RPC for Owner Dashboard
create or replace function public.approve_room_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_req record;
  v_room record;
  v_occupied integer;
begin
  select * into v_req from public.room_requests where id = p_request_id for update;
  if not found or v_req.status <> 'Pending' then
    return jsonb_build_object('success', false, 'message', 'Request is no longer pending.');
  end if;

  select * into v_room from public.rooms where id = v_req.room_id for update;
  if v_room.condition = 'Needs repair' then
    return jsonb_build_object('success', false, 'message', 'This room needs repair and cannot accept tenants.');
  end if;

  select count(*) into v_occupied from public.tenants where room_id = v_room.id and status = 'Active';
  if v_occupied >= v_room.beds then
    return jsonb_build_object('success', false, 'message', 'This room is already at full capacity.');
  end if;

  update public.tenants
  set room_id = v_room.id, monthly_rent = v_room.monthly_rent, status = 'Active'
  where id = v_req.tenant_id;

  update public.room_requests
  set status = 'Approved', reviewed_at = now()
  where id = p_request_id;

  return jsonb_build_object('success', true, 'message', 'Room request approved successfully.');
end;
$$;

grant execute on function public.approve_room_request(uuid) to authenticated;
