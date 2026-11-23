-- Minimal stand-in for what Supabase provides, so the migrations can be
-- tested on a plain local Postgres. Not used in production.
do $$ begin
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
exception when duplicate_object then null; end $$;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists cron;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
create or replace function cron.schedule(job text, sched text, cmd text) returns bigint
language sql as $$ select 1::bigint $$;

grant usage on schema public, extensions, auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create publication supabase_realtime;

-- pg_net stand-in: records requests instead of sending them
create schema if not exists net;
create table net.requests (id bigserial primary key, url text, headers jsonb, body jsonb, at timestamptz default now());
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$ insert into net.requests (url, headers, body) values (url, headers, body) returning id $$;
grant usage on schema net to anon, authenticated, service_role;
