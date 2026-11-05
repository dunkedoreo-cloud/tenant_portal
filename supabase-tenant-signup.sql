alter table public.tenants
  add column if not exists email text;

create unique index if not exists tenants_email_normalized_key
  on public.tenants (lower(btrim(email)))
  where email is not null and btrim(email) <> '';

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.link_verified_tenant_account(target_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_user_id uuid;
begin
  select u.id
  into linked_user_id
  from auth.users u
  join public.tenants t
    on lower(btrim(t.email)) = lower(btrim(u.email))
  where t.id = target_tenant_id
    and t.user_id is null
    and u.email_confirmed_at is not null
    and coalesce(u.raw_app_meta_data ->> 'role', '') in ('', 'tenant')
  limit 1;

  if linked_user_id is null then
    return;
  end if;

  update public.tenants
  set user_id = linked_user_id
  where id = target_tenant_id
    and user_id is null;

  if found then
    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"tenant"}'::jsonb
    where id = linked_user_id;
  end if;
end;
$$;

revoke all on function private.link_verified_tenant_account(uuid) from public, anon, authenticated;

create or replace function private.link_verified_tenant_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_tenant_id uuid;
begin
  if new.email is null or new.email_confirmed_at is null then
    return new;
  end if;

  if coalesce(new.raw_app_meta_data ->> 'role', '') not in ('', 'tenant') then
    return new;
  end if;

  select t.id
  into matched_tenant_id
  from public.tenants t
  where lower(btrim(t.email)) = lower(btrim(new.email))
    and t.user_id is null
  limit 1;

  if matched_tenant_id is not null then
    perform private.link_verified_tenant_account(matched_tenant_id);
  end if;

  return new;
end;
$$;

revoke all on function private.link_verified_tenant_from_auth() from public, anon, authenticated;

drop trigger if exists link_verified_tenant_from_auth on auth.users;
create trigger link_verified_tenant_from_auth
  after insert or update of email, email_confirmed_at
  on auth.users
  for each row
  execute function private.link_verified_tenant_from_auth();

create or replace function private.link_verified_tenant_from_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null and new.user_id is null then
    perform private.link_verified_tenant_account(new.id);
  end if;
  return new;
end;
$$;

revoke all on function private.link_verified_tenant_from_record() from public, anon, authenticated;

drop trigger if exists link_verified_tenant_from_record on public.tenants;
create trigger link_verified_tenant_from_record
  after insert or update of email
  on public.tenants
  for each row
  execute function private.link_verified_tenant_from_record();

grant select (email) on public.tenants to authenticated;
 