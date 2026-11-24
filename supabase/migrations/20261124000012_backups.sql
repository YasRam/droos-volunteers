-- =====================================================================
-- 12) Daily backups to Google Drive
--
-- A Google Apps Script in the owner's Drive calls the edge function
-- `backup` once a day with a random token it keeps to itself. The
-- database only stores the SHA-256 of that token, so the token never
-- leaves the script (and the hash is not a secret).
-- The function dumps every table as JSON; the script gzips it into a
-- Drive folder and keeps the last 30 copies.
-- =====================================================================

create table public.backup_config (
  id          boolean primary key default true check (id),
  token_hash  text check (token_hash ~ '^[0-9a-f]{64}$'),
  updated_at  timestamptz not null default now(),
  updated_by  text
);
alter table public.backup_config enable row level security;
revoke all on public.backup_config from anon, authenticated;
insert into public.backup_config (id) values (true) on conflict (id) do nothing;

create table public.backup_runs (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  ok        boolean not null,
  tables    int,
  rows      int,
  bytes     int,
  file_name text,
  error     text
);
alter table public.backup_runs enable row level security;
revoke all on public.backup_runs from anon;
grant select on public.backup_runs to authenticated;
create policy backup_runs_read on public.backup_runs for select to authenticated
  using ((select app.has_perm('settings.manage')));

-- Link (or re-link) the Drive script: paste the hash it printed.
create or replace function public.set_backup_link(p_hash text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not app.has_perm('settings.manage') then
    raise exception 'محتاج صلاحية الإعدادات' using errcode = '42501';
  end if;
  p_hash := lower(trim(p_hash));
  if p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'كود الربط لازم يكون 64 حرف (أرقام وحروف من a لـ f)' using errcode = '22023';
  end if;
  update public.backup_config set token_hash = p_hash, updated_at = now(), updated_by = app.email() where id;
end;
$$;
revoke all on function public.set_backup_link(text) from public, anon;
grant execute on function public.set_backup_link(text) to authenticated;

-- Is a script linked? (true/false only, never the hash)
create or replace function public.backup_linked()
returns boolean
language sql stable security definer
set search_path = ''
as $$ select token_hash is not null from public.backup_config where id $$;
revoke all on function public.backup_linked() from public, anon;
grant execute on function public.backup_linked() to authenticated;
