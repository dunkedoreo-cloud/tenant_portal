-- ============================================================================
-- BORDS BOARDING HOUSE: MASTER CLEAN DATABASE SCHEMA
-- Run this in your Supabase SQL Editor for a brand new or reset database.
-- ============================================================================

-- 0. CLEAN SLATE (Removes old conflicting tables/triggers if resetting existing DB)
drop trigger if exists set_tenant_role_on_verified_signup on auth.users;
drop trigger if exists create_verified_tenant_profile on auth.users;
drop function if exists private.set_tenant_role_on_verified_signup();
drop function if exists private.create_verified_tenant_profile();
drop function if exists public.ensure_tenant_profile();
drop function if exists public.approve_room_request(uuid);
drop function if exists public.assign_owner_role(text);

drop view if exists public.room_availability;
drop view if exists public.tenant_directory;

drop table if exists public.room_requests cascade;
drop table if exists public.loans cascade;
drop table if exists public.payments cascade;
drop table if exists public.tenants cascade;
drop table if exists public.rooms cascade;

-- Enable UUID extension
create extension if not exists "pgcrypto";

-- ============================================================================
-- 1. TABLES
-- ============================================================================

-- ROOMS TABLE
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  type text not null check (type in ('Single', 'Shared')),
  beds integer not null check (beds >= 1),
  monthly_rent numeric not null check (monthly_rent >= 0),
  condition text not null default 'Ready' check (condition in ('Ready', 'Needs repair')),
  created_at timestamptz not null default now()
);

-- TENANTS TABLE (with resident profiling columns)
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text default '',
  age integer,
  gender text default '',
  address text default '',
  occupation text default '',
  emergency_contact_name text default '',
  emergency_contact_phone text default '',
  room_id uuid references public.rooms (id) on delete set null,
  monthly_rent numeric not null default 0 check (monthly_rent >= 0),
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  user_id uuid unique references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- PAYMENTS TABLE
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  amount numeric not null check (amount >= 0),
  status text not null default 'Due' check (status in ('Paid in full', 'Partial', 'Due', 'Overdue', 'Pending review', 'Declined', 'Unpaid')),
  method text default null,
  paid_on timestamptz default null,
  proof_image text default null,
  reviewed_at timestamptz default null,
  created_at timestamptz not null default now(),
  constraint payments_tenant_month_key unique (tenant_id, month)
);

-- LOANS TABLE (between tenants)
create table public.loans (
  id uuid primary key default gen_random_uuid(),
  borrower_id uuid not null references public.tenants (id) on delete cascade,
  lender_id uuid not null references public.tenants (id) on delete cascade,
  amount numeric not null check (amount > 0),
  due_date date default null,
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Declined', 'Repaid')),
  created_at timestamptz not null default now(),
  constraint loans_borrower_lender_different check (borrower_id <> lender_id)
);

-- ROOM REQUESTS TABLE
create table public.room_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Declined')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz default null
);

-- ============================================================================
-- 2. INDEXES
-- ============================================================================
create unique index tenants_email_normalized_key
  on public.tenants (lower(btrim(email)))
  where email is not null and btrim(email) <> '';

create unique index room_requests_one_pending_per_tenant
  on public.room_requests (tenant_id)
  where status = 'Pending';

create unique index loans_one_pending_per_pair
  on public.loans (borrower_id, lender_id)
  where status = 'Pending';

create index idx_tenants_room_id on public.tenants (room_id);
create index idx_tenants_user_id on public.tenants (user_id);
create index idx_room_requests_room_status on public.room_requests (room_id, status);
create index idx_loans_borrower_status on public.loans (borrower_id, status);
create index idx_loans_lender_status on public.loans (lender_id, status);
create index idx_payments_tenant_status on public.payments (tenant_id, status);

-- ============================================================================
-- 3. VIEWS
-- ============================================================================
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

-- ============================================================================
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
alter table public.rooms enable row level security;
alter table public.tenants enable row level security;
alter table public.payments enable row level security;
alter table public.loans enable row level security;
alter table public.room_requests enable row level security;

-- Rooms policies
create policy "anyone reads rooms"
  on public.rooms for select to authenticated
  using (true);

create policy "owner manages rooms"
  on public.rooms for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner');

-- Tenants policies
create policy "tenant reads own profile or active list"
  on public.tenants for select to authenticated
  using (
    user_id = (select auth.uid())
    or status = 'Active'
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  );

create policy "tenant inserts own profile"
  on public.tenants for insert to authenticated
  with check (
    user_id = (select auth.uid())
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  );

