-- Test-only platform stand-ins for an isolated plain PostgreSQL database.
-- These do not validate GoTrue, Storage or PostgREST behavior.
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
