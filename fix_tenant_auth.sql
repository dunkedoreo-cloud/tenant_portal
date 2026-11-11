-- ============================================================================
-- BORDS: 1-CLICK INSTANT DATABASE FIX FOR TENANT SIGNUP & LOGIN
-- Paste and run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/exfeacpgbrkgppzyvusk/sql
-- ============================================================================

-- 1. Remove NOT NULL constraints on room_id and phone so new tenants can register
alter table public.tenants
  alter column room_id drop not null;

alter table public.tenants
  alter column phone drop not null;

alter table public.tenants
  alter column phone set default '';

-- 2. Ensure email and user_id columns exist on public.tenants
alter table public.tenants
  add column if not exists email text;

alter table public.tenants
  add column if not exists user_id uuid unique references auth.users (id) on delete set null;

create unique index if not exists tenants_email_normalized_key
  on public.tenants (lower(btrim(email)))
  where email is not null and btrim(email) <> '';

-- 3. Private schema and role trigger on auth.users
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

-- 4. Update tenant profile creation trigger (safe defaults for room_id and phone)
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

  -- Ensure app_metadata has tenant role
  if coalesce(new.raw_app_meta_data ->> 'role', '') <> 'tenant' then
    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"tenant"}'::jsonb
    where id = new.id;
  end if;

  -- If user already linked to a tenant record, nothing to do
  if exists (
    select 1 from public.tenants t where t.user_id = new.id
  ) then
    return new;
  end if;

  -- Match existing tenant created by Owner with matching email
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

-- Reattach triggers
drop trigger if exists set_tenant_role_on_verified_signup on auth.users;
create trigger set_tenant_role_on_verified_signup
  before insert or update of email, raw_user_meta_data
  on auth.users
  for each row
  execute function private.set_tenant_role_on_verified_signup();

drop trigger if exists create_verified_tenant_profile on auth.users;
create trigger create_verified_tenant_profile
  after insert or update of email, email_confirmed_at, raw_user_meta_data
  on auth.users
  for each row
  execute function private.create_verified_tenant_profile();

-- 5. Self-healing RPC function for frontend recovery
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

  -- Ensure app_metadata contains role 'tenant'
  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"tenant"}'::jsonb
  where id = v_user_id
    and coalesce(raw_app_meta_data ->> 'role', '') in ('', 'tenant');

  -- Check if already linked
  select id into v_tenant_id
  from public.tenants
  where user_id = v_user_id
  limit 1;

  if v_tenant_id is null then
    select id into v_tenant_id
    from public.tenants
    where lower(btrim(email)) = lower(btrim(v_email))
      and user_id is null
    limit 1;

    if v_tenant_id is not null then
      update public.tenants
      set user_id = v_user_id
      where id = v_tenant_id;
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

-- 6. Immediately link and fix all existing tenant accounts in auth.users
do $$
declare
  u record;
  t_id uuid;
begin
  for u in
    select id, email, raw_user_meta_data ->> 'full_name' as full_name, raw_user_meta_data ->> 'phone' as phone
    from auth.users
    where coalesce(raw_app_meta_data ->> 'role', '') in ('', 'tenant')
  loop
    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"tenant"}'::jsonb
    where id = u.id;

    select id into t_id from public.tenants where user_id = u.id limit 1;
    if t_id is null then
      select id into t_id from public.tenants where lower(btrim(email)) = lower(btrim(u.email)) and user_id is null limit 1;
      if t_id is not null then
        update public.tenants set user_id = u.id where id = t_id;
      else
        insert into public.tenants (id, name, email, phone, room_id, monthly_rent, status, user_id)
        values (
          gen_random_uuid(),
          coalesce(nullif(btrim(u.full_name), ''), split_part(u.email, '@', 1)),
          u.email,
          coalesce(nullif(btrim(u.phone), ''), ''),
          null,
          0,
          'Active',
          u.id
        )
        on conflict (lower(btrim(email)))
          where email is not null and btrim(email) <> ''
          do update set user_id = excluded.user_id
          where public.tenants.user_id is null;
      end if;
    end if;
  end loop;
end;
$$;

-- 7. Ensure profile columns exist on public.tenants
alter table public.tenants add column if not exists age integer;
alter table public.tenants add column if not exists gender text default '';
alter table public.tenants add column if not exists address text default '';
alter table public.tenants add column if not exists occupation text default '';
alter table public.tenants add column if not exists emergency_contact_name text default '';
alter table public.tenants add column if not exists emergency_contact_phone text default '';

-- 8. Tenant Profile Update RPC (allows changing name, phone, age, address, and resident details safely)
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
