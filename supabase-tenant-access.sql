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

alter table public.rooms enable row level security;
alter table public.tenants enable row level security;
alter table public.payments enable row level security;
alter table public.loans enable row level security;
alter table public.room_requests enable row level security;

create or replace view public.tenant_directory with (security_invoker = false) as
  select id, name
  from public.tenants
  where status = 'Active'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'tenant';

grant select on public.tenant_directory to authenticated;

create or replace view public.room_availability with (security_invoker = false) as
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
  where (auth.jwt() -> 'app_metadata' ->> 'role') = 'tenant'
  group by r.id, r.number, r.type, r.beds, r.monthly_rent, r.condition;

grant select on public.room_availability to authenticated;

drop policy if exists "bords tenant reads rooms" on public.rooms;
create policy "bords tenant reads rooms"
  on public.rooms for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'tenant');

drop policy if exists "bords tenant reads own profile" on public.tenants;
create policy "bords tenant reads own profile"
  on public.tenants for select to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'tenant'
    and user_id = (select auth.uid())
  );

drop policy if exists "bords tenant reads own payments" on public.payments;
create policy "bords tenant reads own payments"
  on public.payments for select to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'tenant'
    and exists (
      select 1 from public.tenants t
      where t.id = tenant_id and t.user_id = (select auth.uid())
    )
  );

drop policy if exists "bords tenant submits own payments" on public.payments;
create policy "bords tenant submits own payments"
  on public.payments for insert to authenticated
  with check (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'tenant'
    and status = 'Pending review'
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
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'tenant'
    and status in ('Declined', 'Due', 'Overdue', 'Unpaid', 'Partial')
    and exists (
      select 1 from public.tenants t
      where t.id = tenant_id and t.user_id = (select auth.uid())
    )
  )
  with check (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'tenant'
    and status = 'Pending review'
    and reviewed_at is null
    and exists (
      select 1 from public.tenants t
      where t.id = tenant_id and t.user_id = (select auth.uid())
    )
  );

drop policy if exists "bords tenant reads related loans" on public.loans;
create policy "bords tenant reads related loans"
  on public.loans for select to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'tenant'
    and (
      exists (
        select 1 from public.tenants t
        where t.id = borrower_id and t.user_id = (select auth.uid())
      )
      or exists (
        select 1 from public.tenants t
        where t.id = lender_id and t.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "bords tenant requests loans" on public.loans;
create policy "bords tenant requests loans"
  on public.loans for insert to authenticated
  with check (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'tenant'
    and status = 'Pending'
    and borrower_id <> lender_id
    and exists (
      select 1 from public.tenants t
      where t.id = borrower_id and t.user_id = (select auth.uid())
    )
  );

drop policy if exists "bords tenant reads own room requests" on public.room_requests;
create policy "bords tenant reads own room requests"
  on public.room_requests for select to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'tenant'
    and exists (
      select 1 from public.tenants t
      where t.id = tenant_id and t.user_id = (select auth.uid())
    )
  );

drop policy if exists "bords tenant requests rooms" on public.room_requests;
create policy "bords tenant requests rooms"
  on public.room_requests for insert to authenticated
  with check (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'tenant'
    and status = 'Pending'
    and exists (
      select 1 from public.tenants t
      where t.id = tenant_id and t.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.room_availability r
      where r.id = room_id
        and r.condition <> 'Needs repair'
        and r.occupied_beds < r.beds
    )
  );