create policy "tenant updates own profile"
  on public.tenants for update to authenticated
  using (
    user_id = (select auth.uid())
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  )
  with check (
    user_id = (select auth.uid())
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  );

create policy "owner manages tenants"
  on public.tenants for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner');

-- Payments policies
create policy "tenant reads own payments"
  on public.payments for select to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where t.id = tenant_id and t.user_id = (select auth.uid())
    )
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  );

create policy "tenant submits own payments"
  on public.payments for insert to authenticated
  with check (
    status = 'Pending review'
    and reviewed_at is null
    and exists (
      select 1 from public.tenants t
      where t.id = tenant_id and t.user_id = (select auth.uid())
    )
  );

create policy "tenant updates own pending payments"
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

create policy "owner manages payments"
  on public.payments for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner');

-- Loans policies
create policy "tenant reads related loans"
  on public.loans for select to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where (t.id = borrower_id or t.id = lender_id)
        and t.user_id = (select auth.uid())
    )
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  );

create policy "tenant requests loans"
  on public.loans for insert to authenticated
  with check (
    status = 'Pending'
    and borrower_id <> lender_id
    and exists (
      select 1 from public.tenants t
      where t.id = borrower_id and t.user_id = (select auth.uid())
    )
  );

create policy "owner manages loans"
  on public.loans for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner');

-- Room requests policies
create policy "tenant reads own room requests"
  on public.room_requests for select to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where t.id = tenant_id and t.user_id = (select auth.uid())
    )
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  );

create policy "tenant submits room requests"
  on public.room_requests for insert to authenticated
  with check (
    status = 'Pending'
    and exists (
      select 1 from public.tenants t
      where t.id = tenant_id and t.user_id = (select auth.uid())
    )
  );

create policy "owner manages room requests"
  on public.room_requests for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner');

-- ============================================================================
-- 5. AUTOMATED AUTH TRIGGERS & RPC FUNCTIONS
-- ============================================================================
create schema if not exists private;

create or replace function private.set_tenant_role_on_verified_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.raw_user_meta_data ->> 'signup_type' = 'tenant'
      or new.raw_user_meta_data ->> 'role' = 'tenant')
    and coalesce(new.raw_app_meta_data ->> 'role', '') in ('', 'tenant')
  then
    new.raw_app_meta_data :=
      coalesce(new.raw_app_meta_data, '{}'::jsonb) || '{"role":"tenant"}'::jsonb;
  end if;

  return new;
end;
$$;

create or replace function private.create_verified_tenant_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_tenant_id uuid;
begin
  if new.email is null
    or ((new.raw_user_meta_data ->> 'signup_type') is distinct from 'tenant'
        and (new.raw_app_meta_data ->> 'role') is distinct from 'tenant')
  then
    return new;
  end if;

  if coalesce(new.raw_app_meta_data ->> 'role', '') <> 'tenant' then
    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"tenant"}'::jsonb
    where id = new.id;
  end if;

  if exists (select 1 from public.tenants t where t.user_id = new.id) then
    return new;
  end if;

  select t.id into matched_tenant_id
  from public.tenants t
  where lower(btrim(t.email)) = lower(btrim(new.email))
    and t.user_id is null
  limit 1;

  if matched_tenant_id is not null then
    update public.tenants
    set user_id = new.id
    where id = matched_tenant_id and user_id is null;
  else
    insert into public.tenants (id, name, email, phone, room_id, monthly_rent, status, user_id)
    values (
      gen_random_uuid(),
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
      new.email,
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'phone'), ''), ''),
      null,
      0,
      'Active',
      new.id
    )
    on conflict (lower(btrim(email)))
      where email is not null and btrim(email) <> ''
      do update set user_id = excluded.user_id
      where public.tenants.user_id is null;
  end if;

  return new;
end;
$$;

create trigger set_tenant_role_on_verified_signup
  before insert or update of email, raw_user_meta_data
  on auth.users
  for each row
  execute function private.set_tenant_role_on_verified_signup();

create trigger create_verified_tenant_profile
  after insert or update of email, email_confirmed_at, raw_user_meta_data
  on auth.users
  for each row
  execute function private.create_verified_tenant_profile();

