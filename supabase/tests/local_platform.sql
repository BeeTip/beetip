-- Test-only platform stand-ins for an isolated plain PostgreSQL database.
-- These do not validate GoTrue, Storage or PostgREST behavior.
do $$
begin
  if not exists (select 1 from pg_roles where rolname='service_role') then
    create role service_role;
  end if;
end;
$$;
create schema auth;
create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false,raw_user_meta_data jsonb default '{}');
create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
create table auth.mfa_factors(id uuid primary key,user_id uuid,status text,factor_type text,friendly_name text,secret text,created_at timestamptz,updated_at timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb; $$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid; $$;
grant usage on schema auth to anon,authenticated;
grant execute on function auth.uid(),auth.jwt() to anon,authenticated;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key,bucket_id text,name text,owner_id text,metadata jsonb);
alter table storage.objects enable row level security;
create function storage.allow_any_operation(text[]) returns boolean language sql as $$ select true; $$;
create function storage.allow_only_operation(text) returns boolean language sql as $$ select true; $$;

create schema realtime;
create table realtime.messages(topic text,extension text,payload jsonb,event text,private boolean);
alter table realtime.messages enable row level security;
grant usage on schema realtime to authenticated;
grant select on realtime.messages to authenticated;
create function realtime.topic() returns text language sql stable as $$ select current_setting('test.topic',true) $$;
create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$
  insert into realtime.messages values(topic,'broadcast',case when payload ? 'id' then payload else payload || jsonb_build_object('id',gen_random_uuid()) end,event,private) $$;
