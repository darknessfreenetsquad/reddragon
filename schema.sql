-- Run once in the Supabase SQL editor for a project you control.
-- The server uses the service-role key; never expose that key in the browser.
create table if not exists public.sessions (
  number text primary key,
  creds jsonb not null,
  keys jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.numbers (
  number text primary key,
  created_at timestamptz not null default now()
);
create table if not exists public.configs (
  number text primary key,
  config jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.admins (jid text primary key);
create table if not exists public.newsletters (
  jid text primary key,
  emojis text[] not null default '{}',
  added_at timestamptz not null default now()
);

-- No public policies are added: access these tables only from the trusted server.
alter table public.sessions enable row level security;
alter table public.numbers enable row level security;
alter table public.configs enable row level security;
alter table public.admins enable row level security;
alter table public.newsletters enable row level security;

-- The app uses a server-only secret key, which maps to service_role.
-- Do not grant these tables to anon or authenticated clients.
grant select, insert, update, delete on table
  public.sessions, public.numbers, public.configs, public.admins, public.newsletters
  to service_role;