-- Self-healing RPC function
create or replace function public.ensure_tenant_profile()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_email text;
  v_name text;
  v_phone text;
  v_tenant_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  select email, raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'phone'
  into v_email, v_name, v_phone
  from auth.users
  where id = v_user_id;

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"tenant"}'::jsonb
  where id = v_user_id
    and coalesce(raw_app_meta_data ->> 'role', '') in ('', 'tenant');

  select id into v_tenant_id from public.tenants where user_id = v_user_id limit 1;
  if v_tenant_id is null then
    select id into v_tenant_id from public.tenants where lower(btrim(email)) = lower(btrim(v_email)) and user_id is null limit 1;
    if v_tenant_id is not null then
      update public.tenants set user_id = v_user_id where id = v_tenant_id;
    else
      insert into public.tenants (id, name, email, phone, room_id, monthly_rent, status, user_id)
      values (
        gen_random_uuid(),
        coalesce(nullif(btrim(v_name), ''), split_part(v_email, '@', 1)),
        v_email,
        coalesce(nullif(btrim(v_phone), ''), ''),
        null,
        0,
        'Active',
        v_user_id
      )
      returning id into v_tenant_id;
    end if;
  end if;

  -- Ensure saved full name in auth metadata is synchronized to public.tenants
  if coalesce(nullif(btrim(v_name), ''), '') <> '' and v_name <> split_part(v_email, '@', 1) then
    update public.tenants
    set name = btrim(v_name)
    where id = v_tenant_id
      and (name is null or name = split_part(v_email, '@', 1));
  end if;

  return jsonb_build_object('success', true, 'tenant_id', v_tenant_id);
end;
$$;

grant execute on function public.ensure_tenant_profile() to authenticated;

-- Atomic Room Request Approval for Owner Dashboard
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

-- Helper to designate an owner account with 1 command:
-- Example: SELECT public.assign_owner_role('myowner@example.com');
create or replace function public.assign_owner_role(p_email text)
returns text
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
begin
  select id into v_user_id
  from auth.users
  where lower(btrim(email)) = lower(btrim(p_email));

  if v_user_id is null then
    return 'No auth user found with email: ' || p_email;
  end if;

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"owner"}'::jsonb
  where id = v_user_id;

  return 'User ' || p_email || ' successfully assigned role: owner';
end;
$$;

-- Grant permissions to authenticated users
grant select (email) on public.tenants to authenticated;

-- Function: Tenant Self-Update Profile RPC (with address, age, and resident details)
create or replace function public.update_tenant_profile(
  p_name text,
  p_phone text default '',
  p_age integer default null,
  p_gender text default '',
  p_address text default '',
  p_occupation text default '',
  p_emergency_contact_name text default '',
  p_emergency_contact_phone text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_email text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  if coalesce(btrim(p_name), '') = '' then
    return jsonb_build_object('success', false, 'error', 'Name cannot be empty');
  end if;

  select email into v_email from auth.users where id = v_user_id;

  update public.tenants
  set
    name = btrim(p_name),
    phone = coalesce(btrim(p_phone), ''),
    age = p_age,
    gender = coalesce(btrim(p_gender), ''),
    address = coalesce(btrim(p_address), ''),
    occupation = coalesce(btrim(p_occupation), ''),
    emergency_contact_name = coalesce(btrim(p_emergency_contact_name), ''),
    emergency_contact_phone = coalesce(btrim(p_emergency_contact_phone), ''),
    user_id = v_user_id
  where user_id = v_user_id
     or (user_id is null and lower(btrim(email)) = lower(btrim(v_email)));

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
    'full_name', btrim(p_name),
    'name', btrim(p_name),
    'phone', coalesce(btrim(p_phone), ''),
    'age', p_age,
    'gender', coalesce(btrim(p_gender), ''),
    'address', coalesce(btrim(p_address), ''),
    'occupation', coalesce(btrim(p_occupation), ''),
    'emergency_contact_name', coalesce(btrim(p_emergency_contact_name), ''),
    'emergency_contact_phone', coalesce(btrim(p_emergency_contact_phone), '')
  )
  where id = v_user_id;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.update_tenant_profile(text, text, integer, text, text, text, text, text) to authenticated;
grant execute on function public.update_tenant_profile(text, text) to authenticated;

-- ============================================================================
-- 6. INITIAL SEED DATA (Ready-to-use boarding rooms)
-- ============================================================================
insert into public.rooms (number, type, beds, monthly_rent, condition) values
  ('R-101', 'Single', 1, 3500.00, 'Ready'),
  ('R-102', 'Shared', 2, 2200.00, 'Ready'),
  ('R-103', 'Single', 1, 3800.00, 'Ready'),
  ('R-201', 'Shared', 4, 1800.00, 'Ready'),
  ('R-202', 'Shared', 2, 2400.00, 'Ready'),
  ('R-203', 'Single', 1, 4000.00, 'Needs repair')
on conflict (number) do nothing;
